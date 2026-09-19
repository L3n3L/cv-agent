import { createDeepAgent } from 'deepagents'
import { todoListMiddleware } from 'langchain'
import { CVAGENT_SYSTEM_PROMPT } from './system-prompt.js'
import { createExecutionModeMiddleware } from './execution-mode-middleware.js'
import { AGENT_EXECUTION_MODES, executionModeInstruction } from './execution-policy.js'
import { RESUME_PRODUCTION_SKILL_SOURCE } from './resume-production-skill.js'
import { createWorkflowGuardMiddleware } from './workflow-guard-middleware.js'

/**
 * The only framework-specific boundary in the product. Domain tools remain
 * framework-neutral so the product can test them without a model call.
 */
export function createResumeAgent(options = {}) {
  if (!options.model) throw new Error('model is required to create the resume agent')
  const executionMode = options.executionMode || AGENT_EXECUTION_MODES.CHAT
  const skillEnabled = executionMode !== AGENT_EXECUTION_MODES.READ_ONLY
  const middleware = [
    ...(executionMode === AGENT_EXECUTION_MODES.PRODUCTION ? [todoListMiddleware()] : []),
    ...(options.taskRef ? [createWorkflowGuardMiddleware(options.workflowGuard || { taskRef: options.taskRef })] : []),
    createExecutionModeMiddleware(executionMode),
  ]
  return createDeepAgent({
    model: options.model,
    tools: Array.isArray(options.tools) ? options.tools : [],
    middleware,
    systemPrompt: `${CVAGENT_SYSTEM_PROMPT}\n\n${executionModeInstruction(executionMode)}\n\n${String(options.systemPrompt || '').trim()}`.trim(),
    ...(skillEnabled ? { skills: [RESUME_PRODUCTION_SKILL_SOURCE] } : {}),
    ...(options.backend ? { backend: options.backend } : {}),
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    ...(options.memory ? { memory: options.memory } : {}),
  })
}
