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

function stableValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stableValue)
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

function toolCallSignature(request) {
  const args = request.toolCall?.args ?? request.toolCall?.arguments ?? request.args ?? {}
  try { return JSON.stringify(stableValue(args)) } catch { return '{}' }
}

function cloneCachedToolMessage(message, request) {
  if (!(message instanceof ToolMessage)) return null
  return new ToolMessage({
    content: String(message.content || ''),
    tool_call_id: String(request.toolCall?.id || ''),
    name: String(request.toolCall?.name || request.tool?.name || ''),
  })
}

const CACHEABLE_READ_TOOLS = new Set([
  'workspace_info', 'workspace_materials_list', 'workspace_material_read',
  'resume_production_guide', 'template_list', 'template_family_list',
  'template_versions', 'icon_list', 'layout_validate',
])

const DEFAULT_TOOL_LIMITS = Object.freeze({
  workspace_info: 2,
  workspace_materials_list: 3,
  workspace_material_read: 8,
  resume_production_guide: 1,
  resume_prepare: 3,
  resume_read: 5,
  resume_check: 6,
  icon_list: 4,
  layout_validate: 3,
  template_list: 3,
  template_family_list: 2,
  template_versions: 3,
  template_select: 3,
  template_copy: 2,
  template_generate: 2,
  template_save: 2,
  template_restore: 2,
  presentation_update: 4,
  presentation_suggest: 2,
  template_autotune: 3,
  resume_write: 4,
  resume_reopen_draft: 4,
  resume_render: 4,
  resume_metrics: 3,
  resume_finalize: 4,
  resume_save_version: 1,
})

export function createWorkflowGuardMiddleware(options = {}) {
  const taskRef = options.taskRef
  const getDraftAvailable = typeof options.getDraftAvailable === 'function'
    ? options.getDraftAvailable
    : () => Boolean(taskRef?.current?.context?.contentVersion)
  const onIntervention = typeof options.onIntervention === 'function' ? options.onIntervention : null
  const maxToolCalls = Math.max(12, Number(options.maxToolCalls) || 64)
  const toolLimits = { ...DEFAULT_TOOL_LIMITS, ...(options.toolLimits || {}) }
  const callsByTool = new Map()
  const cache = new Map()
  let totalCalls = 0
  let toolTail = Promise.resolve()

  const enqueueToolCall = (operation) => {
    const next = toolTail.then(operation, operation)
    toolTail = next.catch(() => {})
    return next
  }

  const intervention = async (payload) => {
    await onIntervention?.(payload)
  }

  return createMiddleware({
    name: 'CVAgentWorkflowGuard',
    wrapModelCall: async (request, handler) => {
      const task = taskRef?.current
      const banner = workflowStateSummary(task, { draftAvailable: Boolean(getDraftAvailable()) })
      return handler({ ...request, systemPrompt: appendStateBanner(request.systemPrompt, banner) })
    },
    wrapToolCall: async (request, handler) => {
      const toolName = String(request.toolCall?.name || request.tool?.name || '')
      return enqueueToolCall(async () => {
        const task = taskRef?.current
      const draftAvailable = Boolean(getDraftAvailable())
      const signature = toolCallSignature(request)
      const toolCount = (callsByTool.get(toolName) || 0) + 1
      callsByTool.set(toolName, toolCount)
      totalCalls += 1

      if (CACHEABLE_READ_TOOLS.has(toolName)) {
        const cached = cache.get(`${toolName}:${signature}`)
        const replay = cloneCachedToolMessage(cached, request)
        if (replay) {
          await intervention({
            toolName,
            decision: { intervention: 'read_result_replayed', reason: '本轮已读取相同只读结果，直接复用，避免重复消耗工具调用。' },
            task,
            draftAvailable,
          })
          return replay
        }
      }

      const limit = Number(toolLimits[toolName] || 0)
      if (totalCalls > maxToolCalls || (limit > 0 && toolCount > limit)) {
        const next = inspectToolCall(task, toolName, { draftAvailable })
        const reason = totalCalls > maxToolCalls
          ? `本轮工具调用已达到安全上限 ${maxToolCalls}，停止继续试错并汇报当前状态。`
          : `本轮 ${toolName} 已达到调用上限 ${limit}，不要重复调用；沿着下一步继续工作或说明阻断。`
        const decision = {
          intervention: 'tool_budget_exceeded',
          nextTool: next.nextTool || null,
          reason,
          currentState: task?.state || null,
        }
        await intervention({ toolName, decision, task, draftAvailable })
        return toolMessage(request, {
          errorCode: 'TOOL_BUDGET_EXCEEDED',
          failureClass: 'non_retryable',
          retryable: false,
          currentState: task?.state || null,
          draftAvailable,
          nextTool: next.nextTool || null,
          nextAction: reason,
        })
      }

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
      const result = await handler(request)
      if (CACHEABLE_READ_TOOLS.has(toolName) && result instanceof ToolMessage) cache.set(`${toolName}:${signature}`, result)
      return result
      })
    },
  })
}

export { DEFAULT_TOOL_LIMITS }
