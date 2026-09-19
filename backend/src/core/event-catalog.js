import { contextFields } from './context.js'

export const WORKFLOW_EVENTS = Object.freeze({
  AGENT_RUN_STARTED: 'agent_run_started',
  AGENT_RUN_PAUSED: 'agent_run_paused',
  AGENT_RUN_FINISHED: 'agent_run_finished',
  ASSISTANT_MESSAGE_STARTED: 'assistant_message_started',
  ASSISTANT_DELTA: 'assistant_delta',
  ASSISTANT_MESSAGE_FINISHED: 'assistant_message_finished',
  REASONING_SUMMARY: 'reasoning_summary',
  TOOL_CALL_STARTED: 'tool_call_started',
  TOOL_CALL_SUCCEEDED: 'tool_call_succeeded',
  TOOL_CALL_FAILED: 'tool_call_failed',
  ARTIFACT_WRITTEN: 'artifact_written',
  RENDER_STARTED: 'render_started',
  RENDER_SUCCEEDED: 'render_succeeded',
  RENDER_FAILED: 'render_failed',
  MEASUREMENT_RECEIVED: 'measurement_received',
  VERIFICATION_PASSED: 'verification_passed',
  VERIFICATION_BLOCKED: 'verification_blocked',
  VERIFICATION_FAILED: 'verification_failed',
  SAVE_CONFIRMED: 'save_confirmed',
  SAVE_REJECTED: 'save_rejected',
  SESSION_RESTORED: 'session_restored',
  SESSION_INTERRUPTED: 'session_interrupted',
  SOURCE_CHANGED: 'source_changed',
})

const BASE_CONTEXT_FIELDS = Object.freeze(['sessionId', 'runId', 'taskId', 'workspaceId', 'resumeId'])
const RENDER_CONTEXT_FIELDS = Object.freeze(['contentVersion', 'templateRevision', 'renderId'])

const EVENT_REQUIREMENTS = Object.freeze({
  [WORKFLOW_EVENTS.AGENT_RUN_STARTED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.AGENT_RUN_PAUSED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.AGENT_RUN_FINISHED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.ASSISTANT_MESSAGE_STARTED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.ASSISTANT_DELTA]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.ASSISTANT_MESSAGE_FINISHED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.REASONING_SUMMARY]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.TOOL_CALL_STARTED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.TOOL_CALL_SUCCEEDED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.TOOL_CALL_FAILED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.ARTIFACT_WRITTEN]: [...BASE_CONTEXT_FIELDS, 'contentVersion'],
  [WORKFLOW_EVENTS.RENDER_STARTED]: [...BASE_CONTEXT_FIELDS, ...RENDER_CONTEXT_FIELDS],
  [WORKFLOW_EVENTS.RENDER_SUCCEEDED]: [...BASE_CONTEXT_FIELDS, ...RENDER_CONTEXT_FIELDS],
  [WORKFLOW_EVENTS.RENDER_FAILED]: [...BASE_CONTEXT_FIELDS, ...RENDER_CONTEXT_FIELDS],
  [WORKFLOW_EVENTS.MEASUREMENT_RECEIVED]: [...BASE_CONTEXT_FIELDS, ...RENDER_CONTEXT_FIELDS],
  [WORKFLOW_EVENTS.VERIFICATION_PASSED]: [...BASE_CONTEXT_FIELDS, ...RENDER_CONTEXT_FIELDS],
  // A blocked task may be rejected before a render exists (for example when
  // finalize is called without a measurement). Keep the audit event useful
  // in that case; current-render blocks still include render context.
  [WORKFLOW_EVENTS.VERIFICATION_BLOCKED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.VERIFICATION_FAILED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.SAVE_CONFIRMED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.SAVE_REJECTED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.SESSION_RESTORED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.SESSION_INTERRUPTED]: BASE_CONTEXT_FIELDS,
  [WORKFLOW_EVENTS.SOURCE_CHANGED]: BASE_CONTEXT_FIELDS,
})

export function workflowContext(value) {
  const taskOrContext = value?.context ? value.context : value
  const fields = contextFields(taskOrContext)
  if (value?.sessionId) fields.sessionId = String(value.sessionId)
  // A live execution can carry its correlation identity at the task level
  // while the nested context still represents the previous run. Prefer the
  // explicit top-level value so observability events follow the actual run.
  if (value?.runId) fields.runId = String(value.runId)
  return fields
}

export function workflowEventFields(event, value, fields = {}) {
  return { ...workflowContext(value), ...fields, event }
}

export function missingWorkflowFields(event, fields = {}) {
  return (EVENT_REQUIREMENTS[event] || BASE_CONTEXT_FIELDS).filter((field) => !String(fields[field] || '').trim())
}

export function workflowEventRequirements(event) {
  return [...(EVENT_REQUIREMENTS[event] || BASE_CONTEXT_FIELDS)]
}

/**
 * Emit a business event without allowing an observability problem to change
 * the resume workflow. The logger itself is already best-effort; this helper
 * also reports an invalid event contract instead of throwing into business
 * code.
 */
export async function emitWorkflowEvent(logger, event, value, fields = {}) {
  if (!logger || typeof logger.info !== 'function') return false
  const payload = workflowEventFields(event, value, fields)
  const missing = missingWorkflowFields(event, payload)
  if (missing.length) {
    await logger.warn('workflow_event_contract_invalid', { event, missingFields: missing })
    return false
  }
  await logger.info(event, payload)
  return true
}
