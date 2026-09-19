import { ToolMessage } from '@langchain/core/messages'
import { createMiddleware } from 'langchain'
import { inspectToolCall, workflowStateSummary } from '../core/workflow-coordinator.js'

function appendStateBanner(systemPrompt, banner) {
  const text = `

CVAGENT HARNESS STATE (authoritative for workflow sequencing):
${JSON.stringify(banner)}
Use this state to choose business actions. The server-side workflow guard remains authoritative.`
  if (typeof systemPrompt === 'string') return `${systemPrompt}${text}`
  if (systemPrompt && typeof systemPrompt === 'object' && 'content' in systemPrompt) {
    return { ...systemPrompt, content: `${String(systemPrompt.content || '')}${text}` }
  }
  return text.trim()
}

function toolMessage(request, payload) {
  return new ToolMessage({
    content: JSON.stringify({ ok: false, ...payload }),
    tool_call_id: String(request.toolCall?.id || ''),
    name: String(request.toolCall?.name || request.tool?.name || ''),
  })
}

export function createWorkflowGuardMiddleware(options = {}) {
  const taskRef = options.taskRef
  const getDraftAvailable = typeof options.getDraftAvailable === 'function'
    ? options.getDraftAvailable
    : () => Boolean(taskRef?.current?.context?.contentVersion)
  const onIntervention = typeof options.onIntervention === 'function' ? options.onIntervention : null

  return createMiddleware({
    name: 'CVAgentWorkflowGuard',
    wrapModelCall: async (request, handler) => {
      const task = taskRef?.current
      const banner = workflowStateSummary(task, { draftAvailable: Boolean(getDraftAvailable()) })
      return handler({ ...request, systemPrompt: appendStateBanner(request.systemPrompt, banner) })
    },
    wrapToolCall: async (request, handler) => {
      const task = taskRef?.current
      const toolName = String(request.toolCall?.name || request.tool?.name || '')
      const draftAvailable = Boolean(getDraftAvailable())
      const decision = inspectToolCall(task, toolName, { draftAvailable })
      if (decision.intervention) {
        await onIntervention?.({ toolName, decision, task, draftAvailable })
      }
      if (!decision.allowed) {
        return toolMessage(request, {
          errorCode: decision.code,
          failureClass: decision.failureClass,
          currentState: decision.currentState,
          draftAvailable: decision.draftAvailable,
          recoveryTool: decision.nextTool,
          nextTool: decision.nextTool,
          nextAction: decision.reason,
        })
      }
      return handler(request)
    },
  })
}
