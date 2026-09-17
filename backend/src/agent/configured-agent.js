import { createResumeAgent } from './deep-agent.js'
import { createDeepSeekModel } from './model.js'

export function createConfiguredResumeAgent(options = {}) {
  return createResumeAgent({
    ...options,
    model: options.model || createDeepSeekModel(options),
  })
}
