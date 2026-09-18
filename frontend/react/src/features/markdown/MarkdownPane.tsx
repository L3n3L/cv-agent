import { useState } from 'react'
import { PaneHeader } from '../../components/PaneHeader'

export type MarkdownPaneOptions = {
  resumePath: string
  content: string
  status: string
  onApply: (content: string) => void | Promise<void>
}

export function MarkdownPane({ content, status, onApply }: MarkdownPaneOptions) {
  const [value, setValue] = useState(content)

  return (
    <div className="editor-layout">
      <PaneHeader title="Markdown 编辑" status={status} variant="editor" />
      <textarea
        id="resumeEditor"
        spellCheck={false}
        placeholder="选择工作区后加载 resume.md"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="editor-foot">
        <span aria-hidden="true" />
        <button className="primary-small" id="editorApply" type="button" onClick={() => void onApply(value)}>应用并重新渲染</button>
      </div>
    </div>
  )
}
