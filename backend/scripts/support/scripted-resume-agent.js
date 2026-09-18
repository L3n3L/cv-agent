export function createScriptedResumeAgent({ tools }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  return {
    async invoke(input) {
      const prepare = await byName.get('resume_prepare').invoke({})
      const current = await byName.get('resume_read').invoke({ includeContent: true })
      await byName.get('resume_check').invoke({ target: 'draft', targetPages: prepare.targetPages })
      await byName.get('resume_write').invoke({ content: current.content })
      await byName.get('resume_check').invoke({ target: 'draft', targetPages: prepare.targetPages })
      await byName.get('resume_render').invoke({})
      return {
        messages: [
          ...(Array.isArray(input?.messages) ? input.messages : []),
          { role: 'assistant', content: '已完成内容检查和渲染，等待当前 A4 的真实测量。' },
        ],
      }
    },
  }
}
