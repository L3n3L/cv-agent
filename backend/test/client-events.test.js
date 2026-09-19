import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createLogger } from '../src/core/logger.js'
import { createServer } from '../src/server.js'

async function closeServer(server) {
  await server.flushLogs?.()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await server.flushLogs?.()
}

test('client event endpoint accepts an allowlisted event and redacts sensitive values', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-client-events-'))
  const logger = createLogger({ directory, component: 'test-client-events' })
  const server = createServer({ logger })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/api/client-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'client_error', message: 'render failed', source: 'C:\\Users\\mi\\app.js', stack: 'Error token=sk-abcdefghijklmnop' }),
    })
    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), { ok: true, accepted: true })
    await logger.flush()
    const file = (await fs.readdir(directory))[0]
    const entries = (await fs.readFile(path.join(directory, file), 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line))
    const clientEvent = entries.find((entry) => entry.event === 'client_event_received')
    assert.equal(clientEvent.message, 'render failed')
    assert.equal(clientEvent.source, '[PATH]')
    assert.equal(clientEvent.stack, 'Error token=[REDACTED]')
  } finally {
    await closeServer(server)
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('client event endpoint records Agent SSE diagnostics with session and run identity', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-agent-sse-events-'))
  const logger = createLogger({ directory, component: 'test-agent-sse-events' })
  const server = createServer({ logger })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/api/client-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'agent_sse_error', message: 'connection interrupted', source: '/api/agent/events', sessionId: 'session_test', runId: 'run_test', workflowEvent: 'connection_error' }),
    })
    assert.equal(response.status, 202)
    await logger.flush()
    const file = (await fs.readdir(directory))[0]
    const entries = (await fs.readFile(path.join(directory, file), 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line))
    const clientEvent = entries.find((entry) => entry.event === 'client_event_received')
    assert.equal(clientEvent.sessionId, 'session_test')
    assert.equal(clientEvent.runId, 'run_test')
    assert.equal(clientEvent.workflowEvent, 'connection_error')
  } finally {
    await closeServer(server)
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('client event endpoint rejects unknown fields', async () => {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/api/client-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'client_error', message: 'bad payload', resumeContent: '# private resume' }),
    })
    assert.equal(response.status, 400)
    assert.deepEqual((await response.json()).errorCode, 'CLIENT_EVENT_INVALID')
  } finally {
    await closeServer(server)
  }
})
