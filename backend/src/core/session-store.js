import fs from 'node:fs/promises'
import path from 'node:path'
import { sanitizeLogValue } from './logger.js'
import { safeWorkflowSummary } from './workflow-summary.js'
import { writeAtomic } from './workspace.js'

const SESSION_ID_PATTERN = /^session_[A-Za-z0-9_-]+$/
const SNAPSHOT_NAME = 'session.json'
const MESSAGES_NAME = 'messages.ndjson'
const EVENTS_NAME = 'events.ndjson'
const SCHEMA_VERSION = 1
// Keep enough durable context for a long production run to retain its
// agent_run_started boundary. The full audit log remains in events.ndjson;
// this cap only bounds the snapshot sent with /api/session.
const MAX_WORKFLOW_EVENTS = 2000

function assertSessionId(sessionId) {
  const value = String(sessionId || '').trim()
  if (!SESSION_ID_PATTERN.test(value)) throw Object.assign(new Error('sessionId is invalid'), { code: 'SESSION_INVALID' })
  return value
}

function safeMessage(message) {
  if (message === null || typeof message !== 'object') return { role: 'user', content: String(message ?? '') }
  const role = message.role || (message.type === 'human' ? 'user' : message.type === 'ai' ? 'assistant' : message.type === 'tool' ? 'tool' : message.type)
  const result = { role: String(role || 'assistant'), content: message.content ?? '' }
  for (const key of ['id', 'messageId', 'turnId', 'runId', 'timestamp', 'sequence', 'status', 'name', 'tool_call_id', 'tool_calls', 'additional_kwargs', 'response_metadata']) {
    if (message[key] !== undefined) result[key] = message[key]
  }
  return result
}

function safeMessages(messages) {
  return Array.isArray(messages) ? messages.map(safeMessage) : []
}

function safeWorkflowEvent(event) {
  if (!event || typeof event !== 'object') return null
  const allowed = ['event', 'timestamp', 'sequence', 'sessionId', 'turnId', 'runId', 'taskId', 'workspaceId', 'resumeId', 'toolName', 'toolCallId', 'mode', 'executionMode', 'continuationRound', 'continuationBudget', 'outcome', 'durationMs', 'assistantChars', 'errorCode', 'failureClass', 'recoveryTool', 'currentState', 'draftAvailable', 'contentVersion', 'templateRevision', 'renderId', 'state', 'phase', 'reason', 'reasoningSummary', 'delta', 'messageId']
  const value = {}
  for (const key of allowed) {
    if (event[key] !== undefined && event[key] !== null) value[key] = event[key]
  }
  const resultSummary = safeWorkflowSummary(event.resultSummary)
  if (resultSummary) value.resultSummary = resultSummary
  return value.event ? value : null
}

function safeWorkflowEvents(events) {
  return (Array.isArray(events) ? events : []).map(safeWorkflowEvent).filter(Boolean).slice(-MAX_WORKFLOW_EVENTS)
}

function sessionSnapshot(session) {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: String(session.sessionId || ''),
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
    workspaceId: session.workspaceId,
    workspaceRoot: session.workspaceRoot,
    resumePath: session.resumePath,
    templateId: session.templateId || null,
    templateRevision: session.templateRevision || null,
    sourceHash: session.sourceHash || null,
    executionMode: session.executionMode || 'chat',
    activeTurnId: session.activeTurnId || null,
    workflowSequence: Math.max(0, Number(session.workflowSequence) || 0),
    messageSequence: Math.max(0, Number(session.messageSequence) || 0),
    automation: {
      continuationCount: Math.max(0, Number(session.automation?.continuationCount) || 0),
      continuationBudget: Math.max(0, Number(session.automation?.continuationBudget) || 0),
      lastContinuationRenderId: session.automation?.lastContinuationRenderId || null,
    },
    status: session.status || 'idle',
    runState: session.runState || 'idle',
    lastError: session.lastError || null,
    workflowEvents: safeWorkflowEvents(session.workflowEvents),
    taskRef: {
      current: session.taskRef?.current || null,
      presentation: session.taskRef?.presentation || null,
      presentationRevision: Number(session.taskRef?.presentationRevision || 1),
      draftRelativePath: session.taskRef?.draftRelativePath || null,
      renderRelativePath: session.taskRef?.renderRelativePath || null,
      renderAbsolutePath: session.taskRef?.renderAbsolutePath || null,
    },
  }
}

function hydrateSession(snapshot) {
  const session = {
    ...snapshot,
    taskRef: {
      current: snapshot.taskRef?.current || null,
      presentation: snapshot.taskRef?.presentation || null,
      presentationRevision: Number(snapshot.taskRef?.presentationRevision || 1),
      draftRelativePath: snapshot.taskRef?.draftRelativePath || null,
      renderRelativePath: snapshot.taskRef?.renderRelativePath || null,
      renderAbsolutePath: snapshot.taskRef?.renderAbsolutePath || null,
    },
    messages: safeMessages(snapshot.messages),
    workflowEvents: safeWorkflowEvents(snapshot.workflowEvents),
    workflowSequence: Math.max(0, Number(snapshot.workflowSequence) || 0),
    messageSequence: Math.max(0, Number(snapshot.messageSequence) || 0),
    activeTurnId: snapshot.activeTurnId || null,
    executionMode: snapshot.executionMode || 'chat',
    automation: {
      continuationCount: Math.max(0, Number(snapshot.automation?.continuationCount) || 0),
      continuationBudget: Math.max(0, Number(snapshot.automation?.continuationBudget) || 0),
      lastContinuationRenderId: snapshot.automation?.lastContinuationRenderId || null,
    },
  }
  if (session.runState === 'running') {
    session.runState = 'interrupted'
    session.status = 'interrupted'
    session.lastError = { code: 'SESSION_INTERRUPTED', message: '服务在 Agent 执行期间退出，已恢复到最近一次持久化状态。' }
  }
  return session
}

function summary(session, includeMessages = false) {
  const value = sessionSnapshot(session)
  if (includeMessages) {
    value.messages = safeMessages(session.messages)
    value.workflowEvents = safeWorkflowEvents(session.workflowEvents)
  } else {
    delete value.workflowEvents
  }
  return value
}

export function createSessionStore(options = {}) {
  const root = path.resolve(options.directory || process.env.CVAGENT_SESSION_DIR || path.join(process.cwd(), '.cvagent', 'sessions'))
  const saveQueues = new Map()

  function directoryFor(sessionId) {
    return path.join(root, assertSessionId(sessionId))
  }

  async function save(session, event = null) {
    const sessionId = assertSessionId(session.sessionId)
    const now = new Date().toISOString()
    session.updatedAt = now
    const directory = directoryFor(sessionId)
    const snapshot = sessionSnapshot(session)
    const messages = safeMessages(session.messages)
    const messageLines = messages.length ? `${messages.map((message) => JSON.stringify(message)).join('\n')}\n` : ''
    const safeEvent = event && sanitizeLogValue(event)
    const eventFields = safeEvent && typeof safeEvent === 'object'
      ? Object.fromEntries(Object.entries(safeEvent).filter(([key]) => !['schemaVersion', 'timestamp', 'sessionId'].includes(key)))
      : null
    const previous = saveQueues.get(sessionId) || Promise.resolve()
    const current = previous.catch(() => {}).then(async () => {
      await fs.mkdir(directory, { recursive: true })
      await writeAtomic(path.join(directory, SNAPSHOT_NAME), `${JSON.stringify(snapshot, null, 2)}\n`)
      await writeAtomic(path.join(directory, MESSAGES_NAME), messageLines)
      if (eventFields) {
        const entry = { schemaVersion: SCHEMA_VERSION, timestamp: now, sessionId, ...eventFields }
        await fs.appendFile(path.join(directory, EVENTS_NAME), `${JSON.stringify(entry)}\n`, 'utf8')
      }
      return snapshot
    })
    saveQueues.set(sessionId, current)
    try { return await current } finally {
      if (saveQueues.get(sessionId) === current) saveQueues.delete(sessionId)
    }
  }

  async function load(sessionId) {
    const safeId = assertSessionId(sessionId)
    const filePath = path.join(directoryFor(safeId), SNAPSHOT_NAME)
    const text = await fs.readFile(filePath, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (!text) return null
    let snapshot
    try {
      snapshot = JSON.parse(text)
    } catch {
      throw Object.assign(new Error('session snapshot is invalid'), { code: 'SESSION_INVALID' })
    }
    if (snapshot?.schemaVersion !== SCHEMA_VERSION || snapshot.sessionId !== safeId) throw Object.assign(new Error('session snapshot schema is invalid'), { code: 'SESSION_INVALID' })
    const messagesText = await fs.readFile(path.join(directoryFor(safeId), MESSAGES_NAME), 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error))
    const messages = messagesText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    return hydrateSession({ ...snapshot, messages: messages.length ? messages : snapshot.messages || [] })
  }

  async function readWorkflowEvents(sessionId, afterSequence = 0) {
    const safeId = assertSessionId(sessionId)
    const text = await fs.readFile(path.join(directoryFor(safeId), EVENTS_NAME), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return ''
      throw error
    })
    const cursor = Math.max(0, Number(afterSequence) || 0)
    return text.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return safeWorkflowEvent(JSON.parse(line)) } catch { return null }
    }).filter((event) => event && Number.isFinite(Number(event.sequence)) && Number(event.sequence) > cursor).sort((left, right) => Number(left.sequence) - Number(right.sequence))
  }

  async function list(filters = {}) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') return []
      throw error
    })
    const sessions = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue
      const session = await load(entry.name).catch(() => null)
      if (!session) continue
      if (filters.workspaceRoot && path.resolve(session.workspaceRoot) !== path.resolve(filters.workspaceRoot)) continue
      if (filters.resumePath && session.resumePath !== filters.resumePath) continue
      sessions.push(summary(session, false))
    }
    return sessions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  }

  return {
    root,
    save,
    load,
    readWorkflowEvents,
    list,
    summary,
  }
}
