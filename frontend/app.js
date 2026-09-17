const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]

const routeCopy = {
  workbench: { kicker: '简历工作台', title: '' },
  preview: { kicker: '成品', title: '预览' },
  templates: { kicker: '工作区资源', title: '模板库' },
  checks: { kicker: '验收', title: '排版检查' },
  versions: { kicker: '工作区成果', title: '投递版本' },
}
let currentRoute = 'workbench'
let activeSessionId = ''
const liveState = {
  workspaceId: '',
  workspace: null,
  sessionId: '',
  resumePath: 'resume.md',
  sourceContent: '',
  draftContent: '',
  messages: [],
  templateId: 'campus-standard',
  templateName: '校招标准',
  templates: [],
  presentation: null,
  targetPages: 1,
  renderId: '',
  workflowState: 'intake',
  blockerCount: 0,
  measurement: null,
  measurementPending: false,
  measuredRenderKey: '',
  continuationKey: '',
  loading: false,
}
const api = window.cvAgentApi
let measurementInFlightKey = ''
let workflowEventSource = null
let workflowEventSessionId = ''

function previewUrl() {
  return activeSessionId ? `/api/agent/preview?sessionId=${encodeURIComponent(activeSessionId)}` : ''
}

function templatePreviewUrl(templateId) {
  if (!activeSessionId || !templateId) return ''
  return `/api/template-preview?sessionId=${encodeURIComponent(activeSessionId)}&templateId=${encodeURIComponent(templateId)}&t=${encodeURIComponent(liveState.renderId || 'draft')}`
}

const toolLabels = {
  workspace_info: '读取工作区',
  resume_prepare: '准备简历任务',
  resume_read: '读取简历',
  resume_check: '检查内容',
  template_list: '读取模板库',
  template_select: '切换模板',
  presentation_update: '调整版式',
  resume_write: '写入隔离草稿',
  resume_render: '重新渲染',
  resume_metrics: '接收 A4 测量',
  resume_finalize: '完成验收',
}

function connectWorkflowEvents() {
  if (!liveState.sessionId || typeof window.EventSource !== 'function') return
  if (workflowEventSessionId === liveState.sessionId && workflowEventSource) return
  workflowEventSource?.close()
  workflowEventSessionId = liveState.sessionId
  workflowEventSource = new EventSource(`/api/agent/events?sessionId=${encodeURIComponent(liveState.sessionId)}`)
  workflowEventSource.addEventListener('workflow', (event) => {
    let payload
    try { payload = JSON.parse(event.data) } catch { return }
    const progress = $('.turn-progress.is-running')
    if (!progress || payload.sessionId !== liveState.sessionId) return
    const label = toolLabels[payload.toolName] || payload.toolName || 'Agent 处理'
    const copy = progress.querySelector('span')
    const timing = progress.querySelector('time')
    if (payload.event === 'tool_call_started') {
      if (copy) copy.textContent = label
      if (timing) timing.textContent = '进行中'
    } else if (payload.event === 'tool_call_succeeded') {
      if (copy) copy.textContent = `${label}已完成`
      if (timing) timing.textContent = '完成'
    } else if (payload.event === 'tool_call_failed') {
      if (copy) copy.textContent = `${label}失败`
      if (timing) timing.textContent = '失败'
    } else if (payload.event === 'agent_run_started') {
      if (copy) copy.textContent = 'Agent 正在处理'
    }
  })
}

function measurePreviewFrame(frame, identity = {}) {
  const sessionId = identity.sessionId || liveState.sessionId
  const renderId = identity.renderId || liveState.renderId
  const key = `${sessionId}:${renderId}`
  if (!sessionId || !renderId || frame.classList.contains('template-real-thumb') || frame.dataset.measureKey === key) return
  frame.dataset.measureKey = key
  frame.addEventListener('load', () => {
    if (frame.dataset.measureKey !== key || liveState.sessionId !== sessionId || liveState.renderId !== renderId) return
    if (liveState.measuredRenderKey === key || measurementInFlightKey === key) return
    const documentRoot = frame.contentDocument?.documentElement
    const pages = [...(frame.contentDocument?.querySelectorAll('.cvagent-resume-page') || [])]
    if (!documentRoot || !pages.length) return
    const occupancy = pages.map((page) => {
      const content = page.querySelector('.cvagent-resume-page-content') || page
      const available = Math.max(1, content.clientHeight)
      const used = Math.min(available, Math.max(content.scrollHeight, content.querySelector('.cvagent-resume-flow')?.scrollHeight || 0))
      return Number(clamp(used / available, 0, 1).toFixed(3))
    })
    const pageCount = Number(documentRoot.dataset.pageCount || pages.length)
    const overflow = documentRoot.dataset.pageOverflow === 'true' || pages.some((page) => page.scrollHeight > page.clientHeight + 1)
    measurementInFlightKey = key
    liveState.measurementPending = true
    void api.post('/api/agent/measure', { sessionId, renderId, pageCount, occupancy, overflow })
      .then(({ body }) => {
        liveState.measuredRenderKey = key
        liveState.measurement = body.measurement || null
        liveState.workflowState = body.state || liveState.workflowState
        liveState.blockerCount = body.verification?.blockers?.length || 0
        updateHeader()
        if (body.state === 'needs_revision' && liveState.continuationKey !== key) {
          liveState.continuationKey = key
          void continueAgentAfterMeasurement(key, body.verification?.blockers || [])
        }
      })
      .catch((error) => showToast(`预览测量失败：${errorText(error)}`))
      .finally(() => {
        if (measurementInFlightKey === key) measurementInFlightKey = ''
        liveState.measurementPending = false
      })
  })
}

function syncPreviewFrames() {
  const src = previewUrl()
  $$('.direct-preview-stage iframe, .full-real-frame').forEach((frame) => {
    if (src) {
      const identity = { sessionId: liveState.sessionId, renderId: liveState.renderId }
      measurePreviewFrame(frame, identity)
      const previewKey = `${identity.sessionId}:${identity.renderId}`
      if (frame.dataset.previewKey !== previewKey) {
        frame.dataset.previewKey = previewKey
        frame.src = src
      }
      return
    }
    const empty = document.createElement('div')
    empty.className = 'preview-empty'
    empty.setAttribute('role', 'status')
    empty.textContent = '选择工作区后显示真实预览'
    frame.replaceWith(empty)
  })
  syncTemplatePreviewFrames()
}

function syncTemplatePreviewFrames() {
  $$('.template-real-thumb').forEach((frame) => {
    const src = templatePreviewUrl(frame.dataset.templateId)
    if (!src) {
      frame.removeAttribute('src')
      frame.dataset.previewKey = ''
      return
    }
    const previewKey = `${liveState.sessionId}:${frame.dataset.templateId}:${liveState.renderId || 'draft'}`
    if (frame.dataset.previewKey === previewKey) return
    frame.dataset.previewKey = previewKey
    frame.src = src
  })
}

async function continueAgentAfterMeasurement(renderKey, blockers) {
  const [sessionId, renderId] = renderKey.split(':')
  if (!sessionId || !renderId || liveState.sessionId !== sessionId || liveState.renderId !== renderId) return
  showToast('排版未通过，Agent 正在继续调整…')
  try {
    const { body } = await api.post('/api/agent/continue', { sessionId, renderId, message: `真实 A4 测量已回传，当前验收未通过。请继续处理当前草稿，不能假设指标已经通过；根据这些阻断项调整内容或版式，重新检查并重新渲染。${blockers.length ? `\n阻断项：\n- ${blockers.join('\n- ')}` : ''}` })
    if (liveState.sessionId !== sessionId) return
    liveState.workflowState = body.state || liveState.workflowState
    liveState.renderId = body.context?.renderId || liveState.renderId
    liveState.measuredRenderKey = ''
    liveState.continuationKey = ''
    syncPreviewFrames()
    updateHeader()
    const assistantMessage = body.assistantText || 'Agent 已根据真实排版结果继续处理。'
    liveState.messages.push({ role: 'assistant', content: assistantMessage })
    appendAgentResponse(assistantMessage)
  } catch (error) {
    liveState.continuationKey = ''
    showToast(`Agent 续跑失败：${errorText(error)}`)
  }
}

function currentSessionData() {
  if (!liveState.workspace) return { title: '选择工作区', status: '等待连接', meta: '选择工作区后加载 resume.md' }
  return {
    title: liveState.workspace.name || '未命名工作区',
    status: liveState.workflowState || '已连接',
    meta: `${liveState.resumePath} · ${liveState.templateName || liveState.templateId} · A4`,
  }
}

function errorText(error) {
  const suffix = error?.requestId ? `（requestId: ${error.requestId}）` : ''
  return `${error?.message || '请求失败'}${suffix}`
}

function updateConnectionStatus() {
  const label = $('#workspaceLabel')
  const connection = $('#connectionStatus')
  if (liveState.workspace) {
    if (label) label.textContent = liveState.workspace.name
    if (connection) connection.textContent = `已连接 · ${liveState.workspace.name}`
  } else {
    if (label) label.textContent = '未选择工作区'
    if (connection) connection.textContent = '等待选择工作区'
  }
}

function renderWorkspaceOptions(workspaces) {
  const container = $('#workspaceOptions')
  if (!container) return
  container.replaceChildren()
  if (!workspaces.length) {
    const empty = document.createElement('small')
    empty.textContent = '尚未导入工作区'
    container.append(empty)
    return
  }
  for (const workspace of workspaces) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'workspace-option'
    const name = document.createElement('span')
    name.textContent = workspace.name || '未命名工作区'
    const meta = document.createElement('small')
    meta.textContent = `${workspace.resumeName || 'resume.md'} · ${workspace.fileCount || 0} 个文件`
    button.append(name, meta)
    button.addEventListener('click', () => {
      $('#workspaceMenu').hidden = true
      void bootstrapWorkspace(workspace)
    })
    container.append(button)
  }
}

function sessionStateText(session) {
  const task = session?.taskRef?.current
  const state = task?.state || session?.status || 'idle'
  const measurement = task?.measurements
  if (state === 'accepted') return `验收通过 · ${measurement?.pageCount || 1} 页`
  if (state === 'saved') return '已保存 · 正式版本'
  if (state === 'needs_revision') return `需要调整 · ${task?.blockers?.length || 0} 项`
  if (state === 'rendered') return '已渲染 · 待测量'
  return state === 'drafting' ? '草稿 · 待渲染' : state
}

function sessionTitle(session) {
  if (session?.sessionId === liveState.sessionId) return '当前会话'
  const resumeName = String(session?.resumePath || session?.resumeId || '简历').split(/[\\/]/).pop()
  const updatedAt = session?.updatedAt ? new Date(session.updatedAt) : null
  const date = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '历史'
  return `${resumeName} · ${date}`
}

function renderSessionList(records = []) {
  const container = $('#sessionList')
  if (!container) return
  container.replaceChildren()
  if (!records.length) {
    const empty = document.createElement('small')
    empty.className = 'session-empty'
    empty.textContent = '当前工作区暂无历史会话'
    container.append(empty)
    return
  }
  for (const session of records) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `session-item${session.sessionId === liveState.sessionId ? ' active' : ''}`
    button.dataset.sessionId = session.sessionId
    const dot = document.createElement('span')
    dot.className = 'session-dot'
    const copy = document.createElement('span')
    const title = document.createElement('b')
    title.textContent = session.title || sessionTitle(session)
    const status = document.createElement('small')
    status.textContent = sessionStateText(session)
    copy.append(title, status)
    button.append(dot, copy)
    button.addEventListener('click', () => { void restoreSession(session.sessionId) })
    container.append(button)
  }
}

async function loadSessionsForWorkspace() {
  if (!liveState.workspaceId) {
    renderSessionList([])
    return
  }
  try {
    const { body } = await api.get(`/api/sessions?workspaceId=${encodeURIComponent(liveState.workspaceId)}`)
    renderSessionList(Array.isArray(body.sessions) ? body.sessions : [])
  } catch (error) {
    renderSessionList([])
    showToast(`读取会话失败：${errorText(error)}`)
  }
}

async function restoreSession(sessionId) {
  if (!sessionId) return
  try {
    const { body } = await api.get(`/api/session?sessionId=${encodeURIComponent(sessionId)}`)
    const session = body.session || {}
    liveState.workspace = body.workspace || liveState.workspace
    liveState.workspaceId = liveState.workspace?.id || session.workspaceId || liveState.workspaceId
    liveState.sessionId = session.sessionId || sessionId
    activeSessionId = liveState.sessionId
    liveState.resumePath = body.source?.path || session.resumePath || liveState.resumePath
    liveState.sourceContent = body.source?.content || liveState.sourceContent
    liveState.draftContent = body.draft?.content || liveState.sourceContent
    liveState.messages = Array.isArray(session.messages) ? session.messages : []
    liveState.presentation = body.presentation || null
    liveState.templateId = body.context?.templateId || session.templateId || liveState.templateId
    liveState.templateName = liveState.templates.find((item) => item.id === liveState.templateId)?.name || liveState.templateId
    liveState.targetPages = session.taskRef?.current?.targetPages || liveState.targetPages
    liveState.renderId = body.context?.renderId || ''
    liveState.workflowState = body.state || session.status || 'idle'
    liveState.blockerCount = session.taskRef?.current?.blockers?.length || 0
    liveState.measurement = session.taskRef?.current?.measurements || null
    liveState.measuredRenderKey = liveState.measurement && liveState.renderId ? `${liveState.sessionId}:${liveState.renderId}` : ''
    liveState.continuationKey = ''
    updateConnectionStatus()
    renderSessionList([session])
    renderRoute(currentRoute)
    showToast(`已恢复「${liveState.templateName}」会话`)
    await loadSessionsForWorkspace()
  } catch (error) {
    showToast(`会话恢复失败：${errorText(error)}`)
  }
}

async function bootstrapWorkspace(workspace) {
  if (!workspace?.id) return
  liveState.loading = true
  liveState.workspace = workspace
  liveState.workspaceId = workspace.id
  liveState.sessionId = ''
  activeSessionId = ''
  updateConnectionStatus()
  showToast('正在加载工作区…')
  try {
    const { body } = await api.post('/api/agent/bootstrap', { workspaceId: workspace.id, targetPages: 1, templateId: liveState.templateId })
    liveState.workspace = body.workspace || workspace
    liveState.workspaceId = liveState.workspace.id
    liveState.sessionId = body.sessionId
    liveState.resumePath = body.source?.path || liveState.resumePath
    liveState.sourceContent = body.source?.content || ''
    liveState.draftContent = liveState.sourceContent
    liveState.messages = Array.isArray(body.messages) ? body.messages : []
    liveState.presentation = body.presentation || null
    liveState.templateId = body.context?.templateId || liveState.templateId
    liveState.templateName = liveState.templates.find((item) => item.id === liveState.templateId)?.name || liveState.templateName
    liveState.targetPages = body.targetPages || liveState.targetPages
    liveState.renderId = body.context?.renderId || ''
    liveState.workflowState = body.state || 'drafting'
    liveState.blockerCount = 0
    liveState.measurement = null
    liveState.measuredRenderKey = ''
    liveState.continuationKey = ''
    activeSessionId = liveState.sessionId
    await loadSessionsForWorkspace()
    updateConnectionStatus()
    renderRoute('workbench')
    showToast('工作区已连接，简历草稿和预览已加载')
  } catch (error) {
    liveState.workspace = null
    liveState.workspaceId = ''
    liveState.sessionId = ''
    activeSessionId = ''
    updateConnectionStatus()
    showToast(`工作区加载失败：${errorText(error)}`)
  } finally {
    liveState.loading = false
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  return btoa(binary)
}

async function importSelectedWorkspace(fileList) {
  const files = [...fileList]
  if (!files.length) return
  const supported = new Set(['.md', '.markdown', '.txt', '.json', '.css', '.csv', '.yaml', '.yml', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
  const firstRoot = files[0].webkitRelativePath?.split('/')[0] || '新工作区'
  const payload = []
  for (const file of files) {
    const relativePath = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name
    const extension = `.${file.name.split('.').pop()?.toLowerCase()}`
    if (!relativePath || !supported.has(extension)) continue
    const binary = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']).has(extension)
    payload.push({ path: relativePath, encoding: binary ? 'base64' : 'utf8', content: binary ? arrayBufferToBase64(await file.arrayBuffer()) : await file.text() })
  }
  if (!payload.length) throw new Error('没有找到可导入的 Markdown、模板或素材文件')
  const { body } = await api.post('/api/workspaces/import', { name: firstRoot, files: payload })
  await bootstrapWorkspace(body.workspace)
}

async function loadWorkspaces() {
  try {
    const { body } = await api.get('/api/workspaces')
    const workspaces = Array.isArray(body.workspaces) ? body.workspaces : []
    renderWorkspaceOptions(workspaces)
    if (workspaces[0]) {
      const sessionsResponse = await api.get(`/api/sessions?workspaceId=${encodeURIComponent(workspaces[0].id)}`)
      const recentSession = Array.isArray(sessionsResponse.body.sessions) ? sessionsResponse.body.sessions[0] : null
      if (recentSession?.sessionId) await restoreSession(recentSession.sessionId)
      else await bootstrapWorkspace(workspaces[0])
    }
  } catch (error) {
    renderWorkspaceOptions([])
    showToast(`读取工作区失败：${errorText(error)}`)
  }
}
let workbenchMode = 'chat'
let previewOpen = false
const layoutStorageKey = 'cvagent-layout-v2'
const layoutPrefs = { sidebar: 248, expandedSidebar: 248, assistant: 350, editor: 0, collapsed: false }
try {
  Object.assign(layoutPrefs, JSON.parse(localStorage.getItem(layoutStorageKey) || '{}'))
} catch {}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
function saveLayoutPrefs() {
  try { localStorage.setItem(layoutStorageKey, JSON.stringify(layoutPrefs)) } catch {}
}

function applyLayoutPrefs() {
  const shell = $('#appShell')
  if (!shell) return
  shell.style.setProperty('--sidebar-width', `${layoutPrefs.collapsed ? 0 : layoutPrefs.sidebar}px`)
  shell.style.setProperty('--assistant-width', `${layoutPrefs.assistant}px`)
  if (layoutPrefs.editor > 0) shell.style.setProperty('--editor-width', `${layoutPrefs.editor}px`)
  else shell.style.removeProperty('--editor-width')
  shell.classList.toggle('sidebar-collapsed', layoutPrefs.collapsed)
  const toggle = $('#sidebarToggle')
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!layoutPrefs.collapsed))
    toggle.setAttribute('aria-label', layoutPrefs.collapsed ? '展开导航栏' : '收起导航栏')
    toggle.querySelector('span').textContent = layoutPrefs.collapsed ? '›' : '‹'
    toggle.querySelector('small').textContent = layoutPrefs.collapsed ? '展开' : '收起'
  }
  const sidebarHandle = $('.resize-sidebar')
  const assistantHandle = $('.resize-assistant')
  const editorHandle = $('.resize-editor')
  if (sidebarHandle) sidebarHandle.setAttribute('aria-valuenow', String(layoutPrefs.collapsed ? 0 : layoutPrefs.sidebar))
  if (assistantHandle) assistantHandle.setAttribute('aria-valuenow', String(layoutPrefs.assistant))
  if (editorHandle) {
    const editor = $('.editor-pane')
    if (editor) editorHandle.setAttribute('aria-valuenow', String(Math.round(editor.getBoundingClientRect().width)))
  }
}

function updateResize(type, clientX) {
  if (type === 'sidebar') {
    if (clientX <= 140) {
      layoutPrefs.collapsed = true
    } else {
      layoutPrefs.collapsed = false
      layoutPrefs.sidebar = clamp(clientX, 220, 360)
      layoutPrefs.expandedSidebar = layoutPrefs.sidebar
    }
  }
  if (type === 'assistant') {
    layoutPrefs.assistant = clamp(window.innerWidth - clientX, 300, 520)
  }
  if (type === 'editor') {
    const split = $('.workbench-split')
    if (!split) return
    const rect = split.getBoundingClientRect()
    layoutPrefs.editor = clamp(clientX - rect.left, 280, Math.max(320, rect.width - 328))
  }
  applyLayoutPrefs()
}

function bindResizableLayout() {
  let activeResize = null
  document.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest?.('[data-resize]')
    if (!handle || (handle.dataset.resize === 'assistant' && !previewOpen)) return
    event.preventDefault()
    activeResize = { handle, type: handle.dataset.resize, pointerId: event.pointerId }
    handle.setPointerCapture?.(event.pointerId)
    document.body.classList.add('is-resizing')
    $('#appShell').classList.add('is-resizing')
    updateResize(activeResize.type, event.clientX)
  })
  document.addEventListener('pointermove', (event) => {
    if (activeResize) updateResize(activeResize.type, event.clientX)
  })
  const endResize = () => {
    if (!activeResize) return
    activeResize.handle.releasePointerCapture?.(activeResize.pointerId)
    activeResize = null
    document.body.classList.remove('is-resizing')
    $('#appShell').classList.remove('is-resizing')
    saveLayoutPrefs()
  }
  document.addEventListener('pointerup', endResize)
  document.addEventListener('pointercancel', endResize)
  document.addEventListener('keydown', (event) => {
    const handle = event.target.closest?.('[data-resize]')
    if (!handle || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const type = handle.dataset.resize
    if (type === 'sidebar') {
      if (event.key === 'Home') layoutPrefs.collapsed = true
      else if (event.key === 'End') { layoutPrefs.collapsed = false; layoutPrefs.sidebar = 360; layoutPrefs.expandedSidebar = 360 }
      else if (layoutPrefs.collapsed && event.key === 'ArrowRight') { layoutPrefs.collapsed = false; layoutPrefs.sidebar = layoutPrefs.expandedSidebar }
      else if (!layoutPrefs.collapsed) { layoutPrefs.sidebar = clamp(layoutPrefs.sidebar + (event.key === 'ArrowRight' ? 16 : -16), 220, 360); layoutPrefs.expandedSidebar = layoutPrefs.sidebar }
    }
    if (type === 'assistant') {
      if (event.key === 'Home') layoutPrefs.assistant = 520
      else if (event.key === 'End') layoutPrefs.assistant = 300
      else layoutPrefs.assistant = clamp(layoutPrefs.assistant + (event.key === 'ArrowLeft' ? 16 : -16), 300, 520)
    }
    if (type === 'editor') {
      const split = $('.workbench-split')
      if (!split) return
      const rect = split.getBoundingClientRect()
      if (event.key === 'Home') layoutPrefs.editor = 280
      else if (event.key === 'End') layoutPrefs.editor = Math.max(320, rect.width - 328)
      else layoutPrefs.editor = clamp((layoutPrefs.editor || rect.width / 2) + (event.key === 'ArrowRight' ? 16 : -16), 280, Math.max(320, rect.width - 328))
    }
    applyLayoutPrefs()
    saveLayoutPrefs()
  })
  $('#sidebarToggle').addEventListener('click', () => {
    layoutPrefs.collapsed = !layoutPrefs.collapsed
    if (!layoutPrefs.collapsed) layoutPrefs.sidebar = layoutPrefs.expandedSidebar || 248
    applyLayoutPrefs()
    saveLayoutPrefs()
  })
  applyLayoutPrefs()
}

function showToast(message) {
  const toast = $('#toast')
  toast.textContent = message
  toast.classList.add('show')
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2200)
}

function updateSessionStatus(status) {
  $('#routeStatus').textContent = status
}

function previewStatusText() {
  const target = liveState.targetPages || 1
  const measured = liveState.measurement
  if (measured) return `${liveState.workflowState === 'accepted' ? '验收通过' : '需要调整'} · ${measured.pageCount} 页 / 目标 ${target} 页`
  return liveState.renderId ? '草稿 · 待测量' : '等待渲染'
}

function updatePreviewStatus() {
  const status = previewStatusText()
  const direct = $('[data-preview-status]')
  const foot = $('[data-preview-foot-status]')
  const full = $('[data-full-preview-status]')
  if (direct) direct.textContent = status
  if (foot) foot.textContent = liveState.measurement ? '已完成真实 A4 测量' : liveState.renderId ? '等待真实 A4 测量' : '等待渲染'
  if (full) full.textContent = `${liveState.renderId ? '当前 render' : '暂无 render'} · ${status}`
}

function updateHeader() {
  const data = currentSessionData()
  const copy = routeCopy[currentRoute]
  const routeStatus = { templates: '加载中', versions: '加载中', checks: '待检查' }
  $('#routeKicker').textContent = copy.kicker
  $('#routeTitle').textContent = currentRoute === 'workbench' ? data.title : copy.title
  $('#routeStatus').textContent = currentRoute === 'workbench' ? data.status : routeStatus[currentRoute]
  $('#routeStatus').classList.toggle('neutral-status', Boolean(routeStatus[currentRoute] && currentRoute !== 'checks'))
  $('#routeMeta').textContent = currentRoute === 'templates' || currentRoute === 'versions' ? (liveState.workspace ? `${liveState.workspace.name} · 当前工作区` : '请先选择工作区') : data.meta
  const templateName = $('[data-template-name]')
  if (templateName) templateName.textContent = liveState.templateName || liveState.templateId
  const assistantContext = $('.assistant-context span')
  if (assistantContext) assistantContext.textContent = liveState.workspace ? `${data.title} · 当前草稿` : '选择工作区后开始对话'
  const checksBadge = $('#checksBadge')
  if (checksBadge) {
    checksBadge.textContent = liveState.blockerCount ? String(liveState.blockerCount) : ''
    checksBadge.hidden = !liveState.blockerCount
  }
  const saveButton = $('#saveVersionButton, #createVersionButton')
  if (saveButton) {
    const canSave = liveState.workflowState === 'accepted'
    saveButton.disabled = !canSave
    saveButton.title = canSave ? '保存当前已通过真实 A4 验收的正式版本' : '真实 A4 验收通过后才能保存正式版本'
  }
  updatePreviewStatus()
}

function setPreviewOpen(open) {
  previewOpen = open
  const visible = open && currentRoute === 'workbench'
  const drawer = $('#assistantDrawer')
  drawer.hidden = !visible
  drawer.setAttribute('aria-hidden', String(!visible))
  $('#appShell').classList.toggle('assistant-open', visible)
  applyLayoutPrefs()
  const button = $('#workbenchAssistantButton')
  if (button) button.textContent = visible ? '收起 Agent' : '打开 Agent'
}

function chatMessageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) return message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('')
  return ''
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function renderChatRefined() {
  const visibleMessages = (Array.isArray(liveState.messages) ? liveState.messages : []).filter((message) => ['user', 'assistant'].includes(message?.role)).map((message) => ({ role: message.role, content: chatMessageText(message) })).filter((message) => message.content)
  const messages = visibleMessages.map((message) => `<article class="message ${message.role === 'user' ? 'user-message' : 'agent-message'}" aria-label="${message.role === 'user' ? '用户消息' : 'Agent 消息'}"><div class="message-body"><div class="message-bubble">${escapeHtml(message.content)}</div></div></article>`).join('')
  const empty = visibleMessages.length ? '' : '<div class="chat-empty">描述你希望如何修改当前简历，Agent 会先读取当前草稿，再执行检查、渲染和真实 A4 验收。</div>'
  return `<div class="chat-layout"><div class="chat-stream">${empty}${messages}</div><form class="composer" id="composer"><textarea id="messageInput" rows="2" placeholder="描述你要怎么改，例如：把实习经历改成 AI 产品经理投递版"></textarea><div class="composer-foot"><span><kbd>Enter</kbd> 发送 <button type="submit">发送 ↗</button></span></div></form></div>`
}

function renderEditor() {
  const content = liveState.draftContent || liveState.sourceContent || ''
  return `<div class="editor-layout"><div class="editor-head"><div><b>${escapeHtml(liveState.resumePath || 'resume.md')}</b><span>当前会话草稿</span></div><span id="editorState">${content ? '未保存' : '等待工作区'}</span></div><textarea id="resumeEditor" spellcheck="false" placeholder="选择工作区后加载 resume.md">${escapeHtml(content)}</textarea><div class="editor-foot"><span>Markdown 草稿</span><button class="primary-small" id="editorApply" type="button">应用并重新渲染</button></div></div>`
}

async function saveDraftAndRender(content) {
  if (!liveState.sessionId) {
    showToast('请先选择工作区并加载简历')
    return
  }
  const button = $('#editorApply')
  if (button) button.disabled = true
  try {
    const draftResponse = await api.post('/api/agent/draft', { sessionId: liveState.sessionId, content })
    liveState.draftContent = content
    liveState.workflowState = draftResponse.body.state || 'drafting'
    liveState.blockerCount = 0
    const renderResponse = await api.post('/api/agent/render', { sessionId: liveState.sessionId })
    liveState.renderId = renderResponse.body.context?.renderId || liveState.renderId
    liveState.workflowState = renderResponse.body.state || liveState.workflowState
    liveState.blockerCount = 0
    liveState.measurement = null
    liveState.measuredRenderKey = ''
    liveState.continuationKey = ''
    syncPreviewFrames()
    updateHeader()
    $('#editorState').textContent = '已渲染 · 待测量'
    showToast('草稿已保存并重新渲染')
  } catch (error) {
    $('#editorState').textContent = '渲染失败'
    showToast(`保存或渲染失败：${errorText(error)}`)
  } finally {
    if (button) button.disabled = false
  }
}

async function applyPresentationTuning() {
  if (!liveState.sessionId) {
    showToast('请先选择工作区并加载简历')
    return
  }
  const values = {
    fontSize: Number($('#tuningFontSize')?.value || 13),
    lineHeight: Number($('#tuningLineHeight')?.value || 1.5),
    sectionGap: Number($('#tuningSectionGap')?.value || 16),
    pageMargin: Number($('#tuningPageMargin')?.value || 38),
  }
  const button = $('#applyTuning')
  if (button) button.disabled = true
  try {
    const response = await api.post('/api/agent/presentation', { sessionId: liveState.sessionId, layout: values })
    liveState.presentation = response.body.result?.presentation || liveState.presentation
    const rendered = await api.post('/api/agent/render', { sessionId: liveState.sessionId })
    liveState.renderId = rendered.body.context?.renderId || liveState.renderId
    liveState.workflowState = rendered.body.state || response.body.state || 'rendered'
    liveState.blockerCount = 0
    liveState.measurement = null
    liveState.measuredRenderKey = ''
    liveState.continuationKey = ''
    syncPreviewFrames()
    updateHeader()
    const panel = $('#presentationPanel')
    if (panel) panel.hidden = true
    showToast('版式已更新，等待真实 A4 测量')
  } catch (error) {
    showToast(`版式更新失败：${errorText(error)}`)
  } finally {
    if (button) button.disabled = false
  }
}

function renderWorkbench() {
  $('#routeView').innerHTML = `<div class="workbench-view"><div class="workbench-split"><section class="editor-pane" aria-label="Markdown 编辑区">${renderEditor()}</section><div class="resize-handle resize-editor" data-resize="editor" role="separator" aria-label="调整 Markdown 与预览宽度" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="900" tabindex="0"></div><section class="direct-preview-pane" aria-label="A4 预览区"><div class="direct-preview-head"><div><div class="eyebrow">A4 预览</div><b data-template-name>${escapeHtml(liveState.templateName || liveState.templateId)}</b><span data-preview-status>等待渲染</span></div><div class="preview-actions"><span>适配宽度</span><button class="ghost-button" type="button" data-toggle-tuning>手动微调</button></div></div><div class="direct-preview-stage"><div class="direct-preview-frame-wrap"><iframe title="当前简历 A4 直接预览" src="about:blank" scrolling="no"></iframe></div></div><div class="direct-preview-foot"><span><i></i> <span data-preview-foot-status>等待渲染</span></span><button class="secondary-button" type="button" data-open-full-preview>打开完整预览</button></div><div class="presentation-panel" id="presentationPanel" hidden><div class="presentation-panel-head"><b>手动微调</b><button class="ghost-button" type="button" data-close-tuning>关闭</button></div><p>只修改当前会话的隔离版式，不覆盖源文件。</p><div class="tuning-grid"><label>字号<input id="tuningFontSize" type="number" min="11" max="18" step="0.5" value="13"></label><label>行高<input id="tuningLineHeight" type="number" min="1.2" max="2" step="0.05" value="1.5"></label><label>段落间距<input id="tuningSectionGap" type="number" min="6" max="30" step="1" value="16"></label><label>页边距<input id="tuningPageMargin" type="number" min="24" max="72" step="1" value="38"></label></div><button class="primary-small" id="applyTuning" type="button">应用并重新渲染</button></div></section></div></div>`
  syncPreviewFrames()
  applyLayoutPrefs()
  if (liveState.sourceContent) $('#resumeEditor').value = liveState.draftContent || liveState.sourceContent
  const tuningLayout = liveState.presentation?.layout || {}
  for (const [id, key] of [['tuningFontSize', 'fontSize'], ['tuningLineHeight', 'lineHeight'], ['tuningSectionGap', 'sectionGap'], ['tuningPageMargin', 'pageMargin']]) {
    if (tuningLayout[key] !== undefined && $(`#${id}`)) $(`#${id}`).value = tuningLayout[key]
  }
  $('#assistantContent').innerHTML = renderChatRefined()
  $('#editorApply').addEventListener('click', () => { void saveDraftAndRender($('#resumeEditor').value) })
  bindChat()
  $('[data-open-full-preview]').addEventListener('click', () => renderRoute('preview'))
  $('[data-toggle-tuning]').addEventListener('click', () => { $('#presentationPanel').hidden = !$('#presentationPanel').hidden })
  $('[data-close-tuning]').addEventListener('click', () => { $('#presentationPanel').hidden = true })
  $('#applyTuning').addEventListener('click', () => { void applyPresentationTuning() })
}

function renderPreview() {
  $('#routeView').innerHTML = `<div class="preview-page"><div class="page-toolbar preview-actions"><button class="secondary-button" type="button">上一页</button><button class="secondary-button" type="button">下一页</button><select aria-label="预览缩放"><option>100%</option><option>80%</option><option>120%</option></select></div><div class="full-preview-canvas"><div class="full-real-frame-wrap"><iframe class="full-real-frame" title="当前简历完整 A4 预览" src="about:blank"></iframe></div></div><div class="preview-foot"><span><i></i> <span data-full-preview-status>等待渲染</span></span><button class="primary-small" type="button">重新渲染</button></div></div>`
  syncPreviewFrames()
}

function templateCard(template) {
  const selected = template.id === liveState.templateId
  const name = escapeHtml(template.name || template.id)
  const id = escapeHtml(template.id)
  const tags = (Array.isArray(template.tags) ? template.tags : []).slice(0, 4)
  const thumb = activeSessionId
    ? `<iframe class="template-real-thumb" data-template-id="${id}" title="${name}真实模板缩略图" loading="lazy"></iframe>`
    : '<div class="template-thumb-empty">选择工作区后显示真实模板</div>'
  return `<article class="template-card ${selected ? 'selected' : ''}" data-template="${id}"><div class="template-thumb" aria-label="${name}模板预览">${thumb}</div><div class="template-info"><div class="template-name"><b>${name}</b><span>${selected ? '当前使用' : '可选择'}</span></div><small>${escapeHtml(template.id)} · 修订 ${Number(template.revision || 1)}</small><div class="tag-row">${tags.map((tag) => `<i>${escapeHtml(tag)}</i>`).join('')}</div><p class="template-description">${escapeHtml(template.description || '可用于当前简历的独立模板。')}</p><button class="secondary-button template-select" data-template="${id}" type="button" ${selected ? 'disabled' : ''}>${selected ? '当前使用' : '选择模板'}</button></div></article>`
}

function updateTemplateCards() {
  $$('.template-card').forEach((card) => {
    const selected = card.dataset.template === liveState.templateId
    card.classList.toggle('selected', selected)
    const label = card.querySelector('.template-name span')
    const button = card.querySelector('.template-select')
    if (label) label.textContent = selected ? '当前使用' : '可选择'
    if (button) {
      button.textContent = selected ? '当前使用' : '选择模板'
      button.disabled = selected || liveState.loading
    }
  })
}

async function applyTemplate(template, button) {
  if (!liveState.sessionId) {
    showToast('请先选择工作区，模板预览不会写入任何简历')
    return
  }
  if (!template?.id || template.id === liveState.templateId) return
  if (button) button.disabled = true
  liveState.loading = true
  try {
    const selection = await api.post('/api/agent/template', { sessionId: liveState.sessionId, templateId: template.id })
    const rendered = await api.post('/api/agent/render', { sessionId: liveState.sessionId })
    liveState.templateId = selection.body.result?.templateId || template.id
    liveState.templateName = template.name || liveState.templateId
    liveState.renderId = rendered.body.context?.renderId || liveState.renderId
    liveState.workflowState = rendered.body.state || selection.body.state || 'drafting'
    liveState.blockerCount = 0
    liveState.measurement = null
    liveState.measuredRenderKey = ''
    liveState.continuationKey = ''
    updateTemplateCards()
    syncPreviewFrames()
    updateHeader()
    showToast(`已应用「${liveState.templateName}」，正在等待真实 A4 测量`)
  } catch (error) {
    showToast(`模板应用失败：${errorText(error)}`)
    updateTemplateCards()
  } finally {
    liveState.loading = false
    updateTemplateCards()
  }
}

async function renderTemplates() {
  const view = $('#routeView')
  view.scrollTop = 0
  if (!liveState.workspaceId) {
    view.innerHTML = '<div class="empty-view">请先选择工作区，模板库会展示当前简历在每个真实模板下的渲染结果。</div>'
    return
  }
  view.innerHTML = '<div class="templates-page"><div class="loading-line">正在读取工作区模板…</div></div>'
  try {
    const { body } = await api.get(`/api/templates?workspaceId=${encodeURIComponent(liveState.workspaceId)}`)
    liveState.templates = Array.isArray(body.templates) ? body.templates : []
    const selected = liveState.templates.find((item) => item.id === liveState.templateId)
    if (selected) liveState.templateName = selected.name || selected.id
    view.innerHTML = `<div class="templates-page"><div class="template-grid">${liveState.templates.map(templateCard).join('')}</div></div>`
    view.scrollTop = 0
    syncTemplatePreviewFrames()
    $$('.template-select').forEach((button) => button.addEventListener('click', () => {
      const template = liveState.templates.find((item) => item.id === button.dataset.template)
      void applyTemplate(template, button)
    }))
    updateTemplateCards()
  } catch (error) {
    view.innerHTML = `<div class="empty-view">模板库读取失败：${escapeHtml(errorText(error))}</div>`
    showToast(`模板库读取失败：${errorText(error)}`)
  }
}

function checkStatusLabel(status) {
  return status === 'pass' ? '通过' : status === 'error' ? '阻断' : '提醒'
}

function renderCheckContent(task, quality) {
  const measurement = task?.measurements || liveState.measurement
  const blockers = Array.isArray(task?.blockers) ? task.blockers : []
  const qualityChecks = Array.isArray(quality?.checks) ? quality.checks : []
  const details = [...blockers.map((message, index) => ({ id: `blocker-${index}`, status: 'error', message, detail: '真实 A4 验收阻断项' })), ...qualityChecks]
  const pageText = measurement ? `${measurement.pageCount} 页` : '待测量'
  const target = Number(task?.targetPages || liveState.targetPages || 1)
  const renderText = task?.context?.renderId || liveState.renderId ? '已生成' : '暂无'
  const gateText = task?.state === 'accepted' ? '可保存' : '不可用'
  const rows = details.length
    ? details.map((item) => `<article class="blocker-item check-item ${item.status}"><i>${item.status === 'pass' ? '✓' : item.status === 'error' ? '!' : '·'}</i><div><b>${escapeHtml(item.message || '未命名检查')}</b><p>${escapeHtml(item.detail || `内容预检 · ${checkStatusLabel(item.status)}`)}</p><span>${checkStatusLabel(item.status)}</span></div></article>`).join('')
    : '<div class="empty-view">当前没有内容或排版阻断项。</div>'
  return `<div class="checks-page"><div class="check-overview"><div><small>当前页数</small><strong>${pageText}</strong><span>目标 ${target} 页</span></div><div><small>当前渲染</small><strong>${renderText}</strong><span>${escapeHtml(task?.context?.renderId || liveState.renderId || '尚未生成 render')}</span></div><div><small>保存正式版</small><strong>${gateText}</strong><span>需要真实 A4 验收通过</span></div></div><div class="check-summary"><span>内容预检得分 ${quality ? `${quality.score}/100` : '待检查'}</span><span>任务状态 ${escapeHtml(task?.state || liveState.workflowState || '未知')}</span></div><div class="blocker-list">${rows}</div><div class="check-actions"><button class="secondary-button" type="button" data-check-route="workbench">回到编辑</button><button class="secondary-button" type="button" data-check-route="preview">查看成品</button></div></div>`
}

async function renderChecks() {
  const view = $('#routeView')
  view.scrollTop = 0
  if (!liveState.sessionId) {
    view.innerHTML = '<div class="empty-view">请先选择工作区并加载当前会话，才能进行真实检查。</div>'
    return
  }
  view.innerHTML = '<div class="checks-page"><div class="loading-line">正在读取当前 session 并执行内容预检…</div></div>'
  try {
    const sessionResponse = await api.get(`/api/session?sessionId=${encodeURIComponent(liveState.sessionId)}`)
    const task = sessionResponse.body.session?.taskRef?.current || {}
    liveState.workflowState = sessionResponse.body.state || liveState.workflowState
    liveState.targetPages = task.targetPages || liveState.targetPages
    liveState.measurement = task.measurements || liveState.measurement
    const qualityResponse = await api.post('/api/agent/quality', { sessionId: liveState.sessionId, target: 'draft', targetPages: liveState.targetPages })
    liveState.blockerCount = (task.blockers?.length || 0) + (qualityResponse.body.result?.checks || []).filter((item) => item.status === 'error').length
    view.innerHTML = renderCheckContent(task, qualityResponse.body.result)
    view.scrollTop = 0
    $$('[data-check-route]').forEach((button) => button.addEventListener('click', () => renderRoute(button.dataset.checkRoute)))
    updateHeader()
  } catch (error) {
    view.innerHTML = `<div class="empty-view">检查失败：${escapeHtml(errorText(error))}</div>`
    showToast(`检查失败：${errorText(error)}`)
  }
}

function versionDate(value) {
  if (!value) return '时间未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

async function openVersion(versionId) {
  try {
    const { body } = await api.get(`/api/version?workspaceId=${encodeURIComponent(liveState.workspaceId)}&versionId=${encodeURIComponent(versionId)}`)
    liveState.draftContent = body.version?.content || liveState.draftContent
    renderRoute('workbench')
    showToast(`已加载「${body.version?.name || versionId}」到编辑区；应用后写入当前隔离草稿`)
  } catch (error) {
    showToast(`版本打开失败：${errorText(error)}`)
  }
}

async function renameVersion(version) {
  const name = window.prompt('请输入新的版本名称', version.name || '')
  if (!name || name.trim() === version.name) return
  try {
    await api.post('/api/versions/rename', { workspaceId: liveState.workspaceId, versionId: version.id, name: name.trim() })
    showToast(`版本已改名为「${name.trim()}」`)
    await renderVersions()
  } catch (error) {
    showToast(`版本改名失败：${errorText(error)}`)
  }
}

async function archiveVersion(version) {
  if (!window.confirm(`确认归档「${version.name || version.id}」？归档不会删除文件。`)) return
  try {
    await api.post('/api/versions/archive', { workspaceId: liveState.workspaceId, versionId: version.id })
    showToast(`版本「${version.name || version.id}」已归档`)
    await renderVersions()
  } catch (error) {
    showToast(`版本归档失败：${errorText(error)}`)
  }
}

async function renderVersions() {
  const view = $('#routeView')
  view.scrollTop = 0
  if (!liveState.workspaceId) {
    view.innerHTML = '<div class="empty-view">请先选择工作区，正式版本会保存在当前工作区。</div>'
    return
  }
  view.innerHTML = '<div class="versions-page"><div class="loading-line">正在读取工作区正式版本…</div></div>'
  try {
    const { body } = await api.get(`/api/versions?workspaceId=${encodeURIComponent(liveState.workspaceId)}`)
    const versions = Array.isArray(body.versions) ? body.versions : []
    const createDisabled = liveState.workflowState !== 'accepted'
    const records = versions.map((version, index) => `<article class="version-row"><div class="version-mark saved">${String(index + 1).padStart(2, '0')}</div><div class="version-copy"><b>${escapeHtml(version.name || '未命名版本')}</b><span>${escapeHtml(version.templateId || '未记录模板')} · ${escapeHtml(version.templateRevision || '未记录修订')}</span><small>保存于 ${escapeHtml(versionDate(version.savedAt))} · ${version.archived ? '已归档' : '正式版本'}</small></div><em class="${version.archived ? '' : 'saved-label'}">${version.archived ? '已归档' : '已保存'}</em><div class="version-actions"><button class="secondary-button" type="button" data-version-open="${escapeHtml(version.id)}">打开</button><button class="secondary-button" type="button" data-version-rename="${escapeHtml(version.id)}" ${version.archived ? 'disabled' : ''}>改名</button><button class="secondary-button" type="button" data-version-archive="${escapeHtml(version.id)}" ${version.archived ? 'disabled' : ''}>归档</button></div></article>`).join('')
    view.innerHTML = `<div class="versions-page"><div class="page-toolbar"><button class="primary-small" id="createVersionButton" type="button" ${createDisabled ? 'disabled' : ''} title="${createDisabled ? '真实 A4 验收通过后才能保存正式版本' : '保存当前正式版本'}">创建正式版本</button></div><div class="version-list"><article class="version-row current"><div class="version-mark">D</div><div class="version-copy"><b>当前隔离草稿</b><span>${escapeHtml(liveState.templateName || liveState.templateId)} · ${escapeHtml(liveState.workflowState || '未知状态')}</span><small>${liveState.renderId ? '已生成 render，' : '尚未生成 render，'}${liveState.measurement ? '已有真实测量' : '等待真实 A4 测量'}</small></div><em>未固化</em><button class="secondary-button" type="button" data-version-route="workbench">继续调整</button></article>${records || '<div class="empty-view">当前工作区还没有正式投递版本。真实验收通过后可创建。</div>'}</div></div>`
    view.scrollTop = 0
    const createButton = $('#createVersionButton')
    if (createButton) createButton.addEventListener('click', () => { void saveCurrentVersion() })
    $('[data-version-route]')?.addEventListener('click', () => renderRoute('workbench'))
    for (const button of $$('[data-version-open]')) button.addEventListener('click', () => { void openVersion(button.dataset.versionOpen) })
    for (const button of $$('[data-version-rename]')) { const version = versions.find((item) => item.id === button.dataset.versionRename); button.addEventListener('click', () => { if (version) void renameVersion(version) }) }
    for (const button of $$('[data-version-archive]')) { const version = versions.find((item) => item.id === button.dataset.versionArchive); button.addEventListener('click', () => { if (version) void archiveVersion(version) }) }
  } catch (error) {
    view.innerHTML = `<div class="empty-view">版本读取失败：${escapeHtml(errorText(error))}</div>`
    showToast(`版本读取失败：${errorText(error)}`)
  }
}

function appendAgentResponse(text) {
  const stream = $('.chat-stream')
  if (!stream) return
  const response = document.createElement('article')
  response.className = 'message agent-message'
  response.setAttribute('aria-label', 'Agent 消息')
  response.innerHTML = '<div class="message-body"><div class="message-bubble"></div></div>'
  response.querySelector('.message-bubble').textContent = text
  stream.append(response)
  response.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

async function saveCurrentVersion() {
  if (!liveState.sessionId) {
    showToast('请先选择工作区并加载简历')
    return
  }
  if (liveState.workflowState !== 'accepted') {
    showToast('真实排版验收通过后才能保存正式版本')
    return
  }
  const name = window.prompt('正式版本名称', currentSessionData().title || '简历正式版')
  if (name === null) return
  const trimmedName = name.trim()
  if (!trimmedName) {
    showToast('版本名称不能为空')
    return
  }
  const button = $('#saveVersionButton, #createVersionButton')
  if (button) button.disabled = true
  try {
    const { body } = await api.post('/api/agent/save', { sessionId: liveState.sessionId, name: trimmedName, confirm: true })
    liveState.workflowState = body.state || 'saved'
    updateHeader()
    showToast(`正式版本「${body.version?.name || trimmedName}」已保存`)
    if (currentRoute === 'versions') await renderVersions()
  } catch (error) {
    showToast(`保存正式版本失败：${errorText(error)}`)
  } finally {
    if (button) button.disabled = false
  }
}

function bindChat() {
  connectWorkflowEvents()
  $('#composer').addEventListener('submit', (event) => {
    event.preventDefault()
    const input = $('#messageInput')
    const value = input.value.trim()
    if (!value) return
    if (!liveState.sessionId) {
      showToast('请先选择工作区并加载简历')
      return
    }
    const article = document.createElement('article')
    article.className = 'message user-message'
    article.setAttribute('aria-label', '用户消息')
    article.innerHTML = '<div class="message-body"><div class="message-bubble"></div></div>'
    article.querySelector('.message-bubble').textContent = value
    const stream = $('.chat-stream')
    liveState.messages.push({ role: 'user', content: value })
    stream.append(article)
    input.value = ''
    article.scrollIntoView({ behavior: 'smooth', block: 'end' })
    updateSessionStatus('Agent 处理中')
    showToast('已发送，Agent 正在处理当前会话')
    const progress = document.createElement('div')
    progress.className = 'turn-progress is-running'
    progress.setAttribute('role', 'status')
    progress.innerHTML = '<i aria-hidden="true"></i><span>正在更新简历草稿</span><time>进行中</time>'
    stream.append(progress)
    progress.scrollIntoView({ behavior: 'smooth', block: 'end' })
    void api.post('/api/agent/run', { sessionId: liveState.sessionId, workspaceId: liveState.workspaceId, message: value })
      .then(({ body }) => {
        liveState.workflowState = body.state || liveState.workflowState
        const previousRenderId = liveState.renderId
        liveState.renderId = body.context?.renderId || liveState.renderId
        if (liveState.renderId !== previousRenderId) {
          liveState.measurement = null
          liveState.measuredRenderKey = ''
          liveState.continuationKey = ''
        }
        if (body.draft?.contentVersion) liveState.draftContent = $('#resumeEditor')?.value || liveState.draftContent
        progress.classList.remove('is-running')
        progress.innerHTML = '<i aria-hidden="true"></i><span>Agent 已完成本轮处理</span><time>完成</time>'
        const assistantMessage = body.assistantText || 'Agent 已完成处理，请查看当前草稿和预览。'
        liveState.messages.push({ role: 'assistant', content: assistantMessage })
        appendAgentResponse(assistantMessage)
        syncPreviewFrames()
        updateHeader()
        void loadSessionsForWorkspace()
      })
      .catch((error) => {
        progress.classList.remove('is-running')
        progress.innerHTML = '<i aria-hidden="true"></i><span>Agent 执行失败</span><time>失败</time>'
        updateSessionStatus('Agent 执行失败')
        showToast(`Agent 执行失败：${errorText(error)}`)
      })
  })
}

function renderRoute(route) {
  currentRoute = route
  $('#routeView').scrollTop = 0
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.route === route))
  if (route !== 'workbench') setPreviewOpen(false)
  if (route === 'workbench') { $('#routeActions').innerHTML = '<button class="ghost-button" id="saveVersionButton" type="button" disabled>保存正式版</button><button class="ghost-button" id="workbenchAssistantButton" type="button">打开 Agent</button>'; renderWorkbench() }
  if (route === 'preview') { $('#routeActions').innerHTML = ''; renderPreview() }
  if (route === 'templates') { $('#routeActions').innerHTML = ''; void renderTemplates() }
  if (route === 'checks') { $('#routeActions').innerHTML = '<button class="ghost-button" id="recheckButton" type="button">重新检查</button>'; void renderChecks() }
  if (route === 'versions') { $('#routeActions').innerHTML = ''; void renderVersions() }
  updateHeader()
  const assistantButton = $('#workbenchAssistantButton')
  if (assistantButton) assistantButton.addEventListener('click', () => setPreviewOpen(!previewOpen))
  const saveButton = $('#saveVersionButton')
  if (saveButton) saveButton.addEventListener('click', () => { void saveCurrentVersion() })
  const recheckButton = $('#recheckButton')
  if (recheckButton) recheckButton.addEventListener('click', () => { void renderChecks() })
}

$$('.nav-item').forEach((item) => item.addEventListener('click', () => renderRoute(item.dataset.route)))
$('#drawerClose').addEventListener('click', () => setPreviewOpen(false))
$('#workspaceSwitcher').addEventListener('click', () => { const button = $('#workspaceSwitcher'); const menu = $('#workspaceMenu'); const open = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!open)); menu.hidden = open })
$('#workspaceImportButton').addEventListener('click', () => { $('#workspaceMenu').hidden = true; $('#workspaceSwitcher').setAttribute('aria-expanded', 'false'); $('#workspaceFiles').click() })
$('#workspaceFiles').addEventListener('change', (event) => {
  const files = event.target.files
  void importSelectedWorkspace(files).then(() => showToast('工作区导入完成')).catch((error) => showToast(`导入失败：${errorText(error)}`)).finally(() => { event.target.value = '' })
})
$('#newSession').addEventListener('click', () => {
  if (!liveState.workspace) {
    showToast('请先选择工作区')
    return
  }
  void bootstrapWorkspace(liveState.workspace).then(() => showToast('已创建新的隔离会话')).catch((error) => showToast(`新建会话失败：${errorText(error)}`))
})

updateConnectionStatus()
bindResizableLayout()
renderRoute('workbench')
void loadWorkspaces()
