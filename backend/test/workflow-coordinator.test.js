import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ToolMessage } from '@langchain/core/messages'
import { createWorkflowGuardMiddleware } from '../src/agent/workflow-guard-middleware.js'
import { createResumeToolHandlers } from '../src/agent/resume-tools.js'
import { getCanonicalNextAction, inspectToolCall, workflowStateSummary } from '../src/core/workflow-coordinator.js'
import { createResumeTask, prepareResumeTask, recordDraftWrite, TASK_STATES } from '../src/core/workflow.js'

function taskWithDraft(state = TASK_STATES.DRAFTING) {
  const prepared = prepareResumeTask(createResumeTask({ workspaceId: 'workspace-1', resumeId: 'resume.md' }))
  const drafted = recordDraftWrite(prepared, { contentVersion: 'content-v1' })
  return { ...drafted, state, blockers: state === TASK_STATES.NEEDS_REVISION ? ['page overflow'] : [] }
}

test('canonical next action is derived from task state, not copied from a tool description', () => {
  const blocked = taskWithDraft(TASK_STATES.BLOCKED)
  assert.equal(getCanonicalNextAction(blocked, { draftAvailable: true }).tool, 'resume_reopen_draft')
  assert.equal(getCanonicalNextAction({ ...blocked, context: { ...blocked.context, contentVersion: null } }, { draftAvailable: false }).tool, 'resume_write')

  const rendered = { ...blocked, state: TASK_STATES.RENDERED }
  assert.equal(getCanonicalNextAction(rendered, { draftAvailable: true }).tool, 'resume_metrics')
  const measured = { ...blocked, state: TASK_STATES.MEASURED }
  assert.equal(getCanonicalNextAction(measured, { draftAvailable: true }).tool, 'resume_finalize')
})

test('workflow guard allows deterministic recovery and rejects invalid measurement calls', async () => {
  const taskRef = { current: taskWithDraft(TASK_STATES.BLOCKED), draftRelativePath: '.cvagent/drafts/task/resume.md' }
  const interventions = []
  const middleware = createWorkflowGuardMiddleware({
    taskRef,
    getDraftAvailable: () => true,
    onIntervention: async (event) => interventions.push(event),
  })

  const modelResult = await middleware.wrapModelCall({ systemPrompt: 'base prompt' }, async (request) => request)
  assert.match(modelResult.systemPrompt, /CVAGENT HARNESS STATE/)
  assert.match(modelResult.systemPrompt, /resume_reopen_draft/)

  const forwarded = new ToolMessage({ content: 'ok', tool_call_id: 'call-1', name: 'resume_render' })
  const recovered = await middleware.wrapToolCall({ toolCall: { id: 'call-1', name: 'resume_render', args: {} }, tool: { name: 'resume_render' } }, async () => forwarded)
  assert.equal(recovered, forwarded)
  assert.equal(interventions[0].decision.intervention, 'resume_reopen_draft')

  taskRef.current = { ...taskRef.current, state: TASK_STATES.DRAFTING }
  const blocked = await middleware.wrapToolCall({ toolCall: { id: 'call-2', name: 'resume_metrics', args: {} }, tool: { name: 'resume_metrics' } }, async () => { throw new Error('must not execute') })
  const payload = JSON.parse(String(blocked.content))
  assert.equal(payload.errorCode, 'MEASUREMENT_NOT_ALLOWED')
  assert.equal(payload.nextTool, 'resume_check')
})

test('workflow guard replays read-only results and caps repeated tool loops', async () => {
  const taskRef = { current: taskWithDraft(TASK_STATES.DRAFTING), draftRelativePath: '.cvagent/drafts/task/resume.md' }
  const interventions = []
  const middleware = createWorkflowGuardMiddleware({
    taskRef,
    toolLimits: { icon_list: 1 },
    maxToolCalls: 6,
    onIntervention: async (event) => interventions.push(event),
  })
  let executions = 0
  const handler = async (request) => {
    executions += 1
    return new ToolMessage({ content: JSON.stringify({ icons: ['school', 'work'] }), tool_call_id: request.toolCall.id, name: request.toolCall.name })
  }

  const first = await middleware.wrapToolCall({ toolCall: { id: 'icon-1', name: 'icon_list', args: { query: 'school' } }, tool: { name: 'icon_list' } }, handler)
  const replay = await middleware.wrapToolCall({ toolCall: { id: 'icon-2', name: 'icon_list', args: { query: 'school' } }, tool: { name: 'icon_list' } }, handler)
  const blocked = await middleware.wrapToolCall({ toolCall: { id: 'icon-3', name: 'icon_list', args: { query: 'work' } }, tool: { name: 'icon_list' } }, handler)

  assert.equal(executions, 1)
  assert.equal(JSON.parse(String(first.content)).icons[0], 'school')
  assert.equal(JSON.parse(String(replay.content)).icons[0], 'school')
  assert.equal(JSON.parse(String(blocked.content)).errorCode, 'TOOL_BUDGET_EXCEEDED')
  assert.ok(interventions.some((item) => item.decision.intervention === 'read_result_replayed'))
  assert.ok(interventions.some((item) => item.decision.intervention === 'tool_budget_exceeded'))
})

test('workflow guard serializes concurrent tool calls before mutating task state', async () => {
  const taskRef = { current: taskWithDraft(TASK_STATES.DRAFTING), draftRelativePath: '.cvagent/drafts/task/resume.md' }
  const middleware = createWorkflowGuardMiddleware({ taskRef })
  let active = 0
  let peak = 0
  const handler = async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    return new ToolMessage({ content: 'ok', tool_call_id: 'queued', name: 'resume_check' })
  }

  await Promise.all([
    middleware.wrapToolCall({ toolCall: { id: 'check-1', name: 'resume_check', args: {} }, tool: { name: 'resume_check' } }, handler),
    middleware.wrapToolCall({ toolCall: { id: 'check-2', name: 'resume_check', args: {} }, tool: { name: 'resume_check' } }, handler),
  ])

  assert.equal(peak, 1)
})

test('workflow guard turns premature presentation suggestions into a deterministic transition', async () => {
  const taskRef = { current: taskWithDraft(TASK_STATES.DRAFTING), draftRelativePath: '.cvagent/drafts/task/resume.md' }
  const middleware = createWorkflowGuardMiddleware({ taskRef })
  const blocked = await middleware.wrapToolCall({ toolCall: { id: 'suggest-1', name: 'presentation_suggest', args: {} }, tool: { name: 'presentation_suggest' } }, async () => { throw new Error('must not execute') })
  const payload = JSON.parse(String(blocked.content))
  assert.equal(payload.errorCode, 'MEASUREMENT_REQUIRED')
  assert.equal(payload.nextTool, 'resume_check')
})

test('workflow state summary is compact and machine-readable', () => {
  const summary = workflowStateSummary(taskWithDraft(TASK_STATES.NEEDS_REVISION), { draftAvailable: true })
  assert.deepEqual(summary, {
    state: TASK_STATES.NEEDS_REVISION,
    draftAvailable: true,
    contentVersion: 'content-v1',
    templateRevision: null,
    renderId: null,
    nextTool: 'resume_reopen_draft',
    nextReason: '恢复已有隔离草稿并清除过期渲染身份。',
    completionAllowed: false,
  })
})

test('tool inspection makes missing draft recovery explicit', () => {
  const task = prepareResumeTask(createResumeTask({ workspaceId: 'workspace-1', resumeId: 'resume.md' }))
  const decision = inspectToolCall(task, 'resume_render', { draftAvailable: false })
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, 'DRAFT_REQUIRED')
  assert.equal(decision.nextTool, 'resume_write')
})

test('resume_render reopens a blocked draft through the harness guard', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-workflow-recovery-'))
  try {
    await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# Resume\n\n## Experience\n\n- Evidence\n', 'utf8')
    const taskRef = {
      current: recordDraftWrite(
        prepareResumeTask(createResumeTask({ workspaceId: 'workspace-1', resumeId: 'resume.md', targetPages: 1 })),
        { contentVersion: 'content-v1', intakeComplete: true },
      ),
      draftRelativePath: '.cvagent/drafts/task/resume.md',
    }
    const handlers = createResumeToolHandlers({ workspaceRoot, resumePath: 'resume.md', taskRef })
    const written = await handlers.resumeDraftWrite({ content: '# Resume\n\n## Experience\n\n- Evidence\n' })
    assert.equal(written.state, TASK_STATES.DRAFTING)
    const staleRenderId = 'render_stale'
    taskRef.current = { ...taskRef.current, state: TASK_STATES.BLOCKED, blockers: ['stale browser measurement'], context: { ...taskRef.current.context, renderId: staleRenderId } }

    const rendered = await handlers.resumeRender()

    assert.equal(rendered.state, TASK_STATES.RENDERED)
    assert.equal(taskRef.current.state, TASK_STATES.RENDERED)
    assert.notEqual(taskRef.current.context.renderId, staleRenderId)
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})
