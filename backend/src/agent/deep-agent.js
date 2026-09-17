import { createDeepAgent } from 'deepagents'
import { CVAGENT_SYSTEM_PROMPT } from './system-prompt.js'

/**
 * The only framework-specific boundary in the product. Domain tools remain
 * framework-neutral so the product can test them without a model call.
 */
export function createResumeAgent(options = {}) {
  if (!options.model) throw new Error('model is required to create the resume agent')
  return createDeepAgent({
    model: options.model,
    tools: Array.isArray(options.tools) ? options.tools : [],
    systemPrompt: `${CVAGENT_SYSTEM_PROMPT}\n\n${String(options.systemPrompt || '').trim()}`.trim(),
    ...(options.backend ? { backend: options.backend } : {}),
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    ...(options.memory ? { memory: options.memory } : {}),
  })
}
