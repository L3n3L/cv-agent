import { useState } from 'react'
import { PaneHeader } from '../../components/PaneHeader'

export type MarkdownPaneOptions = {
  resumePath: string
  content: string
  status: string
  onApply: (content: string) => void | Promise<void>
}

export function MarkdownPane({ resumePath, content, status, onApply }: MarkdownPaneOptions) {
  const [value, setValue] = useState(content)

  return (
    <div className="editor-layout">
      <PaneHeader title={resumePath || 'resume.md'} subtitle="当前会话草稿" status={status} variant="editor" />
      <textarea
        id="resumeEditor"
        spellCheck={false}
        placeholder="选择工作区后加载 resume.md"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="editor-foot">
        <span>Markdown 草稿</span>
        <button className="primary-small" id="editorApply" type="button" onClick={() => void onApply(value)}>应用并重新渲染</button>
      </div>
    </div>
  )
}
