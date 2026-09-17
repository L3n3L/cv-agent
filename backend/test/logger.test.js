import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger, LOG_SCHEMA_VERSION } from '../src/core/logger.js'

async function readLogEntries(directory) {
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.ndjson')).sort()
  const entries = []
  for (const file of files) {
    const lines = (await fs.readFile(path.join(directory, file), 'utf8')).trim().split(/\r?\n/).filter(Boolean)
    entries.push(...lines.map((line) => JSON.parse(line)))
  }
  return { files, entries }
}

test('logger emits correlated schema, redacts sensitive values, and shares child sink', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-logger-'))
  try {
    const logger = createLogger({ directory, component: 'logger-test', minimumLevel: 'debug' })
    await logger.info('request started', { requestId: 'req-1', content: 'do not persist', contentVersion: 'content-1', nested: { apiKey: 'sk-1234567890abcdef' }, note: 'Bearer secret-value' })
    await logger.child({ taskId: 'task-1234567890abcdef', workspaceId: 'workspace-1' }).warn('child warning', { durationMs: 12 })
    await logger.flush()
    const { entries } = await readLogEntries(directory)
    assert.equal(entries.length, 2)
    assert.ok(entries.every((entry) => entry.schemaVersion === LOG_SCHEMA_VERSION && entry.component === 'logger-test'))
    assert.equal(entries[0].event, 'request_started')
    assert.equal(entries[0].content, '[REDACTED]')
    assert.equal(entries[0].contentVersion, 'content-1')
    assert.equal(entries[0].nested.apiKey, '[REDACTED]')
    assert.match(entries[0].note, /\[REDACTED\]/)
    assert.equal(entries[1].taskId, 'task-1234567890abcdef')
    assert.equal(entries[1].workspaceId, 'workspace-1')
    assert.ok(entries[1].sequence > entries[0].sequence)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('logger rotates oversized daily files and records timed failures', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-logger-'))
  try {
    const logger = createLogger({ directory, component: 'rotation-test', minimumLevel: 'debug', maxBytes: 300, maxFiles: 20 })
    for (let index = 0; index < 5; index += 1) await logger.info('large event', { index, detail: 'x'.repeat(180) })
    await assert.rejects(() => logger.timed('model_call', { requestId: 'req-2' }, async () => { throw Object.assign(new Error('Bearer sk-1234567890abcdef'), { code: 'MODEL_FAILED' }) }), /Bearer/)
    await logger.flush()
    const { files, entries } = await readLogEntries(directory)
    assert.ok(files.length > 1)
    assert.ok(entries.some((entry) => entry.event === 'model_call_started'))
    const failed = entries.find((entry) => entry.event === 'model_call_failed')
    assert.equal(failed.errorCode, 'MODEL_FAILED')
    assert.match(failed.errorMessage, /\[REDACTED\]/)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
