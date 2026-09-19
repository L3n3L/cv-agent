import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_EXECUTION_MODES, classifyAgentExecutionMode } from '../src/agent/execution-policy.js'
import { createExecutionModeMiddleware } from '../src/agent/execution-mode-middleware.js'

test('execution policy separates chat, read-only, and production intent', () => {
  assert.equal(classifyAgentExecutionMode('你好'), AGENT_EXECUTION_MODES.CHAT)
  assert.equal(classifyAgentExecutionMode('看下我的简历内容'), AGENT_EXECUTION_MODES.READ_ONLY)
  assert.equal(classifyAgentExecutionMode('请只读检查当前简历，不要修改内容'), AGENT_EXECUTION_MODES.READ_ONLY)
  assert.equal(classifyAgentExecutionMode('帮我制作一页投递版简历，不要保存正式版'), AGENT_EXECUTION_MODES.PRODUCTION)
  assert.equal(classifyAgentExecutionMode('继续重新渲染当前简历，不要改写简历正文'), AGENT_EXECUTION_MODES.PRODUCTION)
})

test('open modes preserve the native DeepAgent tool surface', async () => {
  const request = {
    tools: [{ name: 'resume_read' }, { name: 'resume_write' }, { name: 'template_save' }],
    model: {},
  }
  const capture = async (nextRequest) => nextRequest

  const chatResult = await createExecutionModeMiddleware(AGENT_EXECUTION_MODES.CHAT).wrapModelCall(request, capture)
  const productionResult = await createExecutionModeMiddleware(AGENT_EXECUTION_MODES.PRODUCTION).wrapModelCall(request, capture)
  const readOnlyResult = await createExecutionModeMiddleware(AGENT_EXECUTION_MODES.READ_ONLY).wrapModelCall(request, capture)

  assert.deepEqual(chatResult.tools, request.tools)
  assert.deepEqual(productionResult.tools, request.tools)
  assert.deepEqual(readOnlyResult.tools.map((tool) => tool.name), ['resume_read'])
  assert.equal(chatResult.toolChoice, undefined)
})
