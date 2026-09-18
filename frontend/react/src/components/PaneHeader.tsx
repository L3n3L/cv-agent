import type { ReactNode } from 'react'

export type PaneHeaderProps = {
  title: string
  subtitle?: string
  status?: string
  actions?: ReactNode
  eyebrow?: string
  variant?: 'editor' | 'preview' | 'agent'
}

export function PaneHeader({ title, subtitle, status, actions, eyebrow, variant = 'editor' }: PaneHeaderProps) {
  const legacyClass = variant === 'editor' ? 'editor-head' : variant === 'preview' ? 'direct-preview-head' : 'drawer-header'
  return (
    <header className={`pane-header ${legacyClass} pane-header--${variant}`}>
      <div className="pane-header-copy">
        {eyebrow && <span className="pane-header-eyebrow">{eyebrow}</span>}
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {status && <span className="pane-header-status">{status}</span>}
      {actions && <div className="pane-header-actions">{actions}</div>}
    </header>
  )
}
