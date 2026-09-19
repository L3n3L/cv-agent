import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_EXECUTION_MODES, classifyAgentExecutionMode } from '../src/agent/execution-policy.js'

test('execution policy separates chat, read-only, and production intent', () => {
  assert.equal(classifyAgentExecutionMode('你好'), AGENT_EXECUTION_MODES.CHAT)
  assert.equal(classifyAgentExecutionMode('看下我的简历内容'), AGENT_EXECUTION_MODES.READ_ONLY)
  assert.equal(classifyAgentExecutionMode('请只读检查当前简历，不要修改内容'), AGENT_EXECUTION_MODES.READ_ONLY)
  assert.equal(classifyAgentExecutionMode('帮我制作一页投递版简历，不要保存正式版'), AGENT_EXECUTION_MODES.PRODUCTION)
})
