export const AGENT_EXECUTION_MODES = Object.freeze({
  CHAT: 'chat',
  READ_ONLY: 'read_only',
  PRODUCTION: 'production',
})

export const DEFAULT_AUTO_CONTINUATION_BUDGET = 4

const EXPLICIT_READ_ONLY = /(只读|仅查看|不要修改|不修改|不要改|不改内容|只检查)/
const INSPECTION_REQUEST = /(查看|看下|看看|读取|读一下|检查当前|当前简历.*内容|简历.*内容)/
const PRODUCTION_REQUEST = /(制作|生成|改写|修改|优化|整理|压缩|排版|渲染|一页|定向|投递|补充|增加|删除|替换|重写|继续调整|应用模板|不要保存正式版|先不要保存)/

export function classifyAgentExecutionMode(message) {
  const value = String(message || '').trim()
  if (!value) return AGENT_EXECUTION_MODES.CHAT
  if (EXPLICIT_READ_ONLY.test(value)) return AGENT_EXECUTION_MODES.READ_ONLY
  if (PRODUCTION_REQUEST.test(value)) return AGENT_EXECUTION_MODES.PRODUCTION
  if (INSPECTION_REQUEST.test(value)) return AGENT_EXECUTION_MODES.READ_ONLY
  return AGENT_EXECUTION_MODES.CHAT
}

export function isProductionExecutionMode(mode) {
  return mode === AGENT_EXECUTION_MODES.PRODUCTION
}

export function executionModeInstruction(mode) {
  if (mode === AGENT_EXECUTION_MODES.PRODUCTION) {
    return '当前执行模式：简历生产。用户已经要求 Agent 推进工作。请先读取 native resume-production Skill，再在隔离草稿中自主读取、整理、修改、渲染和验收；没有岗位或 JD 时先制作通用投递版，不要因为非关键缺口停下来提问。只有缺少无法从工作区补齐的关键事实、真实测量硬阻断或正式保存授权时才停下。'
  }
  if (mode === AGENT_EXECUTION_MODES.READ_ONLY) {
    return '当前执行模式：只读检查。只读取和分析已有内容，禁止写入草稿、修改模板、渲染或保存；用简洁结果回答用户，不要把内部流程包装成已经执行的工具结果。'
  }
  return '当前执行模式：开放对话。你可以根据用户意图自主选择是否读取工作区、检查简历、渲染或推进简历任务；用户没有要求时不要无意义调用工具。严格遵守每个工具的真实副作用、确认和阻断规则，绝不伪造工具结果或声称完成未执行的工作。'
}
