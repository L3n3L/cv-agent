import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '../../styles.css'

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
      <div className="brand-lockup"><strong>CVAgent</strong><span>简历制作工作台</span></div>
      <button className="sidebar-toggle" id="sidebarToggle" type="button" aria-label="收起导航栏" aria-expanded="true"><span aria-hidden="true">‹</span><small>收起</small></button>
      <button className="workspace-switcher" id="workspaceSwitcher" type="button" aria-expanded="false">
        <span className="workspace-symbol" aria-hidden="true"><Icon name="folder" /></span>
        <span className="workspace-copy"><small>当前工作区</small><b id="workspaceLabel">选择工作区</b></span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="workspace-menu" id="workspaceMenu" hidden>
        <div id="workspaceOptions"><small>正在读取工作区…</small></div>
        <button type="button" id="workspaceImportButton">选择简历工作区<small>从本地目录导入 Markdown、模板和素材</small></button>
        <input id="workspaceFiles" type="file" {...{ webkitdirectory: '', directory: '' }} multiple hidden />
      </div>
      <nav className="primary-nav" aria-label="简历制作模块">
        <p className="nav-caption">简历制作</p>
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
      <header className="route-header">
        <div className="route-heading"><div className="eyebrow" id="routeKicker">简历工作台</div><div className="route-title-line"><h1 id="routeTitle">选择工作区</h1><span className="status-pill" id="routeStatus">等待连接</span></div><p id="routeMeta">选择工作区后加载 resume.md</p></div>
        <div className="route-actions" id="routeActions"><button className="ghost-button" id="workbenchAssistantButton" type="button">打开 Agent</button></div>
      </header>
      <section className="route-view" id="routeView" aria-live="polite"><div className="route-content" id="routeContent" /></section>
    </main>
  )
}

function AgentPane() {
  return (
    <aside className="assistant-drawer" id="assistantDrawer" aria-label="Agent 助手面板" aria-hidden="true" hidden>
      <div className="drawer-header"><div><h2>Agent</h2></div><button className="ghost-button" id="drawerClose" type="button">收起</button></div>
      <div className="assistant-context" title="仅作用于当前会话"><span>选择工作区后开始对话</span></div>
      <div id="assistantContent" />
    </aside>
  )
}

function loadLegacyScripts() {
  const legacyBase = import.meta.env.DEV ? 'http://127.0.0.1:3191' : ''
  const scripts = ['api-client.js', 'client-events.js', 'agent-chat.js', 'app.js']
  return scripts.reduce((promise, script) => promise.then(() => new Promise<void>((resolve, reject) => {
    const element = document.createElement('script')
    element.src = `${legacyBase}/${script}`
    element.onload = () => resolve()
    element.onerror = () => reject(new Error(`加载旧业务模块失败：${script}`))
    document.body.append(element)
  })), Promise.resolve())
}

function AppShell() {
  useEffect(() => {
    void loadLegacyScripts().catch((error) => {
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

createRoot(document.getElementById('root')!).render(<StrictMode><AppShell /></StrictMode>)
