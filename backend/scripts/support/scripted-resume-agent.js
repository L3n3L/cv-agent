const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function executeScriptedWorkflow(input, byName) {
  const prepare = await byName.get('resume_prepare').invoke({})
  await wait(120)
  const current = await byName.get('resume_read').invoke({ includeContent: true })
  await wait(120)
  await byName.get('resume_check').invoke({ target: 'draft', targetPages: prepare.targetPages })
  await wait(120)
  await byName.get('resume_write').invoke({ content: current.content })
  await wait(120)
  await byName.get('resume_check').invoke({ target: 'draft', targetPages: prepare.targetPages })
  await wait(120)
  await byName.get('resume_render').invoke({})
  return {
    messages: [
      ...(Array.isArray(input?.messages) ? input.messages : []),
      { role: 'assistant', content: '已完成内容检查和渲染，等待当前 A4 的真实测量。' },
    ],
  }
}

export function createScriptedResumeAgent({ tools }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  return {
    async invoke(input) {
      return executeScriptedWorkflow(input, byName)
    },
    async streamEvents(input) {
      let resolveOutput
      let rejectOutput
      const output = new Promise((resolve, reject) => {
        resolveOutput = resolve
        rejectOutput = reject
      })
      const messages = (async function* streamMessages() {
        try {
          const result = await executeScriptedWorkflow(input, byName)
          const text = result.messages.at(-1)?.content || ''
          resolveOutput(result)
          for (const delta of ['已完成内容', '检查和渲染', '，等待当前 A4 的真实测量。']) {
            await wait(160)
            yield { role: 'assistant', id: 'scripted-message-1', text: delta, reasoning: `已完成阶段：${delta}` }
          }
          // Keep the full text in the provider result while the UI receives
          // the same text incrementally through the message stream.
          if (text && text.length === 0) yield { role: 'assistant', id: 'scripted-message-1', text: '' }
        } catch (error) {
          rejectOutput(error)
          throw error
        }
      })()
      return { messages, toolCalls: (async function* toolCalls() {})(), output }
    },
  }
}
