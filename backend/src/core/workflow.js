import { assertContextMatch, contextFields, createTaskContext } from './context.js'

export const TASK_STATES = Object.freeze({
  INTAKE: 'intake', PREPARED: 'prepared', DRAFTING: 'drafting', RENDERED: 'rendered',
  MEASURED: 'measured', ACCEPTED: 'accepted', NEEDS_REVISION: 'needs_revision',
  BLOCKED: 'blocked', USER_CONFIRMED: 'user_confirmed', SAVED: 'saved',
})

function clone(task) {
  return { ...task, context: { ...task.context }, acceptance: { ...task.acceptance }, artifacts: { ...task.artifacts }, measurements: task.measurements ? { ...task.measurements } : null, blockers: [...task.blockers] }
}

function move(task, next) {
  const allowed = {
    intake: ['prepared'], prepared: ['drafting'], drafting: ['rendered'], rendered: ['measured'],
    measured: ['accepted', 'needs_revision', 'blocked'], accepted: ['drafting', 'user_confirmed'],
    needs_revision: ['drafting', 'blocked'], blocked: ['prepared', 'drafting'], user_confirmed: ['saved'], saved: [],
  }
  if (!allowed[task.state]?.includes(next)) throw new Error(`invalid resume task transition: ${task.state} -> ${next}`)
  const result = clone(task)
  result.state = next
  return result
}

export function createResumeTask(input = {}) {
  const targetPages = Math.max(1, Math.min(3, Number(input.targetPages) || 1))
  return {
    context: createTaskContext(input), state: TASK_STATES.INTAKE, targetPages,
    intakeRequired: Boolean(input.intakeRequired),
    acceptance: { minOccupancy: Number.isFinite(Number(input.minOccupancy)) ? Number(input.minOccupancy) : 0.9, maxSpread: Number.isFinite(Number(input.maxSpread)) ? Number(input.maxSpread) : targetPages > 1 ? 0.08 : 1 },
    artifacts: { contentVersion: null, templateRevision: null, renderId: null }, measurements: null, blockers: [],
  }
}

export function prepareResumeTask(task) { return move(task, TASK_STATES.PREPARED) }

export function recordDraftWrite(task, artifact = {}) {
  const { contentVersion: _currentContentVersion, ...stableContext } = task.context
  assertContextMatch(stableContext, artifact, 'draft')
  if ([TASK_STATES.USER_CONFIRMED, TASK_STATES.SAVED].includes(task.state)) throw new Error(`cannot mutate a ${task.state} resume task`)
  const next = task.state === TASK_STATES.INTAKE || task.state === TASK_STATES.BLOCKED ? move(task, TASK_STATES.PREPARED) : clone(task)
  next.state = TASK_STATES.DRAFTING
  next.context.contentVersion = String(artifact.contentVersion || '').trim() || next.context.contentVersion
  next.intakeRequired = Boolean(next.intakeRequired && artifact.intakeComplete !== true)
  next.context.renderId = null
  next.artifacts = { contentVersion: next.context.contentVersion, templateRevision: next.context.templateRevision, renderId: null }
  next.measurements = null
  next.blockers = []
  return next
}

export function recordTemplateChange(task, artifact = {}) {
  // Both template identity fields are expected to change together. Keeping
  // the previous templateId in the stable context made an explicit gallery
  // selection fail before the new render could be created.
  const { templateId: _currentTemplateId, templateRevision: _currentTemplateRevision, ...stableContext } = task.context
  assertContextMatch(stableContext, artifact, 'template')
  if ([TASK_STATES.USER_CONFIRMED, TASK_STATES.SAVED].includes(task.state)) throw new Error(`cannot mutate a ${task.state} resume task`)
  const next = clone(task)
  next.context.templateId = String(artifact.templateId || '').trim() || next.context.templateId
  next.context.templateRevision = String(artifact.templateRevision || '').trim() || next.context.templateRevision
  next.context.renderId = null
  next.artifacts = { contentVersion: next.context.contentVersion, templateRevision: next.context.templateRevision, renderId: null }
  next.measurements = null
  next.blockers = []
  if ([TASK_STATES.RENDERED, TASK_STATES.MEASURED, TASK_STATES.ACCEPTED, TASK_STATES.NEEDS_REVISION].includes(next.state)) next.state = TASK_STATES.DRAFTING
  return next
}

export function recordRender(task, artifact = {}) {
  assertContextMatch(task.context, artifact, 'render')
  if (task.state !== TASK_STATES.DRAFTING) throw new Error('render requires a current draft')
  if (!artifact.renderId || !artifact.templateRevision || String(artifact.contentVersion) !== String(task.context.contentVersion)) throw new Error('render must use the current contentVersion, templateRevision and renderId')
  const next = move(task, TASK_STATES.RENDERED)
  next.context.templateRevision = String(artifact.templateRevision)
  next.context.renderId = String(artifact.renderId)
  next.artifacts = { contentVersion: String(artifact.contentVersion), templateRevision: String(artifact.templateRevision), renderId: String(artifact.renderId) }
  return next
}

export function recordMeasurement(task, measurement = {}) {
  assertContextMatch(task.context, measurement, 'measurement')
  if (task.state !== TASK_STATES.RENDERED) throw new Error('measurement requires a current render')
  if (String(measurement.renderId) !== String(task.context.renderId)) throw new Error('measurement renderId is stale')
  if (!Number.isFinite(Number(measurement.pageCount))) throw new Error('measurement pageCount is required')
  const next = move(task, TASK_STATES.MEASURED)
  next.measurements = { renderId: String(measurement.renderId), contentVersion: String(measurement.contentVersion || task.context.contentVersion), templateRevision: String(measurement.templateRevision || task.context.templateRevision), pageCount: Number(measurement.pageCount), occupancy: Array.isArray(measurement.occupancy) ? measurement.occupancy.map(Number).filter(Number.isFinite) : [], overflow: Boolean(measurement.overflow) }
  return next
}

export function verifyResumeTask(task) {
  if (task.state !== TASK_STATES.MEASURED || !task.measurements) {
    const blocked = clone(task)
    blocked.state = TASK_STATES.BLOCKED
    blocked.blockers = ['没有当前内容和模板匹配的测量结果']
    return { passed: false, state: blocked.state, blockers: blocked.blockers, nextAction: '先重新渲染并获取当前版本的 A4 测量结果', context: contextFields(blocked.context), task: blocked }
  }
  const measurement = task.measurements
  const underfilled = measurement.occupancy.filter((ratio) => ratio < task.acceptance.minOccupancy)
  const spread = measurement.occupancy.length > 1 ? Math.max(...measurement.occupancy) - Math.min(...measurement.occupancy) : 0
  const blockers = []
  if (task.intakeRequired) blockers.push('尚未完成首次信息收集')
  if (measurement.pageCount !== task.targetPages || measurement.occupancy.length !== task.targetPages) blockers.push(`目标为 ${task.targetPages} 页，但实际为 ${measurement.pageCount} 页或缺少逐页占用率`)
  if (measurement.overflow) blockers.push('检测到内容溢出')
  if (underfilled.length) blockers.push(`有 ${underfilled.length} 页低于最低占用率 ${task.acceptance.minOccupancy}`)
  if (spread > task.acceptance.maxSpread) blockers.push(`页面占用率差异 ${spread.toFixed(3)} 超过 ${task.acceptance.maxSpread}`)
  const next = clone(task)
  next.state = blockers.length ? TASK_STATES.NEEDS_REVISION : TASK_STATES.ACCEPTED
  next.blockers = blockers
  return { passed: blockers.length === 0, state: next.state, blockers, nextAction: blockers.length ? '先调整模板或草稿，再重新渲染和测量' : '等待用户确认后保存正式版本', context: contextFields(task.context), task: next }
}

export function confirmResumeTask(task) { return move(task, TASK_STATES.USER_CONFIRMED) }
export function saveResumeTask(task) { return move(task, TASK_STATES.SAVED) }
