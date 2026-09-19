import assert from 'node:assert/strict'
import test from 'node:test'
import { isSameAgentRun, mergeSessionMessages, projectWorkflowTimeline, runEventStatus, workflowGroupHasAssistantText } from '../../frontend/react/src/runtime/agent-chat-state.js'

test('agent chat state keeps failure visible and does not downgrade it to done', () => {
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'agent_run_finished', outcome: 'success' }]), 'done')
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'agent_run_finished', outcome: 'failed' }]), 'failed')
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'tool_call_failed' }]), 'blocked')
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'agent_run_paused' }]), 'waiting')
  assert.equal(runEventStatus([
    { event: 'agent_run_started' },
    { event: 'agent_run_paused' },
    { event: 'agent_run_finished', outcome: 'paused' },
    { event: 'tool_call_succeeded', toolName: 'resume_finalize' },
    { event: 'agent_run_finished', outcome: 'success' },
  ]), 'done')
  assert.equal(runEventStatus([
    { event: 'agent_run_started' },
    { event: 'tool_call_failed' },
    { event: 'agent_run_finished', outcome: 'success' },
  ]), 'done')
  assert.equal(runEventStatus([]), 'idle')
})

test('workflow timeline preserves assistant and tool arrival order while terminal tool events update in place', () => {
  const entries = projectWorkflowTimeline([
    { event: 'agent_run_started', timestamp: '2026-09-19T04:00:00.000Z' },
    { event: 'assistant_message_started', messageId: 'm1', timestamp: '2026-09-19T04:00:01.000Z' },
    { event: 'assistant_delta', messageId: 'm1', delta: '先读取', timestamp: '2026-09-19T04:00:02.000Z' },
    { event: 'tool_call_started', toolCallId: 't1', toolName: 'resume_read', timestamp: '2026-09-19T04:00:03.000Z' },
    { event: 'tool_call_succeeded', toolCallId: 't1', toolName: 'resume_read', durationMs: 28, timestamp: '2026-09-19T04:00:04.000Z' },
    { event: 'assistant_message_started', messageId: 'm2', timestamp: '2026-09-19T04:00:05.000Z' },
    { event: 'assistant_delta', messageId: 'm2', delta: '再检查', timestamp: '2026-09-19T04:00:06.000Z' },
    { event: 'tool_call_started', toolCallId: 't2', toolName: 'resume_check', timestamp: '2026-09-19T04:00:07.000Z' },
    { event: 'tool_call_failed', toolCallId: 't2', toolName: 'resume_check', errorCode: 'CHECK_FAILED', timestamp: '2026-09-19T04:00:08.000Z' },
  ])
  assert.deepEqual(entries.map((entry) => entry.kind), ['assistant', 'tool', 'assistant', 'tool'])
  assert.equal(entries[0].text, '先读取')
  assert.equal(entries[1].state, 'done')
  assert.equal(entries[1].durationMs, 28)
  assert.equal(entries[3].state, 'blocked')
  assert.equal(entries[3].detail, 'CHECK_FAILED')
})

test('agent chat state preserves a local optimistic turn only as a suffix', () => {
  const persisted = [{ role: 'user', content: '旧消息' }]
  const local = [...persisted, { role: 'assistant', content: '流式中的回答' }]
  assert.deepEqual(mergeSessionMessages(persisted, local), local)
  assert.deepEqual(mergeSessionMessages(local, persisted), local)
})

test('agent chat state marks a workflow group as the source of assistant text after streaming', () => {
  const group = { events: [
    { event: 'assistant_message_started', messageId: 'm1' },
    { event: 'assistant_delta', messageId: 'm1', delta: '读取完成。' },
    { event: 'assistant_message_finished', messageId: 'm1' },
  ] }
  assert.equal(workflowGroupHasAssistantText(group), true)
  assert.equal(workflowGroupHasAssistantText({ events: [{ event: 'tool_call_succeeded' }] }), false)
})

test('agent chat state ignores stale run events', () => {
  assert.equal(isSameAgentRun({ runId: 'run-current' }, 'run-current'), true)
  assert.equal(isSameAgentRun({ runId: 'run-old' }, 'run-current'), false)
  assert.equal(isSameAgentRun({ event: 'agent_run_started' }, 'run-current'), true)
})
