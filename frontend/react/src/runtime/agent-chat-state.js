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

/**
 * Keep the optimistic current turn when the server snapshot was persisted
 * before the latest user message. Session messages are append-only at this
 * boundary, so only the local suffix needs to survive a failed run sync.
 */
export function mergeSessionMessages(persistedMessages, localMessages) {
  const persisted = Array.isArray(persistedMessages) ? persistedMessages : []
  const local = Array.isArray(localMessages) ? localMessages : []
  if (local.length <= persisted.length) return persisted
  return [...persisted, ...local.slice(persisted.length)]
}

export function isSameAgentRun(event, runId) {
  if (!runId || !event?.runId) return true
  return String(event.runId) === String(runId)
}

export { PAUSED_EVENTS }
