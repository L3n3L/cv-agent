import type { ReactNode } from 'react'

export type PaneHeaderProps = {
  title: string
  subtitle?: string
  status?: string
  actions?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  id?: string
  ariaExpanded?: boolean
  eyebrow?: string
  variant?: 'editor' | 'preview' | 'agent' | 'route' | 'brand' | 'workspace'
  titleDataKey?: 'template'
  subtitleDataKey?: 'preview-status'
  eyebrowId?: string
  titleId?: string
  subtitleId?: string
  statusId?: string
  actionsId?: string
}

export function PaneHeader({ title, subtitle, status, actions, leading, trailing, id, ariaExpanded, eyebrow, variant = 'editor', titleDataKey, subtitleDataKey, eyebrowId, titleId, subtitleId, statusId, actionsId }: PaneHeaderProps) {
  const legacyClass = variant === 'editor' ? 'editor-head' : variant === 'preview' ? 'direct-preview-head' : variant === 'agent' ? 'drawer-header' : variant === 'brand' ? 'brand-lockup' : variant === 'workspace' ? 'workspace-switcher' : 'route-header'
  if (variant === 'workspace') {
    return (
      <button className={`pane-header ${legacyClass} pane-header--${variant}`} id={id} type="button" aria-expanded={ariaExpanded}>
        <span className="workspace-symbol" aria-hidden="true">{leading}</span>
        <span className="workspace-copy"><b id={titleId}>{title}</b></span>
        <span className="chevron" aria-hidden="true">{trailing}</span>
      </button>
    )
  }
  if (variant === 'route') {
    return (
      <header className={`pane-header ${legacyClass} pane-header--${variant}`}>
        <div className="route-heading">
          {(eyebrow !== undefined || eyebrowId) && <div className="eyebrow" id={eyebrowId}>{eyebrow}</div>}
          <div className="route-title-line">
            <h1 id={titleId}>{title}</h1>
            {(status !== undefined || statusId) && <span className="status-pill" id={statusId}>{status}</span>}
          </div>
          {(subtitle !== undefined || subtitleId) && <p id={subtitleId}>{subtitle}</p>}
        </div>
        <div className="route-actions" id={actionsId}>{actions}</div>
      </header>
    )
  }
  return (
    <header className={`pane-header ${legacyClass} pane-header--${variant}`}>
      <div className="pane-header-copy">
        {eyebrow && <span className="pane-header-eyebrow eyebrow" id={eyebrowId}>{eyebrow}</span>}
        <b id={titleId} {...(titleDataKey === 'template' ? { 'data-template-name': true } : {})}>{title}</b>
        {subtitle && <span id={subtitleId} {...(subtitleDataKey === 'preview-status' ? { 'data-preview-status': true } : {})}>{subtitle}</span>}
      </div>
      {status && <span className="pane-header-status" id={statusId}>{status}</span>}
      {actions && <div className="pane-header-actions" id={actionsId}>{actions}</div>}
    </header>
  )
}
