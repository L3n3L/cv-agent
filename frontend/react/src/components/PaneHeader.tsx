import type { ReactNode } from 'react'

export type PaneHeaderProps = {
  title: string
  subtitle?: string
  status?: string
  actions?: ReactNode
  eyebrow?: string
  variant?: 'editor' | 'preview' | 'agent'
  titleDataKey?: 'template'
  subtitleDataKey?: 'preview-status'
}

export function PaneHeader({ title, subtitle, status, actions, eyebrow, variant = 'editor', titleDataKey, subtitleDataKey }: PaneHeaderProps) {
  const legacyClass = variant === 'editor' ? 'editor-head' : variant === 'preview' ? 'direct-preview-head' : 'drawer-header'
  return (
    <header className={`pane-header ${legacyClass} pane-header--${variant}`}>
      <div className="pane-header-copy">
        {eyebrow && <span className="pane-header-eyebrow eyebrow">{eyebrow}</span>}
        <b {...(titleDataKey === 'template' ? { 'data-template-name': true } : {})}>{title}</b>
        {subtitle && <span {...(subtitleDataKey === 'preview-status' ? { 'data-preview-status': true } : {})}>{subtitle}</span>}
      </div>
      {status && <span className="pane-header-status">{status}</span>}
      {actions && <div className="pane-header-actions">{actions}</div>}
    </header>
  )
}
