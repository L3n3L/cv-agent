import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { PaneHeader } from './components/PaneHeader'
import { mountA4Pane, mountMarkdownPane, unmountReactPanes } from './react-pane-bridge'
import type { MarkdownPaneOptions } from './features/markdown/MarkdownPane'
import type { A4PaneOptions } from './features/preview/A4Pane'

declare global {
  interface Window {
    CVAgentReact?: {
      mountMarkdownPane: (container: Element, options: MarkdownPaneOptions) => void
      mountA4Pane: (container: Element, options: A4PaneOptions) => void
      unmountReactPanes: () => void
    }
  }
}

type IconName = 'folder' | 'home' | 'preview' | 'templates' | 'checks' | 'versions'

const navItems: Array<{ route: string; label: string; icon: IconName }> = [
  { route: 'workbench', label: '工作台', icon: 'home' },
  { route: 'preview', label: '预览', icon: 'preview' },
  { route: 'templates', label: '模板库', icon: 'templates' },
  { route: 'checks', label: '排版检查', icon: 'checks' },
  { route: 'versions', label: '投递版本', icon: 'versions' },
]

function Icon({ name }: { name: IconName }) {
  if (name === 'folder') return <svg viewBox="0 0 24 24"><path d="M4 7.5h6l2 2h8v8.5H4z" /><path d="M4 7.5V6h6l2 2" /></svg>
  if (name === 'home') return <svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></svg>
  if (name === 'preview') return <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1" /><rect x="8" y="8" width="8" height="8" /></svg>
  if (name === 'templates') return <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 10h16M4 15h16M10 4v16M15 4v16" /></svg>
  if (name === 'checks') return <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
  return <svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
}

function Sidebar() {
  return (
    <aside className="sidebar" aria-label="CVAgent 导航">
      <PaneHeader
        variant="brand"
        title="CVAgent"
        actions={<button className="sidebar-toggle" id="sidebarToggle" type="button" aria-label="收起导航栏" aria-expanded="true"><svg className="sidebar-toggle-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M9 3v18" /></svg><small>收起</small></button>}
      />
      <PaneHeader variant="workspace" id="workspaceSwitcher" ariaExpanded={false} title="选择工作区" titleId="workspaceLabel" leading={<Icon name="folder" />} trailing="⌄" />
      <div className="workspace-menu" id="workspaceMenu" hidden>
        <div id="workspaceOptions"><small>正在读取工作区…</small></div>
        <button type="button" id="workspaceCreateButton">新建空白工作区<small>从一份空白简历开始</small></button>
        <button type="button" id="workspaceImportButton">选择简历工作区<small>从本地目录导入 Markdown、模板和素材</small></button>
        <input id="workspaceFiles" type="file" {...{ webkitdirectory: '', directory: '' }} multiple hidden />
      </div>
      <nav className="primary-nav" aria-label="简历制作模块">
        {navItems.map((item) => <button className={`nav-item${item.route === 'workbench' ? ' active' : ''}`} data-route={item.route} type="button" key={item.route}><span className="nav-icon" aria-hidden="true"><Icon name={item.icon} /></span><span>{item.label}</span>{item.route === 'checks' && <em className="nav-badge" id="checksBadge" hidden />}</button>)}
      </nav>
      <section className="session-section" aria-label="当前工作区会话">
        <div className="section-heading"><span>会话</span><button type="button" title="新建会话" id="newSession">＋</button></div>
        <div id="sessionList"><small className="session-empty">选择工作区后读取真实会话</small></div>
      </section>
      <div className="sidebar-foot"><div className="connection"><i /><span id="connectionStatus">等待选择工作区</span></div><button className="settings-button" type="button">设置</button></div>
    </aside>
  )
}

function MainStage() {
  return (
    <main className="main-stage">
      <PaneHeader
        variant="route"
        eyebrow=""
        eyebrowId="routeKicker"
        title="选择工作区"
        titleId="routeTitle"
        subtitle=""
        subtitleId="routeMeta"
        status=""
        statusId="routeStatus"
        actionsId="routeActions"
        actions={<button className="ghost-button" id="workbenchAssistantButton" type="button">打开 Agent</button>}
      />
      <section className="route-view" id="routeView" aria-live="polite"><div className="route-content" id="routeContent" /></section>
    </main>
  )
}

function AgentPane() {
  return (
    <aside className="assistant-drawer" id="assistantDrawer" aria-label="Agent 助手面板" aria-hidden="true" hidden>
      <PaneHeader variant="agent" title="Agent" actions={<button className="ghost-button" id="drawerClose" type="button">收起</button>} />
      <div className="assistant-context" title="仅作用于当前会话"><span>选择工作区后开始对话</span></div>
      <div id="assistantContent" />
    </aside>
  )
}

async function loadRuntimeModules() {
  // These modules are still DOM-oriented, but are now bundled with the
  // React entrypoint and kept in one explicit runtime boundary. Importing
  // them after the shell mounts preserves their initialization contract.
  await import('./runtime/api-client.js')
  await import('./runtime/client-events.js')
  await import('./runtime/agent-chat.js')
  await import('./runtime/workbench-runtime.js')
}

function AppShell() {
  useEffect(() => {
    window.CVAgentReact = { mountMarkdownPane, mountA4Pane, unmountReactPanes }
    void loadRuntimeModules().catch((error) => {
      const toast = document.getElementById('toast')
      if (toast) toast.textContent = error instanceof Error ? error.message : String(error)
      console.error(error)
    })
  }, [])

  return (
    <>
      <div className="app-shell" id="appShell">
        <Sidebar />
        <div className="resize-handle resize-sidebar" data-resize="sidebar" role="separator" aria-orientation="vertical" aria-label="调整导航栏宽度" aria-valuemin={0} aria-valuemax={360} tabIndex={0} />
        <MainStage />
        <div className="resize-handle resize-assistant" data-resize="assistant" role="separator" aria-label="调整 Agent 面板宽度" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={520} tabIndex={0} />
        <AgentPane />
      </div>
      <div className="toast" id="toast" role="status" />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<AppShell />)
