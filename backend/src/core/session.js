import { createResumeTask, prepareResumeTask } from './workflow.js'
import { AGENT_EXECUTION_MODES, DEFAULT_AUTO_CONTINUATION_BUDGET } from '../agent/execution-policy.js'

export function createResumeSession({ workspace, resumePath, templateId, templateRevision, targetPages, intakeRequired = false, sessionId = null, sourceHash = null, executionMode = AGENT_EXECUTION_MODES.CHAT }) {
  const now = new Date().toISOString()
  const task = prepareResumeTask(createResumeTask({
    workspaceId: workspace.id,
    resumeId: resumePath,
    targetPages,
    intakeRequired,
    templateId,
    templateRevision,
  }))

  return {
    sessionId,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
    runState: 'idle',
    lastError: null,
    workspaceId: workspace.id,
    workspaceRoot: workspace.root,
    resumePath,
    templateId,
    templateRevision,
    sourceHash,
    executionMode,
    activeTurnId: null,
    workflowSequence: 0,
    automation: {
      continuationCount: 0,
      continuationBudget: DEFAULT_AUTO_CONTINUATION_BUDGET,
      lastContinuationRenderId: null,
    },
    taskRef: { current: task, presentation: null, presentationRevision: 1 },
    messages: [],
    workflowEvents: [],
  }
}

export function assertSessionScope(session, workspace, resumePath) {
  if (!session) return
  if (session.workspaceId !== workspace.id || session.resumePath !== resumePath) {
    throw Object.assign(new Error('session is bound to a different workspace or resume'), { code: 'SESSION_SCOPE_MISMATCH' })
  }
}

export async function withSessionLock(session, operation) {
  if (!session || typeof operation !== 'function') throw new TypeError('session and operation are required')
  const previous = session.operationTail || Promise.resolve()
  let release
  const current = new Promise((resolve) => { release = resolve })
  session.operationTail = current
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (session.operationTail === current) delete session.operationTail
  }
}
