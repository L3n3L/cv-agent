import { ChatOpenAI } from '@langchain/openai'

export function createDeepSeekModel(options = {}) {
  const apiKey = String(options.apiKey || process.env.DEEPSEEK_API_KEY || '').trim()
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')
  const model = options.model || process.env.CVAGENT_MODEL || 'deepseek-flash'
  const reasoningEffort = options.reasoningEffort || process.env.CVAGENT_REASONING_EFFORT || 'high'
  const thinkingType = options.thinkingType || process.env.CVAGENT_THINKING || 'enabled'
  const thinkingEnabled = thinkingType !== 'disabled' && reasoningEffort !== 'none'
  return new ChatOpenAI({
    model,
    apiKey,
    reasoning: { effort: thinkingEnabled ? reasoningEffort : 'none' },
    modelKwargs: { thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' } },
    configuration: { baseURL: options.baseURL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com' },
  })
}
