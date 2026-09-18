import assert from 'node:assert/strict'
import test from 'node:test'
import { runAgentWithStreaming } from '../src/agent/streaming.js'

async function* textChunks(chunks) {
  for (const chunk of chunks) {
    await Promise.resolve()
    yield chunk
  }
}

test('deep agent v3 stream forwards assistant deltas and drains private reasoning without exposing it', async () => {
  const assistantDeltas = []
  const starts = []
  const finishes = []
  const agent = {
    async streamEvents() {
      return {
        messages: (async function* messages() {
          yield {
            role: 'assistant',
            id: 'message-1',
            text: textChunks(['先读', '取简历。']),
            reasoning: textChunks(['private-', 'reasoning']),
          }
        })(),
        toolCalls: (async function* toolCalls() {})(),
        output: Promise.resolve({ messages: [{ role: 'assistant', content: '先读取简历。' }] }),
      }
    },
  }

  const result = await runAgentWithStreaming(agent, { messages: [] }, {
    onAssistantStart: (event) => starts.push(event),
    onAssistantDelta: (event) => assistantDeltas.push(event),
    onAssistantFinish: (event) => finishes.push(event),
  })

  assert.equal(result.streamed, true)
  assert.equal(result.result.messages[0].content, '先读取简历。')
  assert.deepEqual(starts, [{ messageId: 'message-1' }])
  assert.deepEqual(assistantDeltas, [
    { messageId: 'message-1', delta: '先读' },
    { messageId: 'message-1', delta: '取简历。' },
  ])
  assert.deepEqual(finishes, [{ messageId: 'message-1' }])
})

test('agents without v3 streaming keep the existing invoke compatibility path', async () => {
  const result = await runAgentWithStreaming({ invoke: async () => ({ messages: [{ role: 'assistant', content: '完成。' }] }) }, { messages: [] })
  assert.equal(result.streamed, false)
  assert.equal(result.result.messages[0].content, '完成。')
})
