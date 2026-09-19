import { TASK_STATES } from './workflow.js'

const REVISION_STATES = new Set([TASK_STATES.NEEDS_REVISION, TASK_STATES.BLOCKED])

function hasDraft(task, draftAvailable = false) {
  return Boolean(task?.context?.contentVersion && draftAvailable)
}

export function getCanonicalNextAction(task, { draftAvailable = false } = {}) {
  const state = task?.state || TASK_STATES.INTAKE
  const currentDraft = hasDraft(task, draftAvailable)

  if (REVISION_STATES.has(state)) {
    return currentDraft
      ? { tool: 'resume_reopen_draft', reason: '恢复已有隔离草稿并清除过期渲染身份。' }
      : { tool: 'resume_write', reason: '当前没有可恢复的隔离草稿，必须先写入草稿。' }
  }

  switch (state) {
    case TASK_STATES.INTAKE:
      return { tool: 'resume_prepare', reason: '先固定本次工作区和简历基线。' }
    case TASK_STATES.PREPARED:
      return currentDraft
        ? { tool: 'resume_check', reason: '当前已有草稿，先做确定性内容检查。' }
        : { tool: 'resume_read', reason: '先读取当前简历和证据。' }
    case TASK_STATES.DRAFTING:
      return { tool: 'resume_check', reason: '草稿已变化，先检查当前草稿，再渲染。' }
    case TASK_STATES.RENDERED:
      return { tool: 'resume_metrics', reason: '等待当前 renderId 对应的真实浏览器测量。' }
    case TASK_STATES.MEASURED:
      return { tool: 'resume_finalize', reason: '当前版本已有测量，进入最终验收。' }
    case TASK_STATES.ACCEPTED:
      return { tool: 'user_confirmation', reason: '等待用户确认是否保存正式版本。' }
    case TASK_STATES.USER_CONFIRMED:
      return { tool: 'resume_save_version', reason: '保存已确认的正式版本。' }
    case TASK_STATES.SAVED:
      return { tool: null, reason: '当前正式版本已保存，编辑应开启新的任务。' }
    default:
      return { tool: 'resume_prepare', reason: `未知任务状态 ${state}，重新准备工作流。` }
  }
}

export function inspectToolCall(task, toolName, { draftAvailable = false } = {}) {
  const name = String(toolName || '')
  const state = task?.state || TASK_STATES.INTAKE
  const currentDraft = hasDraft(task, draftAvailable)

  if (name === 'resume_render') {
    if (state === TASK_STATES.DRAFTING && task?.context?.contentVersion) {
      return { allowed: true }
    }
    if (REVISION_STATES.has(state) && currentDraft) {
      return {
        allowed: true,
        intervention: 'resume_reopen_draft',
        nextTool: 'resume_reopen_draft',
        reason: '渲染前自动恢复已有隔离草稿。',
      }
    }
    return {
      allowed: false,
      code: 'DRAFT_REQUIRED',
      failureClass: 'requires_transition',
      nextTool: currentDraft ? 'resume_reopen_draft' : 'resume_write',
      currentState: state,
      draftAvailable: currentDraft,
      reason: currentDraft ? '必须先恢复隔离草稿。' : '必须先写入当前隔离草稿。',
    }
  }

  if (name === 'resume_metrics' && state !== TASK_STATES.RENDERED) {
    return {
      allowed: false,
      code: 'MEASUREMENT_NOT_ALLOWED',
      failureClass: 'requires_transition',
      nextTool: getCanonicalNextAction(task, { draftAvailable }).tool,
      currentState: state,
      draftAvailable: currentDraft,
      reason: '只有当前 render 完成后才能接收浏览器测量。',
    }
  }

  if (name === 'resume_save_version' && state !== TASK_STATES.ACCEPTED) {
    return {
      allowed: false,
      code: 'SAVE_NOT_ALLOWED',
      failureClass: 'requires_transition',
      nextTool: getCanonicalNextAction(task, { draftAvailable }).tool,
      currentState: state,
      draftAvailable: currentDraft,
      reason: '只有通过最终验收并获得用户确认后才能保存正式版本。',
    }
  }

  return { allowed: true }
}

export function workflowStateSummary(task, { draftAvailable = false } = {}) {
  const next = getCanonicalNextAction(task, { draftAvailable })
  return {
    state: task?.state || TASK_STATES.INTAKE,
    draftAvailable: Boolean(draftAvailable),
    contentVersion: task?.context?.contentVersion || null,
    templateRevision: task?.context?.templateRevision || null,
    renderId: task?.context?.renderId || null,
    nextTool: next.tool,
    nextReason: next.reason,
    completionAllowed: task?.state === TASK_STATES.ACCEPTED,
  }
}
