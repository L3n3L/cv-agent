import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createLogger } from '../src/core/logger.js'
import { createResumeTools } from '../src/agent/resume-tools.js'
import { confirmResumeTask, createResumeTask, prepareResumeTask, recordDraftWrite, recordMeasurement, recordRender, saveResumeTask, TASK_STATES, verifyResumeTask } from '../src/core/workflow.js'
import { runResumeTool } from '../src/core/tool-runner.js'
import { createServer } from '../src/server.js'
import { ensureWorkspace, listWorkspacePreviews } from '../src/core/workspace.js'
import { withSessionLock } from '../src/core/session.js'
import { createSessionStore } from '../src/core/session-store.js'
import { createWorkspaceRegistry } from '../src/core/workspace-registry.js'

function task(targetPages = 1) { return createResumeTask({ workspaceId: 'workspace-1', resumeId: 'resume-1', targetPages }) }

async function closeServer(server) {
  await server.flushLogs?.()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await server.flushLogs?.()
}

test('draft writes invalidate previous render and measurement', () => {
  let current = recordDraftWrite(prepareResumeTask(task()), { contentVersion: 'content-1' })
  current = recordRender(current, { contentVersion: 'content-1', templateRevision: 'campus@1', renderId: 'render-1' })
  current = recordMeasurement(current, { contentVersion: 'content-1', templateRevision: 'campus@1', renderId: 'render-1', pageCount: 1, occupancy: [0.94] })
  assert.equal(verifyResumeTask(current).passed, true)
  const updated = recordDraftWrite(current, { contentVersion: 'content-2' })
  assert.equal(updated.state, TASK_STATES.DRAFTING)
  assert.equal(updated.context.renderId, null)
  assert.equal(updated.measurements, null)
  assert.equal(verifyResumeTask(updated).passed, false)
})

test('session operations are serialized in arrival order', async () => {
  const session = {}
  const events = []
  let releaseFirst
  const first = withSessionLock(session, async () => {
    events.push('first:start')
    await new Promise((resolve) => { releaseFirst = resolve })
    events.push('first:end')
  })
  const second = withSessionLock(session, async () => { events.push('second') })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['first:start', 'first:end', 'second'])
})

test('session store survives restart and marks interrupted runs for recovery', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-session-store-'))
  try {
    const store = createSessionStore({ directory })
    const session = {
      sessionId: 'session_restart_test',
      workspaceId: 'workspace-1',
      workspaceRoot: 'E:/resume-workspace',
      resumePath: 'resume.md',
      sourceHash: 'source-1',
      status: 'drafting',
      runState: 'running',
      taskRef: { current: task(), presentation: null, presentationRevision: 1 },
      messages: [{ role: 'user', content: '继续完善简历' }],
    }
    await store.save(session, { event: 'agent_run_started', state: 'drafting' })

    const restarted = createSessionStore({ directory })
    const restored = await restarted.load(session.sessionId)
    assert.equal(restored.runState, 'interrupted')
    assert.equal(restored.status, 'interrupted')
    assert.equal(restored.lastError.code, 'SESSION_INTERRUPTED')
    assert.equal(restored.sourceHash, 'source-1')
    assert.equal(restored.messages[0].content, '继续完善简历')
    const eventLines = (await fs.readFile(path.join(directory, session.sessionId, 'events.ndjson'), 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line))
    assert.equal(eventLines[0].event, 'agent_run_started')
    assert.equal(eventLines[0].state, 'drafting')
    assert.deepEqual((await restarted.list()).map((item) => item.sessionId), [session.sessionId])
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('agent exposes one canonical MCP-aligned resume workflow surface', () => {
  const tools = createResumeTools({ workspaceRoot: 'E:/resume-workspace', resumePath: 'resume.md', taskRef: { current: task() }, includeMeasurementTool: true })
  const names = tools.map((item) => item.name)
  for (const name of ['resume_prepare', 'resume_read', 'resume_check', 'resume_write', 'resume_render', 'resume_metrics', 'resume_finalize']) assert.ok(names.includes(name), `${name} is missing`)
  for (const name of ['resume_inspect', 'resume_quality_check', 'resume_draft_write', 'resume_measure', 'resume_verify']) assert.ok(!names.includes(name), `${name} is a stale duplicate`)
  assert.equal(new Set(names).size, names.length)
})

test('task context preserves the selected template identity from the first render', () => {
  const current = createResumeTask({ workspaceId: 'workspace-1', resumeId: 'resume-1', templateId: 'business-ledger-plus', templateRevision: 'business-ledger-plus@1' })
  assert.equal(current.context.templateId, 'business-ledger-plus')
  assert.equal(current.context.templateRevision, 'business-ledger-plus@1')
})

test('workspace preview listing is deterministic and excludes isolated CVAgent artifacts', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-previews-'))
  await fs.mkdir(path.join(workspaceRoot, 'companies', 'alpha'), { recursive: true })
  await fs.mkdir(path.join(workspaceRoot, '.cvagent', 'renders'), { recursive: true })
  await fs.writeFile(path.join(workspaceRoot, 'preview.html'), '<main></main>')
  await fs.writeFile(path.join(workspaceRoot, 'companies', 'alpha', 'preview.html'), '<main></main>')
  await fs.writeFile(path.join(workspaceRoot, '.cvagent', 'renders', 'preview.html'), '<main></main>')
  const result = await listWorkspacePreviews(workspaceRoot)
  assert.deepEqual(result.previews, ['companies/alpha/preview.html', 'preview.html'])
})

test('missing measurement returns a blocked task snapshot, not only a label', () => {
  const current = recordDraftWrite(prepareResumeTask(task()), { contentVersion: 'content-1' })
  const result = verifyResumeTask(current)
  assert.equal(result.state, TASK_STATES.BLOCKED)
  assert.equal(result.task.state, TASK_STATES.BLOCKED)
  assert.deepEqual(result.task.blockers, result.blockers)
})

test('sparse pages are blocked and successful tasks require confirmation', () => {
  let current = recordDraftWrite(prepareResumeTask(task(2)), { contentVersion: 'content-1' })
  current = recordRender(current, { contentVersion: 'content-1', templateRevision: 'campus@1', renderId: 'render-1' })
  current = recordMeasurement(current, { contentVersion: 'content-1', templateRevision: 'campus@1', renderId: 'render-1', pageCount: 2, occupancy: [0.95, 0.72] })
  const blocked = verifyResumeTask(current)
  assert.equal(blocked.passed, false)
  assert.equal(blocked.state, TASK_STATES.NEEDS_REVISION)
  assert.throws(() => confirmResumeTask(current), /invalid resume task transition/)

  current = recordDraftWrite(blocked.task, { contentVersion: 'content-2' })
  current = recordRender(current, { contentVersion: 'content-2', templateRevision: 'campus@1', renderId: 'render-2' })
  current = recordMeasurement(current, { contentVersion: 'content-2', templateRevision: 'campus@1', renderId: 'render-2', pageCount: 2, occupancy: [0.93, 0.91] })
  const accepted = verifyResumeTask(current)
  current = confirmResumeTask(accepted.task)
  assert.equal(saveResumeTask(current).state, TASK_STATES.SAVED)
})

test('tool events are structured, ordered, and correlated', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-log-'))
  try {
    const logger = createLogger({ directory, component: 'test-agent' })
    const current = task()
    await runResumeTool(current, 'resume_read', async () => ({ moduleCount: 3 }), { logger, resultSummary: (result) => result })
    await assert.rejects(() => runResumeTool(current, 'resume_render', async () => { throw Object.assign(new Error('render failed'), { code: 'RENDER_FAILED' }) }, { logger }))
    await logger.flush()
    const file = (await fs.readdir(directory))[0]
    const entries = (await fs.readFile(path.join(directory, file), 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line))
    assert.deepEqual(entries.map((entry) => entry.event), ['tool_call_started', 'tool_call_succeeded', 'tool_call_started', 'tool_call_failed'])
    assert.ok(entries.every((entry) => entry.workspaceId === 'workspace-1' && entry.resumeId === 'resume-1'))
    assert.equal(entries.at(-1).errorCode, 'RENDER_FAILED')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('standalone server exposes an independent health endpoint', async () => {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const response = await fetch(`http://127.0.0.1:${address.port}/health`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, product: 'CVAgent' })
    const home = await fetch(`http://127.0.0.1:${address.port}/`)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /CVAgent/)
  } finally {
    await closeServer(server)
  }
})

test('asset endpoint serves workspace images without exposing metadata or traversal', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-assets-'))
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await fs.writeFile(path.join(workspaceRoot, 'avatar.png'), image)
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const base = `http://127.0.0.1:${address.port}/api/asset?workspaceRoot=${encodeURIComponent(workspaceRoot)}`
    const response = await fetch(`${base}&path=${encodeURIComponent('avatar.png')}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image)

    const metadata = await fetch(`${base}&path=${encodeURIComponent('.cvagent/workspace.json')}`)
    assert.equal(metadata.status, 400)
    const traversal = await fetch(`${base}&path=${encodeURIComponent('../avatar.png')}`)
    assert.equal(traversal.status, 400)
  } finally {
    await closeServer(server)
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('template workshop and version management persist outside an Agent session', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-management-'))
  await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# Resume\n\nEvidence\n', 'utf8')
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const base = `http://127.0.0.1:${address.port}`
    const encodedRoot = encodeURIComponent(workspaceRoot)
    const copyResponse = await fetch(`${base}/api/templates/copy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceRoot, sourceTemplateId: 'campus-standard', newTemplateId: 'management-copy', name: 'Management Copy' }) })
    const copied = await copyResponse.json()
    assert.equal(copyResponse.status, 200)
    assert.equal(copied.result.template.id, 'management-copy')
    const readResponse = await fetch(`${base}/api/template?workspaceRoot=${encodedRoot}&id=management-copy`)
    const read = await readResponse.json()
    assert.equal(read.template.id, 'management-copy')
    assert.match(read.template.templateCss, /data-template-id="management-copy"/)
    const versionsDir = path.join(workspaceRoot, '.cvagent', 'versions', 'version_test')
    await fs.mkdir(versionsDir, { recursive: true })
    await fs.writeFile(path.join(versionsDir, 'resume.md'), '# Version\n\nEvidence\n', 'utf8')
    await fs.writeFile(path.join(versionsDir, 'version.json'), JSON.stringify({ schemaVersion: 1, id: 'version_test', name: '旧名称', resumePath: '.cvagent/versions/version_test/resume.md', savedAt: new Date().toISOString() }))
    const versionResponse = await fetch(`${base}/api/version?workspaceRoot=${encodedRoot}&versionId=version_test`)
    const versionBody = await versionResponse.json()
    assert.equal(versionResponse.status, 200)
    assert.match(versionBody.version.content, /# Version/)
    const renameResponse = await fetch(`${base}/api/versions/rename`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceRoot, versionId: 'version_test', name: '新名称' }) })
    assert.equal(renameResponse.status, 200)
    const archiveResponse = await fetch(`${base}/api/versions/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceRoot, versionId: 'version_test' }) })
    assert.equal(archiveResponse.status, 200)
    const visible = await (await fetch(`${base}/api/versions?workspaceRoot=${encodedRoot}`)).json()
    assert.equal(visible.versions.length, 0)
    const archived = await (await fetch(`${base}/api/versions?workspaceRoot=${encodedRoot}&includeArchived=true`)).json()
    assert.equal(archived.versions[0].name, '新名称')
    assert.equal(archived.versions[0].archived, true)
  } finally {
    await closeServer(server)
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('workspace drafts are isolated from the source resume and tools advance task state', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-workspace-'))
  try {
    const source = '# Source Resume\n\nOriginal content\n'
    await fs.writeFile(path.join(workspaceRoot, 'resume.md'), source, 'utf8')
    await fs.mkdir(path.join(workspaceRoot, 'materials'), { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, 'materials', 'facts.md'), '# Facts\n\nHigh signal evidence\n', 'utf8')
    const workspace = await ensureWorkspace(workspaceRoot, 'test-workspace')
    const taskRef = { current: prepareResumeTask(createResumeTask({ workspaceId: workspace.id, resumeId: 'resume.md' })) }
    const tools = createResumeTools({ workspaceRoot, resumePath: 'resume.md', taskRef, logger: createLogger({ directory: path.join(workspaceRoot, 'test-logs') }), includeMeasurementTool: true })
    const prepared = await tools.find((tool) => tool.name === 'resume_prepare').invoke({})
    assert.equal(prepared.prepared, true)
    assert.equal(prepared.nextTool, 'resume_read')
    const inspected = await tools.find((tool) => tool.name === 'resume_read').invoke({ includeContent: true })
    assert.equal(inspected.content, source)
    const materials = await tools.find((tool) => tool.name === 'workspace_materials_list').invoke({ maxFiles: 100, maxDepth: 4 })
    assert.deepEqual(materials.files.map((file) => file.path), ['materials/facts.md', 'resume.md'])
    const material = await tools.find((tool) => tool.name === 'workspace_material_read').invoke({ path: 'materials/facts.md' })
    assert.match(material.content, /High signal evidence/)
    const written = await tools.find((tool) => tool.name === 'resume_write').invoke({ content: '# Draft Resume\n\nImproved content\n' })
    assert.equal(written.sourcePreserved, true)
    assert.equal(taskRef.current.state, TASK_STATES.DRAFTING)
    const currentInspection = await tools.find((tool) => tool.name === 'resume_read').invoke({ includeContent: true })
    assert.equal(currentInspection.content, '# Draft Resume\n\nImproved content\n')
    const rendered = await tools.find((tool) => tool.name === 'resume_render').invoke({})
    assert.equal(taskRef.current.state, TASK_STATES.RENDERED)
    assert.ok(rendered.relativePath.endsWith('/preview.html'))
    assert.equal(await fs.stat(path.join(workspaceRoot, ...rendered.relativePath.split('/'))).then((stat) => stat.isFile()), true)
    await tools.find((tool) => tool.name === 'resume_metrics').invoke({ renderId: rendered.renderId, pageCount: 1, occupancy: [0.94], overflow: false })
    const verification = await tools.find((tool) => tool.name === 'resume_finalize').invoke({})
    assert.equal(verification.passed, true)
    assert.equal(verification.completionAllowed, true)
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'resume.md'), 'utf8'), source)
    assert.equal((await fs.readdir(path.join(workspaceRoot, '.cvagent', 'drafts', taskRef.current.context.taskId))).length, 1)
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('MCP workflow emits a complete production audit sequence with stable correlation', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-audit-'))
  const logDirectory = path.join(workspaceRoot, 'logs')
  try {
    await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# Resume\n\n## Experience\n\n- Evidence\n', 'utf8')
    const workspace = await ensureWorkspace(workspaceRoot, 'audit-test')
    const taskRef = { current: prepareResumeTask(createResumeTask({ workspaceId: workspace.id, resumeId: 'resume.md' })) }
    const logger = createLogger({ directory: logDirectory, minimumLevel: 'debug', component: 'audit-test' })
    const tools = createResumeTools({ sessionId: 'session_audit', workspaceRoot, resumePath: 'resume.md', taskRef, logger, includeMeasurementTool: true })
    const invoke = (name, input = {}) => tools.find((item) => item.name === name).invoke(input)

    await invoke('resume_prepare')
    await invoke('resume_write', { content: '# Resume\n\n## Experience\n\n- Evidence\n' })
    const rendered = await invoke('resume_render')
    await invoke('resume_metrics', { renderId: rendered.renderId, pageCount: 1, occupancy: [0.94], overflow: false })
    const verification = await invoke('resume_finalize')
    assert.equal(verification.passed, true)

    const blockedTaskRef = { current: prepareResumeTask(createResumeTask({ workspaceId: workspace.id, resumeId: 'resume.md' })) }
    const blockedTools = createResumeTools({ sessionId: 'session_blocked', workspaceRoot, resumePath: 'resume.md', taskRef: blockedTaskRef, logger, includeMeasurementTool: true })
    const invokeBlocked = (name, input = {}) => blockedTools.find((item) => item.name === name).invoke(input)
    await invokeBlocked('resume_write', { content: '# Resume\n\n## Experience\n\n- Evidence\n' })
    await invokeBlocked('resume_render')
    const blocked = await invokeBlocked('resume_finalize')
    assert.equal(blocked.passed, false)

    const preRenderTaskRef = { current: prepareResumeTask(createResumeTask({ workspaceId: workspace.id, resumeId: 'resume.md' })) }
    const preRenderTools = createResumeTools({ sessionId: 'session_pre_render_blocked', workspaceRoot, resumePath: 'resume.md', taskRef: preRenderTaskRef, logger, includeMeasurementTool: true })
    await preRenderTools.find((item) => item.name === 'resume_write').invoke({ content: '# Resume\n\n## Experience\n\n- Evidence\n' })
    const preRenderBlocked = await preRenderTools.find((item) => item.name === 'resume_finalize').invoke({})
    assert.equal(preRenderBlocked.passed, false)
    await logger.flush()

    const files = (await fs.readdir(logDirectory)).filter((name) => name.endsWith('.ndjson'))
    const entries = []
    for (const file of files) entries.push(...(await fs.readFile(path.join(logDirectory, file), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)))
    const events = entries.map((entry) => entry.event)
    assert.ok(events.includes('artifact_written'))
    assert.ok(events.includes('render_started'))
    assert.ok(events.includes('render_succeeded'))
    assert.ok(events.includes('measurement_received'))
    assert.ok(events.includes('verification_passed'))
    assert.ok(events.includes('verification_blocked'))
    const businessEvents = entries.filter((entry) => ['artifact_written', 'render_started', 'render_succeeded', 'measurement_received', 'verification_passed'].includes(entry.event))
    assert.ok(businessEvents.every((entry) => entry.sessionId && entry.runId && entry.taskId && entry.workspaceId && entry.resumeId))
    const renderEvents = entries.filter((entry) => entry.sessionId === 'session_audit' && ['render_started', 'render_succeeded', 'measurement_received', 'verification_passed'].includes(entry.event))
    assert.ok(renderEvents.every((entry) => entry.contentVersion && entry.templateRevision && entry.renderId === rendered.renderId))
    const blockedEntry = entries.find((entry) => entry.event === 'verification_blocked')
    assert.ok(blockedEntry.contentVersion && blockedEntry.templateRevision && blockedEntry.renderId)
    const preRenderBlockedEntry = entries.find((entry) => entry.sessionId === 'session_pre_render_blocked' && entry.event === 'verification_blocked')
    assert.ok(preRenderBlockedEntry)
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('migrated template catalog and presentation tuning are first-class tools', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-template-'))
  try {
    await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# Resume\n\n## Experience\n\n- Evidence\n', 'utf8')
    const workspace = await ensureWorkspace(workspaceRoot, 'template-test')
    const taskRef = { current: prepareResumeTask(createResumeTask({ workspaceId: workspace.id, resumeId: 'resume.md' })), presentation: null, presentationRevision: 1 }
    const tools = createResumeTools({ workspaceRoot, resumePath: 'resume.md', taskRef, logger: createLogger({ directory: path.join(workspaceRoot, 'logs') }) })
    const templates = await tools.find((item) => item.name === 'template_list').invoke({})
    assert.ok(templates.templates.length >= 6)
    assert.ok(templates.templates.some((item) => item.id === 'campus-standard'))
    const quality = await tools.find((item) => item.name === 'resume_check').invoke({ target: 'source', targetPages: 1 })
    assert.equal(quality.passed, true)
    const copied = await tools.find((item) => item.name === 'template_copy').invoke({ sourceTemplateId: 'campus-standard', newTemplateId: 'campus-test-copy', name: 'Campus Test Copy' })
    assert.equal(copied.createdAsCopy, true)
    assert.match(await fs.readFile(path.join(workspaceRoot, 'templates', 'campus-test-copy.css'), 'utf8'), /data-template-id="campus-test-copy"/)
    await tools.find((item) => item.name === 'template_select').invoke({ templateId: 'business-ledger-plus' })
    assert.equal(taskRef.current.context.templateId, 'business-ledger-plus')
    await tools.find((item) => item.name === 'resume_write').invoke({ content: '# Resume\n\n## Experience\n\n- Evidence\n' })
    await tools.find((item) => item.name === 'presentation_update').invoke({ layout: { fontSize: 13.5, lineHeight: 1.5 }, visual: { accentColor: '#2563eb' }, iconTuning: { github: { scale: 1.1 } } })
    const rendered = await tools.find((item) => item.name === 'resume_render').invoke({})
    const html = await fs.readFile(rendered.absolutePath, 'utf8')
    assert.match(html, /data-template-id="business-ledger-plus"/)
    assert.match(html, /fontSize\\?":13\.5/)
    assert.match(html, /data-template-css/)
    assert.match(html, /data-render-id=/)
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('agent run endpoint accepts an injected agent without calling a model', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-api-'))
  const logDirectory = path.join(workspaceRoot, 'test-logs')
  await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# Resume\n\nExisting\n', 'utf8')
  const server = createServer({
    logger: createLogger({ directory: logDirectory, component: 'api-test' }),
    sessionDirectory: path.join(workspaceRoot, 'sessions'),
    agentFactory: async ({ tools }) => ({
      invoke: async () => {
        const inspect = await tools.find((tool) => tool.name === 'resume_read').invoke({ includeContent: true })
        await tools.find((tool) => tool.name === 'resume_write').invoke({ content: `${inspect.content}\n\n# Added\n\nEvidence\n` })
        return { messages: [{ role: 'assistant', content: 'Draft written for review.' }] }
      },
    }),
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Improve this resume', workspaceRoot, resumePath: 'resume.md' }) })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.state, TASK_STATES.DRAFTING)
    assert.equal(body.assistantText, 'Draft written for review.')
    assert.ok(body.context.runId)
    const second = await fetch(`http://127.0.0.1:${address.port}/api/agent/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Continue the same task', sessionId: body.sessionId, workspaceRoot, resumePath: 'resume.md' }) })
    assert.equal(second.status, 200)
    await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# External change\n\nNew source\n', 'utf8')
    const sourceChanged = await fetch(`http://127.0.0.1:${address.port}/api/agent/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Continue after external edit', sessionId: body.sessionId, workspaceRoot, resumePath: 'resume.md' }) })
    assert.equal(sourceChanged.status, 400)
    const scopeMismatch = await fetch(`http://127.0.0.1:${address.port}/api/agent/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Switch source', sessionId: body.sessionId, workspaceRoot, resumePath: 'other.md' }) })
    assert.equal(scopeMismatch.status, 400)
    const rejectedSave = await fetch(`http://127.0.0.1:${address.port}/api/agent/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: body.sessionId, confirm: false }) })
    assert.equal(rejectedSave.status, 400)
    await server.flushLogs()
    const logFiles = (await fs.readdir(logDirectory)).filter((name) => name.endsWith('.ndjson'))
    const logEntries = []
    for (const file of logFiles) logEntries.push(...(await fs.readFile(path.join(logDirectory, file), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)))
    assert.ok(logEntries.some((entry) => entry.event === 'source_changed'))
    assert.ok(logEntries.some((entry) => entry.event === 'save_rejected'))
  } finally {
    await closeServer(server)
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('bootstrap creates an isolated preview session without invoking an agent', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-bootstrap-'))
  await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# Bootstrap Resume\n\nExisting evidence\n', 'utf8')
  const sessionDirectory = path.join(workspaceRoot, 'sessions')
  let server = createServer({ logger: createLogger({ directory: path.join(workspaceRoot, 'test-logs'), component: 'bootstrap-test' }), sessionDirectory })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceRoot, resumePath: 'resume.md', targetPages: 1, templateId: 'campus-standard' }) })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.state, TASK_STATES.RENDERED)
    assert.ok(body.sessionId)
    assert.ok(body.context.renderId)
    assert.equal(body.source.content, '# Bootstrap Resume\n\nExisting evidence\n')
    const preview = await fetch(`http://127.0.0.1:${address.port}/api/agent/preview?sessionId=${encodeURIComponent(body.sessionId)}`)
    assert.equal(preview.status, 200)
    assert.match(await preview.text(), /data-product="CVAgent"/)
    const listed = await (await fetch(`http://127.0.0.1:${address.port}/api/sessions?workspaceRoot=${encodeURIComponent(workspaceRoot)}`)).json()
    assert.deepEqual(listed.sessions.map((item) => item.sessionId), [body.sessionId])
    const persisted = await (await fetch(`http://127.0.0.1:${address.port}/api/session?sessionId=${encodeURIComponent(body.sessionId)}`)).json()
    assert.equal(persisted.session.taskRef.current.state, TASK_STATES.RENDERED)
    await closeServer(server)
    server = createServer({ logger: createLogger({ directory: path.join(workspaceRoot, 'test-logs-2'), component: 'bootstrap-restart-test' }), sessionDirectory })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const restartedAddress = server.address()
    const restored = await (await fetch(`http://127.0.0.1:${restartedAddress.port}/api/session?sessionId=${encodeURIComponent(body.sessionId)}`)).json()
    assert.equal(restored.session.taskRef.current.state, TASK_STATES.RENDERED)
    assert.equal((await fetch(`http://127.0.0.1:${restartedAddress.port}/api/agent/preview?sessionId=${encodeURIComponent(body.sessionId)}`)).status, 200)
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'resume.md'), 'utf8'), '# Bootstrap Resume\n\nExisting evidence\n')
  } finally {
    if (server.listening) await closeServer(server)
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('workspace selection imports a managed workspace and drives the agent by opaque id', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-workspace-selection-'))
  const workspaceDirectory = path.join(testRoot, 'managed-workspaces')
  const sessionDirectory = path.join(testRoot, 'sessions')
  const registry = createWorkspaceRegistry({ directory: workspaceDirectory })
  const imported = await registry.importFiles({
    name: '我的简历工作区',
    files: [
      { path: 'resume.md', encoding: 'utf8', content: '# Candidate\n\n## Experience\n\n- Built a product workflow\n' },
      { path: 'materials/evidence.md', encoding: 'utf8', content: '# Evidence\n\n- Measurable result\n' },
    ],
  })
  assert.match(imported.id, /^ws_[A-Za-z0-9-]+$/)
  assert.equal(imported.resumePath, 'resume.md')
  assert.equal(await fs.readFile(path.join(imported.root, 'resume.md'), 'utf8'), '# Candidate\n\n## Experience\n\n- Built a product workflow\n')
  await assert.rejects(() => registry.importFiles({ name: 'bad', files: [{ path: '../escape.md', encoding: 'utf8', content: 'nope' }] }), { code: 'WORKSPACE_INVALID' })

  const server = createServer({ workspaceDirectory, sessionDirectory, logger: createLogger({ directory: path.join(testRoot, 'logs'), component: 'workspace-selection-test' }) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const base = `http://127.0.0.1:${address.port}`
    const listed = await (await fetch(`${base}/api/workspaces`)).json()
    assert.deepEqual(listed.workspaces.map((workspace) => workspace.id), [imported.id])
    assert.equal(Object.hasOwn(listed.workspaces[0], 'root'), false)

    const source = await (await fetch(`${base}/api/source?workspaceId=${encodeURIComponent(imported.id)}`)).json()
    assert.equal(source.content, '# Candidate\n\n## Experience\n\n- Built a product workflow\n')
    const bootstrap = await (await fetch(`${base}/api/agent/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: imported.id, targetPages: 1, templateId: 'campus-standard' }) })).json()
    assert.equal(bootstrap.ok, true)
    assert.equal(bootstrap.workspace.id, imported.id)
    assert.equal(Object.hasOwn(bootstrap.workspace, 'root'), false)
    const session = await (await fetch(`${base}/api/session?sessionId=${encodeURIComponent(bootstrap.sessionId)}`)).json()
    assert.equal(session.workspace.id, imported.id)
    assert.equal(Object.hasOwn(session.session, 'workspaceRoot'), false)
  } finally {
    await closeServer(server)
    await fs.rm(testRoot, { recursive: true, force: true })
  }
})

test('measurement callback verifies the exact rendered artifact', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-measure-'))
  await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# Resume\n\nEvidence\n', 'utf8')
  const server = createServer({
    logger: createLogger({ directory: path.join(workspaceRoot, 'test-logs'), component: 'measure-test' }),
    sessionDirectory: path.join(workspaceRoot, 'sessions'),
    agentFactory: async ({ tools }) => ({
      invoke: async () => {
        const inspect = await tools.find((tool) => tool.name === 'resume_read').invoke({ includeContent: true })
        await tools.find((tool) => tool.name === 'resume_write').invoke({ content: inspect.content })
        await tools.find((tool) => tool.name === 'resume_render').invoke({})
        return { messages: [{ role: 'assistant', content: 'Rendered. Waiting for browser measurement.' }] }
      },
    }),
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const runResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Prepare a draft', workspaceRoot, resumePath: 'resume.md', targetPages: 1 }) })
    const run = await runResponse.json()
    const previewResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/preview?sessionId=${encodeURIComponent(run.sessionId)}`)
    assert.equal(previewResponse.status, 200)
    assert.match(await previewResponse.text(), /data-product="CVAgent"/)
    const measureResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/measure`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: run.sessionId, renderId: run.context.renderId, pageCount: 1, occupancy: [0.95], overflow: false }) })
    const measured = await measureResponse.json()
    assert.equal(measureResponse.status, 200)
    assert.equal(measured.verification.passed, true)
    assert.equal(measured.state, TASK_STATES.ACCEPTED)
    const saveWithoutConfirmation = await fetch(`http://127.0.0.1:${address.port}/api/agent/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: run.sessionId, name: 'Accepted Resume' }) })
    assert.equal(saveWithoutConfirmation.status, 400)
    const saveResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: run.sessionId, name: 'Accepted Resume', confirm: true }) })
    const saved = await saveResponse.json()
    assert.equal(saveResponse.status, 200)
    assert.equal(saved.state, TASK_STATES.SAVED)
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'resume.md'), 'utf8'), '# Resume\n\nEvidence\n')
    const stale = await fetch(`http://127.0.0.1:${address.port}/api/agent/measure`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: run.sessionId, renderId: 'render_old', pageCount: 1, occupancy: [0.99], overflow: false }) })
    assert.equal(stale.status, 400)
  } finally {
    await closeServer(server)
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})
