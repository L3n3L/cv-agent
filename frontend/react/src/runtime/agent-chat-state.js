const BLOCKED_EVENTS = new Set(['verification_blocked', 'tool_call_failed', 'render_failed', 'verification_failed'])

const PAUSED_EVENTS = new Set(['agent_run_paused'])

export function runEventStatus(events) {
  const list = Array.isArray(events) ? events : []
  // A production run can contain multiple phases: paused after render,
  // resumed after measurement, then finalized. The last terminal event is
  // authoritative; an earlier paused/blocked phase must not mask success.
  const terminal = [...list].reverse().find((event) => event?.event === 'agent_run_finished')
  if (terminal?.outcome === 'failed') return 'failed'
  if (terminal?.outcome === 'success') return 'done'
  if (terminal?.outcome === 'paused') return 'waiting'
  if (list.some((event) => BLOCKED_EVENTS.has(event?.event))) return 'blocked'
  if (list.some((event) => PAUSED_EVENTS.has(event?.event))) return 'waiting'
  if (list.some((event) => event?.event === 'agent_run_started')) return 'running'
  return 'idle'
}

/**
 * Convert the append-only workflow log into the order a user experienced it.
 * Tool rows are opened at tool_call_started and only updated by their terminal
 * event; assistant text is accumulated by messageId without moving the row.
 * This keeps live deltas and persisted tool history on one deterministic rail.
 */
export function projectWorkflowTimeline(events) {
  const entries = []
  const byKey = new Map()
  let sequence = 0
  const list = Array.isArray(events) ? events : []
  const timestampValue = (value) => {
    const parsed = Date.parse(String(value || ''))
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
  }
  const eventOrder = (event, fallback) => {
    const sequence = Number(event?.sequence)
    return Number.isFinite(sequence) ? sequence : fallback
  }
  const ensure = (key, entry, event) => {
    if (!byKey.has(key)) {
      byKey.set(key, { ...entry, sequence: sequence += 1, firstEventOrder: eventOrder(event, sequence) })
      entries.push(byKey.get(key))
    }
    return byKey.get(key)
  }
  for (const event of list) {
    const type = String(event?.event || '')
    if (type === 'tool_call_started' || type === 'tool_call_succeeded' || type === 'tool_call_failed') {
      const toolCallId = String(event.toolCallId || `${event.toolName || 'tool'}:${sequence}`)
      const row = ensure(`tool:${toolCallId}`, {
        kind: 'tool',
        key: `tool:${toolCallId}`,
        toolName: String(event.toolName || 'agent'),
        state: 'running',
        timestamp: event.timestamp || '',
        durationMs: null,
        detail: '',
        summary: null,
      }, event)
      row.timestamp ||= event.timestamp || ''
      row.durationMs = event.durationMs ?? row.durationMs
      row.detail = event.errorCode || row.detail
      row.summary = event.resultSummary || row.summary
      if (type === 'tool_call_succeeded') row.state = 'done'
      if (type === 'tool_call_failed') row.state = 'blocked'
      continue
    }
    if (type === 'assistant_message_started' || type === 'assistant_delta' || type === 'assistant_message_finished') {
      const messageId = String(event.messageId || `assistant:${sequence}`)
      const row = ensure(`assistant:${messageId}`, {
        kind: 'assistant',
        key: `assistant:${messageId}`,
        messageId,
        text: '',
        timestamp: event.timestamp || '',
        state: 'running',
      }, event)
      row.timestamp ||= event.timestamp || ''
      if (type === 'assistant_delta') row.text += String(event.delta || '')
      if (type === 'assistant_message_finished') row.state = 'done'
    }
  }
  return entries
    .sort((left, right) => left.firstEventOrder - right.firstEventOrder || timestampValue(left.timestamp) - timestampValue(right.timestamp) || left.sequence - right.sequence)
}

export function workflowGroupHasAssistantText(group) {
  return projectWorkflowTimeline(group?.events)
    .some((entry) => entry.kind === 'assistant' && String(entry.text || '').trim())
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) return message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('')
  return ''
}

function messageRole(message) {
  return String(message?.role || (message?.type === 'human' ? 'user' : message?.type === 'ai' ? 'assistant' : '')).trim()
}

function timestampValue(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function sequenceValue(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function eventOrder(event, fallback) {
  const timestamp = timestampValue(event?.timestamp)
  if (timestamp !== Number.MAX_SAFE_INTEGER) return timestamp
  return sequenceValue(event?.sequence) ?? fallback
}

function messageIdentity(message, index = 0) {
  const messageId = String(message?.messageId || message?.id || '').trim()
  if (messageId) return `id:${messageId}`
  const turnId = String(message?.turnId || '').trim()
  const role = messageRole(message)
  const content = messageText(message)
  if (turnId) return `turn:${turnId}:${role}:${content}`
  const sequence = sequenceValue(message?.sequence)
  if (sequence !== null) return `sequence:${sequence}:${role}`
  return `legacy:${role}:${String(message?.timestamp || '')}:${content}:${index}`
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message, index) => {
      const role = messageRole(message)
      const content = messageText(message)
      const sequence = sequenceValue(message?.sequence)
      return {
        role,
        content,
        timestamp: message?.timestamp || '',
        turnId: String(message?.turnId || '').trim(),
        messageId: String(message?.messageId || message?.id || '').trim(),
        runId: String(message?.runId || '').trim(),
        status: String(message?.status || '').trim(),
        sequence,
        order: timestampValue(message?.timestamp) !== Number.MAX_SAFE_INTEGER ? timestampValue(message.timestamp) : sequence ?? index,
        sourceIndex: index,
      }
    })
    .filter((message) => ['user', 'assistant'].includes(message.role) && message.content.trim())
}

function dedupeWorkflowEvents(events) {
  const byIdentity = new Map()
  ;(Array.isArray(events) ? events : []).forEach((event, index) => {
    if (!event || typeof event !== 'object' || !event.event) return
    const sequence = sequenceValue(event.sequence)
    const identity = String(event.eventId || event.id || '').trim() || [
      sequence !== null ? `sequence:${sequence}` : '',
      event.event,
      event.turnId || '',
      event.runId || '',
      event.toolCallId || event.messageId || '',
      event.timestamp || '',
      event.delta || '',
      index,
    ].join('|')
    byIdentity.set(identity, event)
  })
  return [...byIdentity.values()].sort((left, right) => eventOrder(left, 0) - eventOrder(right, 0))
}

/**
 * Build one workflow group per turn. Legacy workflow events without a turnId
 * are intentionally excluded: the dataflow contract does not permit an
 * orphaned workflow to be appended to the bottom of a conversation.
 */
export function eventGroups(events) {
  const groupsByTurn = new Map()
  let agentRunStarted = false
  dedupeWorkflowEvents(events).forEach((event) => {
    if (event.event === 'agent_run_started') agentRunStarted = true
    if (!agentRunStarted) return
    const turnId = String(event.turnId || '').trim()
    if (!turnId) return
    const group = groupsByTurn.get(turnId) || { key: `turn:${turnId}`, turnId, runId: '', events: [], firstEventOrder: Number.MAX_SAFE_INTEGER }
    group.events.push(event)
    group.runId = String(event.runId || group.runId || '').trim()
    group.firstEventOrder = Math.min(group.firstEventOrder, eventOrder(event, group.events.length))
    groupsByTurn.set(turnId, group)
  })
  return [...groupsByTurn.values()]
    .filter((group) => group.events.some((event) => ['tool_call_started', 'tool_call_succeeded', 'tool_call_failed'].includes(event.event) || (event.event === 'assistant_delta' && String(event.delta || '').trim())))
    .sort((left, right) => left.firstEventOrder - right.firstEventOrder)
}

function assistantEntryMatchesMessage(entry, message) {
  if (entry.kind !== 'assistant') return false
  if (entry.messageId && message.messageId && entry.messageId === message.messageId) return true
  const canonicalText = (value) => String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s*\|\s*/g, '|')
    .replace(/\s+/g, ' ')
    .trim()
  const entryText = canonicalText(entry.text)
  const messageTextValue = canonicalText(message.content)
  return Boolean(entryText && messageTextValue && entryText === messageTextValue)
}

function shouldPreferPersistedAssistant(workflowEntries, messages) {
  const assistantEntries = workflowEntries.filter((entry) => entry.kind === 'assistant' && String(entry.text || '').trim())
  const persistedAssistants = messages.filter((message) => message.role === 'assistant' && String(message.content || '').trim())
  if (!assistantEntries.length || !persistedAssistants.length) return false

  // During streaming, DeepAgent may emit a compact text projection while the
  // final model snapshot persists the same answer with Markdown line breaks.
  // When this turn has exactly one answer on each rail, the durable snapshot
  // is authoritative for the final render. Keeping both would render one
  // logical answer twice; keeping the stream would lose the final formatting.
  if (assistantEntries.length === 1 && persistedAssistants.length === 1) return true

  // For multi-message turns, only switch to the durable rail when every
  // streamed answer has an unambiguous persisted counterpart.
  return assistantEntries.length === persistedAssistants.length && assistantEntries.every((entry) => (
    persistedAssistants.some((message) => assistantEntryMatchesMessage(entry, message))
  ))
}

function hideAssistantWorkflowEvents(workflow) {
  if (!workflow) return null
  return {
    ...workflow,
    events: workflow.events.filter((event) => ![
      'assistant_message_started',
      'assistant_delta',
      'assistant_message_finished',
    ].includes(event.event)),
  }
}

/**
 * The only conversation read model consumed by the renderer. Messages and
 * workflow events may remain separate durable stores, but they are normalized,
 * deduplicated and joined here before any HTML is produced.
 */
export function reduceAgentTimeline({ messages = [], events = [] } = {}) {
  const normalized = normalizeMessages(messages)
  const groups = eventGroups(events)
  const turns = new Map()

  const ensureTurn = (key, turnId = '') => {
    if (!turns.has(key)) turns.set(key, { key, turnId, messages: [], workflow: null, order: Number.MAX_SAFE_INTEGER })
    return turns.get(key)
  }

  normalized.forEach((message) => {
    const key = message.turnId ? `turn:${message.turnId}` : `message:${messageIdentity(message, message.sourceIndex)}`
    const turn = ensureTurn(key, message.turnId)
    turn.messages.push(message)
    turn.order = Math.min(turn.order, message.order)
  })

  groups.forEach((group) => {
    const key = `turn:${group.turnId}`
    const turn = turns.get(key)
    // A workflow without a durable user message is an orphan diagnostic. It
    // stays in the audit log, but it must not become a visible chat segment.
    if (!turn || !turn.messages.some((message) => message.role === 'user')) return
    if (!turn.workflow) turn.workflow = { ...group, events: [] }
    turn.workflow.events.push(...group.events)
    turn.workflow.firstEventOrder = Math.min(turn.workflow.firstEventOrder, group.firstEventOrder)
    turn.workflow.runId = group.runId || turn.workflow.runId
  })

  return [...turns.values()]
    .map((turn) => {
      const workflowEntries = turn.workflow ? projectWorkflowTimeline(turn.workflow.events) : []
      const preferPersistedAssistant = shouldPreferPersistedAssistant(workflowEntries, turn.messages)
      const visibleMessages = turn.messages
        .sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex)
        .filter((message) => message.role !== 'assistant' || preferPersistedAssistant || !workflowEntries.some((entry) => assistantEntryMatchesMessage(entry, message)))
      return {
        ...turn,
        messages: visibleMessages,
        workflow: turn.workflow && turn.workflow.events.length
          ? (preferPersistedAssistant ? hideAssistantWorkflowEvents(turn.workflow) : turn.workflow)
          : null,
      }
    })
    .filter((turn) => turn.messages.length || turn.workflow)
    .sort((left, right) => left.order - right.order)
}

/**
 * Preserve optimistic messages by stable identity, never by array length.
 * Persisted messages remain authoritative; a local assistant snapshot only
 * wins when it contains more text for the same identity.
 */
export function mergeSessionMessages(persistedMessages, localMessages) {
  const persisted = Array.isArray(persistedMessages) ? persistedMessages : []
  const local = Array.isArray(localMessages) ? localMessages : []
  const merged = persisted.map((message) => ({ ...message }))
  const indexes = new Map()
  merged.forEach((message, index) => indexes.set(messageIdentity(message, index), index))
  local.forEach((message, index) => {
    const identity = messageIdentity(message, index)
    const existingIndex = indexes.get(identity)
    if (existingIndex === undefined) {
      indexes.set(identity, merged.length)
      merged.push({ ...message })
      return
    }
    const existing = merged[existingIndex]
    if (messageRole(message) === 'assistant' && messageText(message).length > messageText(existing).length) merged[existingIndex] = { ...existing, ...message }
  })
  return merged
}

export function isSameAgentRun(event, runId) {
  if (!runId || !event?.runId) return true
  return String(event.runId) === String(runId)
}

export { PAUSED_EVENTS }
