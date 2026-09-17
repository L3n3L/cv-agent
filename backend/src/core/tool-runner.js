import { contextFields } from './context.js'
import { emitWorkflowEvent, WORKFLOW_EVENTS, workflowContext } from './event-catalog.js'
import { createLogger } from './logger.js'

async function emitToolEvent(options, payload) {
  try { await options.onEvent?.(payload) } catch { /* observability must not break the tool */ }
}

function resolveWorkflowEvent(spec, stage, payload) {
  if (!spec) return null
  const value = typeof spec === 'function' ? spec({ stage, ...payload }) : spec[stage]
  return typeof value === 'function' ? value({ stage, ...payload }) : value
}

function resolveWorkflowFields(spec, stage, payload) {
  if (!spec) return {}
  const fields = typeof spec.fields === 'function' ? spec.fields({ stage, ...payload }) : spec.fields
  return fields || {}
}

export async function runResumeTool(task, toolName, handler, options = {}) {
  if (typeof handler !== 'function') throw new Error('tool handler is required')
  const logger = options.logger || createLogger({ component: 'cvagent-tool', context: contextFields(task.context) })
  const startedAt = Date.now()
  const taskWithSession = options.sessionId ? { ...task, sessionId: options.sessionId } : task
  const base = { toolName: String(toolName), ...workflowContext(taskWithSession) }
  await logger.info('tool_call_started', base)
  await emitToolEvent(options, { event: WORKFLOW_EVENTS.TOOL_CALL_STARTED, task: taskWithSession, toolName: String(toolName) })
  const workflow = options.workflowEvent
  const emit = async (stage, result, error) => {
    const event = resolveWorkflowEvent(workflow, stage, { result, error, task, toolName })
    if (!event) return
    const resultContext = result && typeof result === 'object' ? workflowContext(result) : {}
    await emitWorkflowEvent(logger, event, taskWithSession, {
      ...resultContext,
      ...resolveWorkflowFields(workflow, stage, { result, error, task, toolName }),
      durationMs: Date.now() - startedAt,
    })
  }
  await emit('started')
  try {
    const result = await handler(task)
    await logger.info('tool_call_succeeded', { ...base, durationMs: Date.now() - startedAt, resultSummary: options.resultSummary?.(result) || {} })
    await emitToolEvent(options, { event: WORKFLOW_EVENTS.TOOL_CALL_SUCCEEDED, task: taskWithSession, toolName: String(toolName), durationMs: Date.now() - startedAt })
    await emit('succeeded', result)
    await options.onSuccess?.({ toolName: String(toolName), result, task })
    return result
  } catch (error) {
    await logger.error('tool_call_failed', { ...base, durationMs: Date.now() - startedAt, errorCode: String(error?.code || 'TOOL_FAILED'), errorMessage: String(error?.message || error) })
    await emitToolEvent(options, { event: WORKFLOW_EVENTS.TOOL_CALL_FAILED, task: taskWithSession, toolName: String(toolName), durationMs: Date.now() - startedAt, errorCode: String(error?.code || 'TOOL_FAILED') })
    await emit('failed', null, error)
    throw error
  }
}
