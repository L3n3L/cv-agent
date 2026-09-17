import { randomUUID } from 'node:crypto'

const FIELDS = Object.freeze(['runId', 'taskId', 'workspaceId', 'resumeId', 'contentVersion', 'templateId', 'templateRevision', 'renderId'])

function required(value, name) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function optional(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export function createTaskContext(input = {}) {
  return {
    runId: optional(input.runId) || `run-${randomUUID()}`,
    taskId: optional(input.taskId) || `task-${randomUUID()}`,
    workspaceId: required(input.workspaceId, 'workspaceId'),
    resumeId: required(input.resumeId, 'resumeId'),
    contentVersion: optional(input.contentVersion),
    templateId: optional(input.templateId),
    templateRevision: optional(input.templateRevision),
    renderId: optional(input.renderId),
  }
}

export function contextFields(context) {
  return Object.fromEntries(FIELDS.filter((field) => context?.[field]).map((field) => [field, context[field]]))
}

export function assertContextMatch(context, artifact, label = 'artifact') {
  const mismatches = FIELDS.filter((field) => context?.[field] && artifact?.[field] && String(context[field]) !== String(artifact[field]))
  if (mismatches.length) throw new Error(`${label} does not belong to the current task context: ${mismatches.join(', ')}`)
  return true
}
