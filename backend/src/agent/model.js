import { ChatOpenAI } from '@langchain/openai'

export function createDeepSeekModel(options = {}) {
  const apiKey = String(options.apiKey || process.env.DEEPSEEK_API_KEY || '').trim()
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required')
  return new ChatOpenAI({
    model: options.model || process.env.CVAGENT_MODEL || 'deepseek-chat',
    apiKey,
    temperature: 0.2,
    configuration: { baseURL: options.baseURL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1' },
  })
}
