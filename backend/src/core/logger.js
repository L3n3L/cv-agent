import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 })
export const LOG_SCHEMA_VERSION = 1

const REDACTED = '[REDACTED]'
const RESERVED_FIELDS = new Set(['timestamp', 'level', 'event', 'component', 'pid', 'hostname', 'schemaVersion', 'sequence'])
const REDACT_KEY = /(?:content(?!version|hash|id|length|count)|markdown|html|prompt|messages|secret|password|token|api[_-]?key|access[_-]?token|authorization|cookie|private[_-]?key|credential)/i
const SECRET_TOKEN_PATTERN = /\b(?:sk|rk)-[a-z0-9_-]{12,}/gi
const BEARER_PATTERN = /\bbearer\s+[^\s,;)}\]]+/gi
const ASSIGNMENT_SECRET_PATTERN = /((?:api[_-]?key|access[_-]?token|token|password)\s*[:=]\s*)[^\s,;)}\]\[]+/gi
const LOG_FILE_PATTERN = /^agent-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.ndjson$/

function redactString(value) {
  return String(value)
    .replace(SECRET_TOKEN_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(ASSIGNMENT_SECRET_PATTERN, `$1${REDACTED}`)
}

export function sanitizeLogValue(value, depth = 0, key = '') {
  if (REDACT_KEY.test(key)) return REDACTED
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return redactString(value.length > 4000 ? `${value.slice(0, 4000)}…` : value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (depth >= 5) return '[TRUNCATED]'
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeLogValue(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 120).map(([entryKey, entryValue]) => [entryKey, sanitizeLogValue(entryValue, depth + 1, entryKey)]))
  }
  return String(value)
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function normalizeLevel(level) {
  const normalized = String(level || 'info').toLowerCase()
  return Object.hasOwn(LOG_LEVELS, normalized) ? normalized : 'info'
}

function normalizeEvent(event) {
  const normalized = String(event || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return normalized || 'unknown'
}

function positiveInteger(value, fallback, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) return fallback
  return Math.min(number, maximum)
}

function mergeFields(baseContext, fields) {
  const sanitized = sanitizeLogValue(fields || {})
  return Object.fromEntries(Object.entries({ ...baseContext, ...(sanitized && typeof sanitized === 'object' ? sanitized : {}) }).filter(([key]) => !RESERVED_FIELDS.has(key)))
}

function createSink(options) {
  return {
    directory: path.resolve(options.directory || process.env.CVAGENT_LOG_DIR || path.join(process.cwd(), 'logs')),
    maxBytes: positiveInteger(options.maxBytes ?? process.env.CVAGENT_LOG_MAX_BYTES, 10 * 1024 * 1024, 250 * 1024 * 1024),
    retentionDays: positiveInteger(options.retentionDays ?? process.env.CVAGENT_LOG_RETENTION_DAYS, 30, 3650),
    maxFiles: positiveInteger(options.maxFiles ?? process.env.CVAGENT_LOG_MAX_FILES, 100, 10000),
    queue: Promise.resolve(),
    sequence: 0,
    activeDate: '',
    activePath: '',
    activeBytes: 0,
    prunedDate: '',
    warned: false,
  }
}

async function chooseActiveFile(sink, stamp, lineBytes) {
  if (sink.activeDate !== stamp || !sink.activePath) {
    sink.activeDate = stamp
    sink.activePath = path.join(sink.directory, `agent-${stamp}.ndjson`)
    const stat = await fs.stat(sink.activePath).catch(() => null)
    sink.activeBytes = stat?.size || 0
  }
  if (sink.activeBytes + lineBytes <= sink.maxBytes || sink.activeBytes === 0) return sink.activePath

  let suffix = 1
  let rotatedPath = path.join(sink.directory, `agent-${stamp}.${suffix}.ndjson`)
  while (await fs.access(rotatedPath).then(() => true).catch(() => false)) {
    suffix += 1
    rotatedPath = path.join(sink.directory, `agent-${stamp}.${suffix}.ndjson`)
  }
  await fs.rename(sink.activePath, rotatedPath)
  sink.activeBytes = 0
  return sink.activePath
}

async function pruneLogs(sink, stamp) {
  if (sink.prunedDate === stamp) return
  sink.prunedDate = stamp
  const entries = await fs.readdir(sink.directory, { withFileTypes: true }).catch(() => [])
  const files = entries.filter((entry) => entry.isFile() && LOG_FILE_PATTERN.test(entry.name)).map((entry) => entry.name).sort().reverse()
  const cutoff = Date.now() - sink.retentionDays * 24 * 60 * 60 * 1000
  for (const [index, file] of files.entries()) {
    const target = path.join(sink.directory, file)
    const stat = await fs.stat(target).catch(() => null)
    if (index >= sink.maxFiles || (stat && stat.mtimeMs < cutoff)) await fs.rm(target, { force: true }).catch(() => {})
  }
}

function serializeError(error) {
  return {
    errorCode: String(error?.code || 'UNKNOWN_ERROR'),
    errorName: String(error?.name || 'Error'),
    errorMessage: redactString(String(error?.message || error || 'unknown error')).slice(0, 1000),
  }
}

export function createLogger(options = {}) {
  const sink = options.sink || createSink(options)
  const component = String(options.component || 'cvagent')
  const minimumLevel = normalizeLevel(options.minimumLevel || process.env.CVAGENT_LOG_LEVEL || 'info')
  const baseContext = mergeFields({}, options.context || {})
  const runId = String(options.runId || baseContext.runId || '')

  const enqueue = (entry) => {
    sink.queue = sink.queue.then(async () => {
      await fs.mkdir(sink.directory, { recursive: true })
      const stamp = dateStamp(new Date(entry.timestamp))
      await pruneLogs(sink, stamp)
      const line = `${JSON.stringify(entry)}\n`
      const lineBytes = Buffer.byteLength(line, 'utf8')
      const target = await chooseActiveFile(sink, stamp, lineBytes)
      await fs.appendFile(target, line, 'utf8')
      sink.activeBytes += lineBytes
    }).catch((error) => {
      if (!sink.warned) {
        sink.warned = true
        console.error(`[${component}] unable to write project log: ${redactString(String(error?.message || error))}`)
      }
    })
    return sink.queue
  }

  const write = (level, event, fields = {}) => {
    const normalizedLevel = normalizeLevel(level)
    if (LOG_LEVELS[normalizedLevel] < LOG_LEVELS[minimumLevel]) return Promise.resolve()
    sink.sequence += 1
    const context = mergeFields(baseContext, fields)
    return enqueue({
      schemaVersion: LOG_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      level: normalizedLevel,
      event: normalizeEvent(event),
      component,
      pid: process.pid,
      hostname: os.hostname(),
      sequence: sink.sequence,
      ...(runId ? { runId } : {}),
      ...context,
    })
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (context = {}) => createLogger({ ...options, sink, component, minimumLevel, runId, context: { ...baseContext, ...context } }),
    timed: async (event, fields, operation) => {
      const startedAt = Date.now()
      const base = mergeFields(baseContext, fields)
      await write('info', `${event}_started`, base)
      try {
        const result = await operation()
        await write('info', `${event}_succeeded`, { ...base, durationMs: Date.now() - startedAt })
        return result
      } catch (error) {
        await write('error', `${event}_failed`, { ...base, durationMs: Date.now() - startedAt, ...serializeError(error) })
        throw error
      }
    },
    flush: () => sink.queue,
    directory: sink.directory,
    schemaVersion: LOG_SCHEMA_VERSION,
  }
}

export function errorFields(error) {
  return serializeError(error)
}
