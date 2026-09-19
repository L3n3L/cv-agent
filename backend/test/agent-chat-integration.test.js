import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createLogger } from '../src/core/logger.js'
import { createWorkspaceRegistry } from '../src/core/workspace-registry.js'
import { createServer } from '../src/server.js'
import { TASK_STATES } from '../src/core/workflow.js'
import { createScriptedResumeAgent } from '../scripts/support/scripted-resume-agent.js'

async function closeServer(server) {
  await server.flushLogs?.()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await server.flushLogs?.()
}

function parseSseFrames(buffer, events) {
  const frames = buffer.split(/\n\n/)
  const remainder = frames.pop() || ''
  for (const frame of frames) {
    const type = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim()
    const data = /^data:\s*(.+)$/m.exec(frame)?.[1]?.trim()
    if (!type || !data) continue
    try { events.push({ type, payload: JSON.parse(data) }) } catch { /* malformed test input is ignored */ }
  }
  return remainder
}

async function waitForSseEvents(response, predicate, timeoutMs = 5000) {
  assert.ok(response.body, 'SSE response body is required')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events = []
  let pending = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now())
      let timeoutId
      const next = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('SSE event wait timed out')), remaining) }),
      ]).finally(() => clearTimeout(timeoutId))
      if (next.done) break
      pending = parseSseFrames(pending + decoder.decode(next.value, { stream: true }), events)
      if (predicate(events)) return events
    }
    throw new Error('SSE did not emit the expected workflow events')
  } catch (error) {
    error.message = `${error.message}; received: ${events.map((event) => event.payload?.event || event.type).join(', ')}`
    throw error
  } finally {
    await reader.cancel().catch(() => {})
  }
}

async function jsonRequest(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { response, body: await response.json() }
}

test('a new user enters an empty workspace and CVAgent initializes the first resume', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-new-user-integration-'))
  const workspaceDirectory = path.join(testRoot, 'workspaces')
  const sessionDirectory = path.join(testRoot, 'sessions')
  const registry = createWorkspaceRegistry({ directory: workspaceDirectory })
  const server = createServer({
    workspaceDirectory,
    sessionDirectory,
    logger: createLogger({ directory: path.join(testRoot, 'logs'), component: 'new-user-integration-test' }),
    agentFactory: async () => { throw new Error('bootstrap must not invoke the Agent') },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}`

    const initiallyListed = await (await fetch(`${base}/api/workspaces`)).json()
    assert.deepEqual(initiallyListed.workspaces, [])

    const created = await jsonRequest(`${base}/api/workspaces/create`, { name: '我的第一份简历' })
    assert.equal(created.response.status, 201)
    assert.equal(created.body.workspace.hasResume, false)
    assert.equal(created.body.workspace.resumeName, '')
    assert.equal(Object.hasOwn(created.body.workspace, 'root'), false)

    const workspace = await registry.resolve(created.body.workspace.id)
    await assert.rejects(() => fs.stat(path.join(workspace.root, 'resume.md')), { code: 'ENOENT' })
    const sessionsBefore = await (await fetch(`${base}/api/sessions?workspaceId=${encodeURIComponent(workspace.id)}`)).json()
    assert.deepEqual(sessionsBefore.sessions, [])

    const started = await jsonRequest(`${base}/api/agent/bootstrap`, { workspaceId: workspace.id, targetPages: 1, createResume: true })
    assert.equal(started.response.status, 200)
    assert.equal(started.body.workspace.hasResume, true)
    assert.equal(started.body.source.path, 'resume.md')
    assert.match(started.body.source.content, /^# 未命名候选人/m)
    assert.match(started.body.context.renderId, /^render_/)
    assert.match(started.body.sessionId, /^session_/)
    assert.match(await fs.readFile(path.join(workspace.root, 'resume.md'), 'utf8'), /^# 未命名候选人/m)

    const initialMeasurement = await jsonRequest(`${base}/api/agent/measure`, {
      sessionId: started.body.sessionId,
      renderId: started.body.context.renderId,
      pageCount: 1,
      occupancy: [0.95],
      overflow: false,
    })
    assert.equal(initialMeasurement.response.status, 200)
    assert.equal(initialMeasurement.body.state, TASK_STATES.NEEDS_REVISION)
    assert.ok(initialMeasurement.body.verification.blockers.includes('尚未完成首次信息收集'))
    const initialSave = await jsonRequest(`${base}/api/agent/save`, { sessionId: started.body.sessionId, name: '不应保存', confirm: true })
    assert.equal(initialSave.response.status, 400)
    assert.equal(initialSave.body.errorCode, 'SAVE_NOT_ALLOWED')

    const sessionsAfter = await (await fetch(`${base}/api/sessions?workspaceId=${encodeURIComponent(workspace.id)}`)).json()
    assert.equal(sessionsAfter.sessions.length, 1)
    assert.equal(sessionsAfter.sessions[0].sessionId, started.body.sessionId)
  } finally {
    await closeServer(server)
    await fs.rm(testRoot, { recursive: true, force: true })
  }
})

test('scripted Agent preserves the MCP workflow through SSE, browser metrics, and explicit save', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-agent-chat-integration-'))
  const sessionDirectory = path.join(workspaceRoot, 'sessions')
  const logDirectory = path.join(workspaceRoot, 'logs')
  await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# 测试候选人\n\n## 教育经历\n\n测试大学 · 计算机科学\n\n## 项目经历\n\n- 完成可重复的简历制作测试。\n', 'utf8')
  const server = createServer({
    logger: createLogger({ directory: logDirectory, component: 'agent-chat-integration-test' }),
    sessionDirectory,
    agentFactory: async (options) => createScriptedResumeAgent(options),
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}`

    const bootstrapped = await jsonRequest(`${base}/api/agent/bootstrap`, { workspaceRoot, resumePath: 'resume.md', targetPages: 1 })
    assert.equal(bootstrapped.response.status, 200)
    const sessionId = bootstrapped.body.sessionId
    assert.match(sessionId, /^session_/)

    const sseResponse = await fetch(`${base}/api/agent/events?sessionId=${encodeURIComponent(sessionId)}`)
    assert.equal(sseResponse.status, 200)
    const ssePromise = waitForSseEvents(sseResponse, (events) => events.some((event) => event.payload?.event === 'verification_passed') && events.filter((event) => event.payload?.event === 'tool_call_succeeded').length >= 14 && events.some((event) => event.payload?.event === 'agent_run_finished' && event.payload?.outcome === 'success'))

    const run = await jsonRequest(`${base}/api/agent/run`, { sessionId, workspaceRoot, resumePath: 'resume.md', message: '请检查当前简历，但先不要保存。' })
    assert.equal(run.response.status, 200)
    assert.equal(run.body.state, TASK_STATES.RENDERED)
    assert.match(run.body.context.renderId, /^render_/)

    const blocked = await jsonRequest(`${base}/api/agent/measure`, {
      sessionId,
      renderId: run.body.context.renderId,
      pageCount: 2,
      occupancy: [0.4, 0.2],
      overflow: false,
    })
    assert.equal(blocked.response.status, 200)
    assert.equal(blocked.body.state, TASK_STATES.NEEDS_REVISION)
    assert.equal(blocked.body.verification.passed, false)

    const deadline = Date.now() + 5000
    let continuedSession = null
    while (Date.now() < deadline) {
      continuedSession = await (await fetch(`${base}/api/session?sessionId=${encodeURIComponent(sessionId)}`)).json()
      if (continuedSession.session?.status === TASK_STATES.RENDERED && continuedSession.context?.renderId !== run.body.context.renderId) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(blocked.body.autoContinuation.scheduled, true)
    assert.equal(continuedSession.session.status, TASK_STATES.RENDERED)
    const continued = { body: { state: continuedSession.session.status, context: continuedSession.context } }
    assert.notEqual(continued.body.context.renderId, run.body.context.renderId)

    const stale = await jsonRequest(`${base}/api/agent/measure`, {
      sessionId,
      renderId: run.body.context.renderId,
      pageCount: 1,
      occupancy: [0.95],
      overflow: false,
    })
    assert.equal(stale.response.status, 400)
    assert.equal(stale.body.errorCode, 'MEASUREMENT_STALE')

    const measured = await jsonRequest(`${base}/api/agent/measure`, {
      sessionId,
      renderId: continued.body.context.renderId,
      pageCount: 1,
      occupancy: [0.95],
      overflow: false,
    })
    assert.equal(measured.response.status, 200)
    assert.equal(measured.body.state, TASK_STATES.ACCEPTED)
    assert.equal(measured.body.verification.passed, true)
    assert.equal(measured.body.runState, 'idle')
    const acceptedSession = await (await fetch(`${base}/api/session?sessionId=${encodeURIComponent(sessionId)}`)).json()
    assert.equal(acceptedSession.session.runState, 'idle')
    assert.equal(acceptedSession.session.lastError, null)

    const sseEvents = await ssePromise
    const toolOrder = sseEvents
      .filter((event) => event.payload?.event === 'tool_call_succeeded')
      .map((event) => event.payload.toolName)
    assert.deepEqual(toolOrder, [
      'resume_prepare', 'resume_read', 'resume_check', 'resume_write', 'resume_check', 'resume_render',
      'resume_metrics', 'resume_finalize',
      'resume_prepare', 'resume_read', 'resume_check', 'resume_write', 'resume_check', 'resume_render',
      'resume_metrics', 'resume_finalize',
    ])
    assert.ok(sseEvents.some((event) => event.type === 'ready'))
    assert.ok(sseEvents.some((event) => event.payload?.event === 'verification_blocked'))
    assert.ok(sseEvents.some((event) => event.payload?.event === 'verification_passed'))
    assert.ok(sseEvents.some((event) => event.payload?.event === 'agent_run_finished' && event.payload?.outcome === 'success'))
    assert.ok(sseEvents.every((event) => event.type === 'ready' || (event.payload.sessionId === sessionId && event.payload.runId && event.payload.taskId)))

    const rejectedSave = await jsonRequest(`${base}/api/agent/save`, { sessionId, name: 'test-version' })
    assert.equal(rejectedSave.response.status, 400)
    assert.equal(rejectedSave.body.errorCode, 'SAVE_CONFIRMATION_REQUIRED')

    const saved = await jsonRequest(`${base}/api/agent/save`, { sessionId, name: 'test-version', confirm: true })
    assert.equal(saved.response.status, 200)
    assert.equal(saved.body.state, TASK_STATES.SAVED)
    assert.deepEqual(saved.body.version.templateSnapshot, {
      templateId: 'campus-standard',
      revision: 1,
      snapshotPath: null,
      fingerprint: saved.body.version.templateSnapshot.fingerprint,
      immutable: true,
    })
    assert.match(saved.body.version.templateSnapshot.fingerprint, /^[a-f0-9]{16}$/)
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'resume.md'), 'utf8'), '# 测试候选人\n\n## 教育经历\n\n测试大学 · 计算机科学\n\n## 项目经历\n\n- 完成可重复的简历制作测试。\n')

  } finally {
    await closeServer(server)
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('streaming Agent sends ordered answer deltas while keeping reasoning private', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-agent-stream-integration-'))
  const sessionDirectory = path.join(workspaceRoot, 'sessions')
  const logDirectory = path.join(workspaceRoot, 'logs')
  await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# 测试候选人\n\n## 教育经历\n\n测试大学\n', 'utf8')
  const streamChunks = async function* streamChunks(chunks) {
    for (const chunk of chunks) {
      await Promise.resolve()
      yield chunk
    }
  }
  const server = createServer({
    logger: createLogger({ directory: logDirectory, component: 'agent-stream-integration-test' }),
    sessionDirectory,
    agentFactory: async () => ({
      async streamEvents() {
        return {
          messages: (async function* messages() {
            yield {
              role: 'assistant',
              id: 'message-stream-1',
              text: streamChunks(['已读取', '当前简历。']),
              reasoning: streamChunks(['private chain of thought']),
            }
          })(),
          toolCalls: (async function* toolCalls() {})(),
          output: Promise.resolve({ messages: [{ role: 'assistant', content: '已读取当前简历。' }] }),
        }
      },
    }),
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}`
    const bootstrapped = await jsonRequest(`${base}/api/agent/bootstrap`, { workspaceRoot, resumePath: 'resume.md', targetPages: 1 })
    const sessionId = bootstrapped.body.sessionId
    const sseResponse = await fetch(`${base}/api/agent/events?sessionId=${encodeURIComponent(sessionId)}`)
    const startedAt = Date.now()
    const ssePromise = waitForSseEvents(sseResponse, (events) => events.some((event) => event.payload?.event === 'agent_run_finished'))
    const run = await jsonRequest(`${base}/api/agent/run?stream=1`, { sessionId, workspaceRoot, resumePath: 'resume.md', message: '请读取当前简历。' })
    assert.equal(run.response.status, 202)
    assert.equal(run.body.accepted, true)
    assert.ok(Date.now() - startedAt < 500, 'stream mode should acknowledge without waiting for the Agent result')
    const events = await ssePromise
    const deltas = events.filter((event) => event.payload?.event === 'assistant_delta').map((event) => event.payload.delta)
    assert.deepEqual(deltas, ['已读取', '当前简历。'])
    assert.ok(events.some((event) => event.payload?.event === 'agent_run_started' && event.payload?.reasoningSummary))
    assert.ok(events.some((event) => event.payload?.event === 'assistant_message_started'))
    assert.ok(events.some((event) => event.payload?.event === 'assistant_message_finished' && event.payload?.assistantChars === 8))
    const session = await (await fetch(`${base}/api/session?sessionId=${encodeURIComponent(sessionId)}`)).json()
    assert.ok(session.session.workflowEvents.every((event) => !String(event.delta || '').includes('private chain of thought')))
    assert.ok(session.session.workflowEvents.some((event) => event.event === 'assistant_message_finished' && event.assistantChars === 8))
    const replayResponse = await fetch(`${base}/api/agent/events?sessionId=${encodeURIComponent(sessionId)}`)
    const replayed = await waitForSseEvents(replayResponse, (replayedEvents) => replayedEvents.some((event) => event.payload?.event === 'assistant_message_finished'))
    assert.ok(replayed.some((event) => event.payload?.event === 'agent_run_started'))
    assert.ok(replayed.some((event) => event.payload?.event === 'agent_run_finished'))
  } finally {
    await closeServer(server)
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('production mode resumes automatically after a blocked browser measurement', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-auto-continue-integration-'))
  const sessionDirectory = path.join(workspaceRoot, 'sessions')
  const logDirectory = path.join(workspaceRoot, 'logs')
  await fs.writeFile(path.join(workspaceRoot, 'resume.md'), '# 测试候选人\n\n## 教育经历\n\n测试大学\n', 'utf8')
  const server = createServer({
    logger: createLogger({ directory: logDirectory, component: 'auto-continue-integration-test' }),
    sessionDirectory,
    agentFactory: async (options) => createScriptedResumeAgent(options),
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}`
    const bootstrapped = await jsonRequest(`${base}/api/agent/bootstrap`, { workspaceRoot, resumePath: 'resume.md', targetPages: 1 })
    const sessionId = bootstrapped.body.sessionId
    const run = await jsonRequest(`${base}/api/agent/run`, { sessionId, workspaceRoot, resumePath: 'resume.md', message: '帮我制作一页投递版简历，不要保存正式版。' })
    assert.equal(run.response.status, 200)
    assert.equal(run.body.executionMode, 'production')
    const measured = await jsonRequest(`${base}/api/agent/measure`, {
      sessionId,
      renderId: run.body.context.renderId,
      pageCount: 1,
      occupancy: [0.4],
      overflow: false,
    })
    assert.equal(measured.response.status, 200)
    assert.equal(measured.body.state, 'needs_revision')
    assert.equal(measured.body.autoContinuation.scheduled, true)

    const deadline = Date.now() + 5000
    let latest = null
    while (Date.now() < deadline) {
      latest = await (await fetch(`${base}/api/session?sessionId=${encodeURIComponent(sessionId)}`)).json()
      if (latest.session?.context?.renderId !== run.body.context.renderId && latest.session?.status === 'rendered') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(latest.session.executionMode, 'production')
    assert.equal(latest.session.status, 'rendered')
    assert.notEqual(latest.session.taskRef.current.context.renderId, run.body.context.renderId)
    assert.equal(latest.session.automation.continuationCount, 1)
  } finally {
    await closeServer(server)
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  }
})
