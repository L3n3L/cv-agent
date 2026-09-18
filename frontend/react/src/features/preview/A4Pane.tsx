import { useEffect, useRef, useState } from 'react'
import { PaneHeader } from '../../components/PaneHeader'

export type PresentationLayout = {
  fontFamily: 'system-sans' | 'modern-sans' | 'serif'
  fontSize: number
  lineHeight: number
  sectionGap: number
  pageMargin: number
}

export type IconTuning = Record<string, { scale?: number; offsetY?: number }>

export type PresentationOverride = {
  layout: PresentationLayout
  iconTuning: IconTuning
}

export type PresentationTuningDraft = PresentationOverride & {
  clear?: Array<'layout' | 'iconTuning'>
}

type IconInventoryItem = { name: string; label: string; count: number }

export type A4PaneOptions = {
  templateName: string
  presentation?: Partial<PresentationOverride> | null
  templateLayout?: Partial<PresentationLayout> | null
  onDraftChange: (presentation: PresentationTuningDraft) => void
  onApplyTuning: (presentation: PresentationTuningDraft) => void | Promise<void>
  onOpenFullPreview: () => void
}

const fallbackLayout: PresentationLayout = { fontFamily: 'system-sans', fontSize: 13, lineHeight: 1.5, sectionGap: 16, pageMargin: 38 }

function resolveLayout(templateLayout?: Partial<PresentationLayout> | null, presentation?: Partial<PresentationOverride> | null): PresentationLayout {
  return { ...fallbackLayout, ...(templateLayout || {}), ...(presentation?.layout || {}) }
}

function normalizeIconTuning(tuning: IconTuning, name: string) {
  return { scale: 1, offsetY: 0, ...(tuning['*'] || {}), ...(tuning[name] || {}) }
}

export function A4Pane({ templateName, presentation, templateLayout, onDraftChange, onApplyTuning, onOpenFullPreview }: A4PaneOptions) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [tuningOpen, setTuningOpen] = useState(false)
  const [layout, setLayout] = useState(() => resolveLayout(templateLayout, presentation))
  const [iconTuning, setIconTuning] = useState<IconTuning>(() => presentation?.iconTuning || {})
  const [layoutHistory, setLayoutHistory] = useState<PresentationLayout[]>([])
  const [iconHistory, setIconHistory] = useState<IconTuning[]>([])
  const [iconInventory, setIconInventory] = useState<IconInventoryItem[]>([])
  const [clearedGroups, setClearedGroups] = useState<Array<'layout' | 'iconTuning'>>([])

  const postPreview = (nextLayout = layout, nextIcons = iconTuning) => {
    frameRef.current?.contentWindow?.postMessage({ source: 'cvagent-resume-layout-preview', layout: nextLayout }, '*')
    frameRef.current?.contentWindow?.postMessage({ source: 'cvagent-resume-icon-tuning', icons: nextIcons }, '*')
  }

  const inspectIcons = () => {
    try {
      const counts = new Map<string, IconInventoryItem>()
      frameRef.current?.contentDocument?.querySelectorAll<HTMLElement>('.cvagent-icon').forEach((element) => {
        const name = element.dataset.iconName || 'unknown'
        const current = counts.get(name) || { name, label: element.getAttribute('aria-label') || name, count: 0 }
        current.count += 1
        counts.set(name, current)
      })
      setIconInventory([...counts.values()].sort((a, b) => a.name.localeCompare(b.name)))
    } catch {
      setIconInventory([])
    }
  }

  const publishDraft = (nextLayout = layout, nextIcons = iconTuning, nextCleared = clearedGroups) => {
    onDraftChange({ layout: nextLayout, iconTuning: nextIcons, clear: nextCleared })
  }

  const updateLayout = <K extends keyof PresentationLayout>(key: K, value: PresentationLayout[K]) => {
    setLayoutHistory((history) => [...history, layout].slice(-20))
    const next = { ...layout, [key]: value }
    const nextCleared = clearedGroups.filter((group) => group !== 'layout')
    setLayout(next)
    setClearedGroups(nextCleared)
    postPreview(next)
    publishDraft(next, iconTuning, nextCleared)
  }

  const updateIcon = (name: string, key: 'scale' | 'offsetY', value: number) => {
    setIconHistory((history) => [...history, iconTuning].slice(-20))
    const next = { ...iconTuning, [name]: { ...(iconTuning[name] || {}), [key]: value } }
    const nextCleared = clearedGroups.filter((group) => group !== 'iconTuning')
    setIconTuning(next)
    setClearedGroups(nextCleared)
    postPreview(layout, next)
    publishDraft(layout, next, nextCleared)
  }

  const undoLayout = () => {
    const previous = layoutHistory.at(-1)
    if (!previous) return
    setLayout(previous)
    setLayoutHistory((history) => history.slice(0, -1))
    const nextCleared = clearedGroups.filter((group) => group !== 'layout')
    setClearedGroups(nextCleared)
    postPreview(previous)
    publishDraft(previous, iconTuning, nextCleared)
  }

  const undoIcons = () => {
    const previous = iconHistory.at(-1)
    if (!previous) return
    setIconTuning(previous)
    setIconHistory((history) => history.slice(0, -1))
    const nextCleared = clearedGroups.filter((group) => group !== 'iconTuning')
    setClearedGroups(nextCleared)
    postPreview(layout, previous)
    publishDraft(layout, previous, nextCleared)
  }

  const apply = async () => {
    await onApplyTuning({ layout, iconTuning, clear: clearedGroups })
    setTuningOpen(false)
  }

  const reset = (groups: Array<'layout' | 'iconTuning'>) => {
    let nextLayout = layout
    let nextIcons = iconTuning
    if (groups.includes('layout')) {
      nextLayout = resolveLayout(templateLayout, null)
      setLayoutHistory((history) => [...history, layout].slice(-20))
      setLayout(nextLayout)
    }
    if (groups.includes('iconTuning')) {
      nextIcons = {}
      setIconHistory((history) => [...history, iconTuning].slice(-20))
      setIconTuning(nextIcons)
    }
    const nextCleared = [...new Set([...clearedGroups, ...groups])]
    setClearedGroups(nextCleared)
    postPreview(nextLayout, nextIcons)
    publishDraft(nextLayout, nextIcons, nextCleared)
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('cvagent:a4-pane-mounted')))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const allIcons = iconInventory.reduce((total, item) => total + item.count, 0)
  const iconRows = iconInventory.length ? [{ name: '*', label: '全部图标', count: allIcons }, ...iconInventory] : []

  return (
    <>
      <PaneHeader variant="preview" title="A4 预览" actions={<div className="preview-actions"><span>适配宽度</span><button className="ghost-button" type="button" data-toggle-tuning onClick={() => setTuningOpen((open) => !open)}>手动调整</button></div>} />
      <span hidden data-template-name>{templateName}</span>
      <span hidden data-preview-status>等待渲染</span>
      <div className="direct-preview-stage"><div className="direct-preview-frame-wrap"><iframe ref={frameRef} title="当前简历 A4 直接预览" src="about:blank" scrolling="no" onLoad={() => { inspectIcons(); postPreview() }} /></div></div>
      <div className="direct-preview-foot"><span><i /><span data-preview-foot-status>等待渲染</span></span><button className="secondary-button" type="button" data-open-full-preview onClick={onOpenFullPreview}>打开完整预览</button></div>
      {tuningOpen && <div className="presentation-panel" id="presentationPanel" aria-label="手动调整"><div className="presentation-panel-head"><b>手动调整</b><button className="ghost-button" type="button" data-close-tuning onClick={() => setTuningOpen(false)}>收起</button></div><div className="tuning-slider-grid"><label>字体<select value={layout.fontFamily} onChange={(event) => updateLayout('fontFamily', event.target.value as PresentationLayout['fontFamily'])}><option value="system-sans">系统无衬线</option><option value="modern-sans">现代无衬线</option><option value="serif">衬线</option></select></label>{([['fontSize', '字号', (value: number) => `${value}px`, 11, 18, 0.5], ['lineHeight', '行高', (value: number) => value.toFixed(2), 1.2, 2, 0.05], ['sectionGap', '间距', (value: number) => `${value}px`, 6, 30, 1], ['pageMargin', '边距', (value: number) => `${value}px`, 24, 72, 2]] as const).map(([key, label, format, min, max, step]) => <label key={key}><span>{label}</span><strong>{format(layout[key])}</strong><input type="range" min={min} max={max} step={step} value={layout[key]} aria-label={`${label} ${format(layout[key])}`} onChange={(event) => updateLayout(key, Number(event.target.value))} /></label>)}</div><div className="tuning-actions"><button type="button" className="ghost-button" onClick={undoLayout} disabled={!layoutHistory.length} title="撤销上一次调整">撤销</button><button type="button" className="ghost-button" onClick={() => reset(['layout'])}>默认</button></div><section className="icon-tuning-block"><div className="icon-tuning-head"><b>图标微调</b><span>{iconInventory.length ? `${iconInventory.length} 种 · ${allIcons} 个` : '等待预览读取'}</span></div>{iconRows.length ? iconRows.map((item) => { const value = normalizeIconTuning(iconTuning, item.name); return <div className="icon-tuning-row" key={item.name}><div><b>{item.label}</b><small>{item.name === '*' ? '全部' : `${item.name} · ${item.count} 个`}</small></div><label><span>大小 {value.scale.toFixed(2)}em</span><input type="range" min="0.7" max="1.5" step="0.05" value={value.scale} onChange={(event) => updateIcon(item.name, 'scale', Number(event.target.value))} /></label><label><span>上下 {value.offsetY.toFixed(2)}em</span><input type="range" min="-0.25" max="0.25" step="0.01" value={value.offsetY} onChange={(event) => updateIcon(item.name, 'offsetY', Number(event.target.value))} /></label></div> }) : <p className="icon-tuning-empty">当前预览没有可调图标。</p>}<div className="tuning-actions"><button type="button" className="ghost-button" onClick={undoIcons} disabled={!iconHistory.length}>撤销</button><button type="button" className="ghost-button" onClick={() => reset(['iconTuning'])}>默认</button></div></section><div className="presentation-panel-actions"><span>滑杆实时预览；应用后写入当前隔离草稿并重新测量。</span><button className="primary-small" id="applyTuning" type="button" onClick={() => void apply()}>应用到当前草稿</button></div></div>}
    </>
  )
}
