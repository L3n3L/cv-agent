import { useEffect, useRef, useState } from 'react'
import { PaneHeader } from '../../components/PaneHeader'

export type MarkdownPaneOptions = {
  resumePath: string
  content: string
  status: string
  onApply: (content: string) => void | Promise<void>
}

export function MarkdownPane({ content, status, onApply }: MarkdownPaneOptions) {
  const [value, setValue] = useState(content)
  const [dirty, setDirty] = useState(false)
  const [externalUpdatePending, setExternalUpdatePending] = useState(false)
  const lastExternalContent = useRef(content)

  useEffect(() => {
    if (content === lastExternalContent.current) return
    lastExternalContent.current = content
    if (dirty) {
      setExternalUpdatePending(true)
      return
    }
    setValue(content)
    setExternalUpdatePending(false)
  }, [content, dirty])

  const loadExternalContent = () => {
    setValue(content)
    setDirty(false)
    setExternalUpdatePending(false)
  }

  const apply = async () => {
    await onApply(value)
    lastExternalContent.current = value
    setDirty(false)
    setExternalUpdatePending(false)
  }

  return (
    <div className="editor-layout">
      <PaneHeader title="Markdown 编辑" status={status} variant="editor" />
      <textarea
        id="resumeEditor"
        spellCheck={false}
        placeholder="选择工作区后加载 resume.md"
        value={value}
        onChange={(event) => {
          const next = event.target.value
          setValue(next)
          setDirty(next !== content)
          setExternalUpdatePending(false)
        }}
      />
      <div className="editor-foot">
        <span>{externalUpdatePending ? <><span>Agent 已更新草稿</span><button className="inline-action" type="button" onClick={loadExternalContent}>载入最新</button></> : (dirty ? '有未应用修改' : '')}</span>
        <button className="primary-small" id="editorApply" type="button" onClick={() => void apply()} disabled={!dirty}>应用并重新渲染</button>
      </div>
    </div>
  )
}
