import { useState } from 'react'
import { PaneHeader } from '../../components/PaneHeader'

export type PresentationLayout = {
  fontSize: number
  lineHeight: number
  sectionGap: number
  pageMargin: number
}

export type A4PaneOptions = {
  templateName: string
  layout?: Partial<PresentationLayout> | null
  onApplyTuning: (layout: PresentationLayout) => void | Promise<void>
  onOpenFullPreview: () => void
}

const defaultLayout: PresentationLayout = { fontSize: 13, lineHeight: 1.5, sectionGap: 16, pageMargin: 38 }

function mergeLayout(layout?: Partial<PresentationLayout> | null): PresentationLayout {
  return { ...defaultLayout, ...(layout || {}) }
}

export function A4Pane({ templateName, layout, onApplyTuning, onOpenFullPreview }: A4PaneOptions) {
  const [tuningOpen, setTuningOpen] = useState(false)
  const [values, setValues] = useState(() => mergeLayout(layout))
  const update = (key: keyof PresentationLayout, value: string) => setValues((current) => ({ ...current, [key]: Number(value) }))
  const handleApply = async () => {
    await onApplyTuning(values)
    setTuningOpen(false)
  }

  return (
    <>
      <PaneHeader
        variant="preview"
        title="A4 预览"
        actions={<div className="preview-actions"><span>适配宽度</span><button className="ghost-button" type="button" data-toggle-tuning onClick={() => setTuningOpen((open) => !open)}>手动微调</button></div>}
      />
      <span hidden data-template-name>{templateName}</span>
      <span hidden data-preview-status>等待渲染</span>
      <div className="direct-preview-stage"><div className="direct-preview-frame-wrap"><iframe title="当前简历 A4 直接预览" src="about:blank" scrolling="no" /></div></div>
      <div className="direct-preview-foot"><span><i /><span data-preview-foot-status>等待渲染</span></span><button className="secondary-button" type="button" data-open-full-preview onClick={onOpenFullPreview}>打开完整预览</button></div>
      {tuningOpen && <div className="presentation-panel" id="presentationPanel"><div className="presentation-panel-head"><b>手动微调</b><button className="ghost-button" type="button" data-close-tuning onClick={() => setTuningOpen(false)}>关闭</button></div><p>只修改当前会话的隔离版式，不覆盖源文件。</p><div className="tuning-grid"><label>字号<input id="tuningFontSize" type="number" min="11" max="18" step="0.5" value={values.fontSize} onChange={(event) => update('fontSize', event.target.value)} /></label><label>行高<input id="tuningLineHeight" type="number" min="1.2" max="2" step="0.05" value={values.lineHeight} onChange={(event) => update('lineHeight', event.target.value)} /></label><label>段落间距<input id="tuningSectionGap" type="number" min="6" max="30" step="1" value={values.sectionGap} onChange={(event) => update('sectionGap', event.target.value)} /></label><label>页边距<input id="tuningPageMargin" type="number" min="24" max="72" step="1" value={values.pageMargin} onChange={(event) => update('pageMargin', event.target.value)} /></label></div><button className="primary-small" id="applyTuning" type="button" onClick={() => void handleApply()}>应用并重新渲染</button></div>}
    </>
  )
}
