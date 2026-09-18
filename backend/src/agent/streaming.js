const ASYNC_ITERATOR = Symbol.asyncIterator

function isAsyncIterable(value) {
  return Boolean(value && typeof value[ASYNC_ITERATOR] === 'function')
}

function chunkText(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  if (typeof value.delta === 'string') return value.delta
  if (typeof value.content_block?.text === 'string') return value.content_block.text
  if (Array.isArray(value.content)) return value.content.map((part) => chunkText(part)).join('')
  return ''
}

async function consumeTextStream(stream, onText) {
  if (!stream) return
  if (typeof stream === 'string') {
    if (stream) await onText(stream)
    return
  }
  if (!isAsyncIterable(stream)) {
    const text = chunkText(stream)
    if (text) await onText(text)
    return
  }
  for await (const chunk of stream) {
    const text = chunkText(chunk)
    if (text) await onText(text)
  }
}

function isAssistantMessage(message) {
  const role = String(message?.role || message?.type || '').toLowerCase()
  const node = String(message?.node || '').toLowerCase()
  return role === 'assistant' || role === 'ai' || role === 'aimessage' || node === 'model_request' || node.endsWith('/model_request')
}

/**
 * Consume deepagents' v3 stream without coupling the product UI to the
 * framework's internal event shape. Private reasoning is drained so the
 * agent can continue, but its tokens are deliberately not returned to the
 * client; the product emits safe workflow summaries separately.
 */
export async function runAgentWithStreaming(agent, input, options = {}) {
  if (typeof agent?.streamEvents !== 'function') {
    if (typeof agent?.invoke !== 'function') throw Object.assign(new Error('agent must provide invoke or streamEvents'), { code: 'AGENT_INVALID' })
    return { result: await agent.invoke(input), streamed: false }
  }

  const run = await agent.streamEvents(input, { version: 'v3' })
  let assistantMessageCount = 0
  const messageStream = isAsyncIterable(run?.messages)
    ? (async () => {
      for await (const message of run.messages) {
        if (!isAssistantMessage(message)) continue
        const messageId = String(message?.id || `assistant-${assistantMessageCount + 1}`)
        assistantMessageCount += 1
        await options.onAssistantStart?.({ messageId })
        await consumeTextStream(message.text, async (delta) => {
          await options.onAssistantDelta?.({ messageId, delta })
        })
        // Drain the provider's private reasoning channel without exposing it.
        await consumeTextStream(message.reasoning, async () => {})
        await options.onAssistantFinish?.({ messageId })
      }
    })()
    : Promise.resolve()

  const toolStream = isAsyncIterable(run?.toolCalls)
    ? (async () => {
      for await (const call of run.toolCalls) {
        // The canonical CVAgent tool runner already emits the persisted,
        // redacted tool lifecycle. Awaiting output here only drains the
        // framework projection and prevents backpressure from stalling it.
        await call?.output
      }
    })()
    : Promise.resolve()

  const [result] = await Promise.all([Promise.resolve(run.output), messageStream, toolStream])
  return { result, streamed: true }
}
