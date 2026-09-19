const BLOCKED_EVENTS = new Set(['verification_blocked', 'tool_call_failed', 'render_failed', 'verification_failed'])

export function runEventStatus(events) {
  const list = Array.isArray(events) ? events : []
  if (list.some((event) => BLOCKED_EVENTS.has(event?.event))) return 'blocked'
  if (list.some((event) => event?.event === 'agent_run_finished' && event?.outcome === 'failed')) return 'failed'
  if (list.some((event) => event?.event === 'agent_run_finished' && event?.outcome !== 'failed')) return 'done'
  if (list.some((event) => event?.event === 'agent_run_started')) return 'running'
  return 'idle'
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
