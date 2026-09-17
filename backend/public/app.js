const $ = (selector) => document.querySelector(selector)
let sessionId = ''
let currentContext = {}
let taskState = 'waiting'
let templates = []
let versions = []
let sessions = []
let workspacePreviews = []
let activeWorkspace = null
let preferredWorkspaceId = ''
let workspaceCatalog = []
let showArchivedVersions = false
const receivedMeasurements = new Set()
let latestMeasurement = null
let loadedPreviewKey = ''
let draftSyncTimer = null
let draftSyncRunning = false
let sourceLoadRevision = 0
const PREFERENCE_KEY = 'cvagent.preferences.v1'
const LAYOUT_KEY = 'cvagent.layout.v1'
const layoutPrefs = { sidebar: 248, expandedSidebar: 248, assistant: 360, editor: 0, collapsed: false }

try { Object.assign(layoutPrefs, JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')) } catch {
  // Keep the default layout when browser storage is unavailable.
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function saveLayoutPrefs() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutPrefs)) } catch {
    // Layout persistence is optional.
  }
}

function applyLayoutPrefs() {
  const body = $('#workbenchBody')
  if (!body) return
  body.style.setProperty('--sidebar-width', `${layoutPrefs.collapsed ? 0 : layoutPrefs.sidebar}px`)
  body.style.setProperty('--assistant-width', `${layoutPrefs.assistant}px`)
  if (layoutPrefs.editor > 0) body.style.setProperty('--editor-width', `${layoutPrefs.editor}px`)
  else body.style.removeProperty('--editor-width')
  body.classList.toggle('sidebar-collapsed', layoutPrefs.collapsed)
  body.classList.toggle('agent-open', !$('#agentPanel')?.hidden)
  const toggle = $('#sidebarToggle')
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!layoutPrefs.collapsed))
    toggle.setAttribute('aria-label', layoutPrefs.collapsed ? '展开导航栏' : '收起导航栏')
    const icon = toggle.querySelector('span')
    const label = toggle.querySelector('small')
    if (icon) icon.textContent = layoutPrefs.collapsed ? '›' : '‹'
    if (label) label.textContent = layoutPrefs.collapsed ? '展开' : '收起'
  }
}

function updateResize(type, clientX) {
  if (type === 'sidebar') {
    if (clientX <= 120) layoutPrefs.collapsed = true
    else {
      layoutPrefs.collapsed = false
      layoutPrefs.sidebar = clamp(clientX, 220, 340)
      layoutPrefs.expandedSidebar = layoutPrefs.sidebar
    }
  }
  if (type === 'assistant') layoutPrefs.assistant = clamp(window.innerWidth - clientX, 320, 520)
  if (type === 'editor') {
    const split = $('.cj-previewWorkspace')
    if (!split) return
    const rect = split.getBoundingClientRect()
    layoutPrefs.editor = clamp(clientX - rect.left, 280, Math.max(340, rect.width - 360))
  }
  applyLayoutPrefs()
}

function bindResizableLayout() {
  let activeResize = null
  document.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest?.('[data-resize]')
    if (!handle || (handle.dataset.resize === 'assistant' && $('#agentPanel')?.hidden)) return
    event.preventDefault()
    activeResize = { handle, type: handle.dataset.resize, pointerId: event.pointerId }
    handle.setPointerCapture?.(event.pointerId)
    document.body.classList.add('is-resizing')
    updateResize(activeResize.type, event.clientX)
  })
  document.addEventListener('pointermove', (event) => { if (activeResize) updateResize(activeResize.type, event.clientX) })
  const endResize = () => {
    if (!activeResize) return
    activeResize.handle.releasePointerCapture?.(activeResize.pointerId)
    activeResize = null
    document.body.classList.remove('is-resizing')
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
      else if (event.key === 'End') { layoutPrefs.collapsed = false; layoutPrefs.sidebar = 340; layoutPrefs.expandedSidebar = 340 }
      else if (layoutPrefs.collapsed && event.key === 'ArrowRight') { layoutPrefs.collapsed = false; layoutPrefs.sidebar = layoutPrefs.expandedSidebar || 248 }
      else if (!layoutPrefs.collapsed) { layoutPrefs.sidebar = clamp(layoutPrefs.sidebar + (event.key === 'ArrowRight' ? 16 : -16), 220, 340); layoutPrefs.expandedSidebar = layoutPrefs.sidebar }
    }
    if (type === 'assistant') layoutPrefs.assistant = clamp(layoutPrefs.assistant + (event.key === 'ArrowLeft' ? 16 : -16), 320, 520)
    if (type === 'editor') updateResize('editor', $('.cj-previewWorkspace').getBoundingClientRect().left + layoutPrefs.editor + (event.key === 'ArrowRight' ? 16 : -16))
    applyLayoutPrefs()
    saveLayoutPrefs()
  })
  $('#sidebarToggle')?.addEventListener('click', () => {
    layoutPrefs.collapsed = !layoutPrefs.collapsed
    if (!layoutPrefs.collapsed) layoutPrefs.sidebar = layoutPrefs.expandedSidebar || 248
    applyLayoutPrefs()
    saveLayoutPrefs()
  })
  applyLayoutPrefs()
}

function persistPreferences() {
  try {
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ workspaceId: activeWorkspace?.id || '', targetPages: $('#targetPages').value, templateId: $('#templateSelect').value || '' }))
  } catch {
    // Storage can be unavailable in private/file contexts; the workbench remains usable.
  }
}

function restorePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || '{}')
    preferredWorkspaceId = String(saved.workspaceId || '')
    if ([...$('#targetPages').options].some((option) => option.value === String(saved.targetPages))) $('#targetPages').value = String(saved.targetPages)
  } catch {
    // Ignore malformed or unavailable browser storage.
  }
}

function workspaceQuery(extra = {}) {
  const params = new URLSearchParams(extra)
  if (activeWorkspace?.id) params.set('workspaceId', activeWorkspace.id)
  return params.toString()
}

function workspaceBody(extra = {}) {
  return activeWorkspace?.id ? { ...extra, workspaceId: activeWorkspace.id } : extra
}

function hasWorkspace() {
  return Boolean(activeWorkspace?.id)
}

function setActiveWorkspace(workspace) {
  activeWorkspace = workspace?.id ? { ...workspace } : null
  preferredWorkspaceId = activeWorkspace?.id || ''
  persistPreferences()
  renderRecentWorkspaces()
  updateState(taskState, currentContext)
}

function renderRecentWorkspaces(workspaces = workspaceCatalog) {
  const container = $('#workspaceRecentList')
  if (!container) return
  container.replaceChildren()
  if (!workspaces.length) {
    container.innerHTML = '<div class="workspace-recent-empty">还没有最近工作区。选择一个目录后，它会出现在这里。</div>'
    return
  }
  for (const workspace of workspaces) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `workspace-recent-item${workspace.id === activeWorkspace?.id ? ' is-active' : ''}`
    button.innerHTML = `<span class="workspace-recent-name"></span><span class="workspace-recent-meta"></span>`
    button.querySelector('.workspace-recent-name').textContent = workspace.name
    button.querySelector('.workspace-recent-meta').textContent = `${workspace.resumeName || '未识别简历'} · ${workspace.fileCount || 0} 个文件`
    button.addEventListener('click', () => { setActiveWorkspace(workspace); void loadSource() })
    container.append(button)
  }
}

function renderSessionList() {
  const container = $('#sessionList')
  if (!container) return
  container.replaceChildren()
  if (!sessions.length) {
    container.innerHTML = '<div class="cj-sessionEmpty">当前工作区还没有会话</div>'
    return
  }
  for (const session of sessions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `cj-sessionItem${session.sessionId === sessionId ? ' is-active' : ''}`
    const title = session.templateId ? `${activeWorkspace?.resumeName || '简历'} · ${session.templateId}` : activeWorkspace?.resumeName || '未命名会话'
    const meta = `${session.status || 'idle'} · ${session.updatedAt ? new Date(session.updatedAt).toLocaleDateString() : '时间未知'}`
    button.innerHTML = '<i></i><span><b></b><small></small></span>'
    button.querySelector('b').textContent = title
    button.querySelector('small').textContent = meta
    button.addEventListener('click', () => { void restoreSession(session.sessionId) })
    container.append(button)
  }
}

function addMessage(text, kind = 'agent') {
  const row = document.createElement('div')
  row.className = 'cj-chatMessage'
  row.dataset.role = kind === 'user' ? 'user' : 'assistant'
  row.innerHTML = `<div class="cj-assistantMarkdown"></div>`
  row.querySelector('.cj-assistantMarkdown').textContent = text
  $('#messages').append(row)
  row.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) return message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('')
  return ''
}

function renderSessionMessages(messages = []) {
  const container = $('#messages')
  container.replaceChildren()
  const visible = messages.filter((message) => ['user', 'assistant', 'human', 'ai'].includes(message?.role || message?.type) && messageText(message).trim())
  if (!visible.length) {
    container.innerHTML = '<div class="cj-chatEmpty">已恢复会话。继续描述你希望修改的内容。</div>'
    return
  }
  visible.forEach((message) => addMessage(messageText(message), ['user', 'human'].includes(message.role || message.type) ? 'user' : 'agent'))
}

function syncTemplateLabels() {
  const selectedTemplate = templates.find((item) => item.id === $('#templateSelect').value)
  $('#templatePickerButton').textContent = `模板 · ${selectedTemplate?.name || '选择模板'}`
  $('#workshopName').textContent = selectedTemplate?.name || '未选择模板'
  $('#workshopDescription').textContent = selectedTemplate?.description || '先在模板库选择一套视觉基线。'
  $('#workshopCopy').disabled = !selectedTemplate
  $('#workshopLoad').disabled = !selectedTemplate
  $('#workshopSave').disabled = !selectedTemplate || selectedTemplate.immutable
}

function updateState(state = '等待', context = {}) {
  taskState = state
  currentContext = context
  const measurementMatches = latestMeasurement && context.renderId && latestMeasurement.renderId === context.renderId
  const occupancy = measurementMatches ? Number(latestMeasurement.occupancy?.[0]) : NaN
  const statusLabel = measurementMatches && Number.isFinite(occupancy)
    ? `留白 ${Math.round((1 - occupancy) * 100)}%`
    : state === 'needs_revision' ? '版式需调整'
      : state === 'accepted' || state === 'saved' ? '一页通过'
        : state === 'blocked' ? '需要复核'
          : state === 'measured' ? '已测量'
            : '测量中'
  const statusMeta = measurementMatches && Number.isFinite(Number(latestMeasurement.pageCount)) ? `${latestMeasurement.pageCount} 页` : '排版指标'
  $('#statusLine').textContent = `${statusLabel} · ${statusMeta}`
  const currentTemplate = templates.find((item) => item.id === context.templateId) || templates.find((item) => item.id === $('#templateSelect')?.value)
  if ($('#mainHeading')) $('#mainHeading').textContent = activeWorkspace?.name || '简历工作台'
  if ($('#mainHint')) $('#mainHint').textContent = `${activeWorkspace?.resumeName || 'resume.md'} · ${currentTemplate?.name || context.templateId || '校招标准'} · A4`
  $('#checkContentValue').textContent = context.contentVersion ? '已更新' : '等待'
  $('#checkPageValue').textContent = context.renderId ? '已渲染' : '等待'
  $('#checkMetricsValue').textContent = state === 'accepted' || state === 'saved' ? '通过' : '等待'
  $('#settingsWorkspace').textContent = activeWorkspace?.name || '未选择'
  $('#settingsResume').textContent = activeWorkspace?.resumeName || '等待识别'
  $('#startWorkspace').textContent = activeWorkspace?.name || '未选择'
  $('#startResume').textContent = activeWorkspace?.resumeName || '等待识别'
  $('#workspaceNameValue').textContent = activeWorkspace?.name || '未选择'
  $('#workspaceResumeValue').textContent = activeWorkspace?.resumeName || '等待识别'
  $('#saveVersion').disabled = state !== 'accepted'
  $('#saveAsVersion').disabled = state !== 'accepted'
  $('#saveVersionTop').disabled = state !== 'accepted'
  const enabled = Boolean(sessionId)
  $('#applyTemplate').disabled = !enabled
  $('#applyPresentation').disabled = !enabled
  $('#runQuality').disabled = !enabled
  $('#downloadHtmlTop').disabled = !context.renderId
  $('#exportPdfTop').disabled = !context.renderId
  if (context.templateId && $('#templateSelect').querySelector(`option[value="${CSS.escape(context.templateId)}"]`)) $('#templateSelect').value = context.templateId
  syncTemplateLabels()
}

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.ok === false) throw new Error(result.errorMessage || '请求失败')
  return result
}

const IMPORT_TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.css', '.csv', '.yaml', '.yml'])
const IMPORT_ASSET_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])

function isImportableFile(name) {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  return IMPORT_TEXT_EXTENSIONS.has(extension) || IMPORT_ASSET_EXTENSIONS.has(extension)
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return btoa(binary)
}

async function readBrowserFile(file, relativePath) {
  const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
  if (IMPORT_TEXT_EXTENSIONS.has(extension)) return { path: relativePath, encoding: 'utf8', content: await file.text() }
  return { path: relativePath, encoding: 'base64', content: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }
}

async function readDirectoryHandle(handle) {
  const files = []
  async function visit(directory, prefix = '') {
    for await (const entry of directory.values()) {
      if (entry.name.startsWith('.') || ['node_modules', '.git', '.cvagent'].includes(entry.name)) continue
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.kind === 'directory') { await visit(entry, relativePath); continue }
      if (!isImportableFile(entry.name)) continue
      const file = await entry.getFile()
      files.push(await readBrowserFile(file, relativePath))
    }
  }
  await visit(handle)
  return files
}

async function readFallbackFiles(fileList) {
  const files = []
  for (const file of fileList) {
    const parts = String(file.webkitRelativePath || file.name).split('/')
    const relativePath = parts.length > 1 ? parts.slice(1).join('/') : parts[0]
    if (!relativePath || !isImportableFile(relativePath)) continue
    files.push(await readBrowserFile(file, relativePath))
  }
  return files
}

async function importWorkspace(name, files) {
  if (!files.length) throw new Error('所选工作区没有可导入的简历或模板文件。')
  const result = await request('/api/workspaces/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, files }),
  })
  setActiveWorkspace(result.workspace)
  await loadWorkspaceCatalog()
  await loadSource()
}

async function chooseWorkspace() {
  try {
    if (typeof window.showDirectoryPicker === 'function') {
      const handle = await window.showDirectoryPicker({ mode: 'read' })
      const files = await readDirectoryHandle(handle)
      await importWorkspace(handle.name, files)
      return
    }
    $('#workspaceFolderInput').click()
  } catch (error) {
    if (error?.name !== 'AbortError') addMessage(`工作区选择失败：${error.message}`)
  }
}

async function loadWorkspaceCatalog() {
  try {
    const result = await request('/api/workspaces')
    workspaceCatalog = result.workspaces || []
    if (!activeWorkspace && preferredWorkspaceId) {
      const saved = workspaceCatalog.find((workspace) => workspace.id === preferredWorkspaceId)
      if (saved) setActiveWorkspace(saved)
    }
    renderRecentWorkspaces()
    updateState(taskState, currentContext)
  } catch (error) {
    addMessage(`最近工作区读取失败：${error.message}`)
  }
}

async function loadTemplates(loadRevision = 0) {
    if (!hasWorkspace()) return
    try {
      const result = await request(`/api/templates?${workspaceQuery()}`)
    if (loadRevision && loadRevision !== sourceLoadRevision) return false
    templates = result.templates || []
    const select = $('#templateSelect')
    select.replaceChildren(...templates.map((template) => { const option = document.createElement('option'); option.value = template.id; option.textContent = `${template.name} · ${template.id}`; return option }))
    let selected = currentContext.templateId || 'campus-standard'
    try { selected = currentContext.templateId || JSON.parse(localStorage.getItem(PREFERENCE_KEY) || '{}').templateId || 'campus-standard' } catch {}
    if ([...select.options].some((option) => option.value === selected)) select.value = selected
    updateTemplateDescription()
    updateState(taskState, currentContext)
    renderTemplateGallery()
    renderQuickTemplates()
    return true
  } catch (error) { addMessage(`模板库读取失败：${error.message}`) }
}

async function loadPreviews(loadRevision = 0) {
  if (!hasWorkspace()) return
  try {
    const result = await request(`/api/previews?${workspaceQuery()}`)
    if (loadRevision && loadRevision !== sourceLoadRevision) return false
    workspacePreviews = Array.isArray(result.previews) ? result.previews : []
    updatePreviewPathSelect(workspacePreviews)
    return true
  } catch (error) {
    if (loadRevision && loadRevision !== sourceLoadRevision) return false
    workspacePreviews = []
    updatePreviewPathSelect()
    addMessage(`预览文件读取失败：${error.message}`)
  }
}

async function loadVersions() {
  if (!hasWorkspace()) return
  try {
    const result = await request(`/api/versions?${workspaceQuery({ includeArchived: String(showArchivedVersions) })}`)
    versions = result.versions || []
    renderVersions()
  } catch (error) { addMessage(`版本记录读取失败：${error.message}`) }
}

async function loadSessions() {
  const select = $('#sessionSelect')
  if (!select) return
  if (!hasWorkspace()) {
    sessions = []
    select.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: '历史会话' }))
    renderSessionList()
    return
  }
  try {
    const result = await request(`/api/sessions?${workspaceQuery()}`)
    sessions = result.sessions || []
    select.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: sessions.length ? '恢复历史会话' : '暂无历史会话' }), ...sessions.map((session) => {
      const option = document.createElement('option')
      option.value = session.sessionId
      option.textContent = `${session.status || 'idle'} · ${new Date(session.updatedAt).toLocaleString()}`
      return option
    }))
    select.value = sessionId || ''
    renderSessionList()
  } catch (error) {
    sessions = []
    renderSessionList()
    addMessage(`历史会话读取失败：${error.message}`)
  }
}

async function restoreSession(id) {
  if (!id) return
  try {
    const result = await request(`/api/session?sessionId=${encodeURIComponent(id)}`)
    const session = result.session
    sessionId = session.sessionId
    setActiveWorkspace(result.workspace)
    if ([...$('#targetPages').options].some((option) => option.value === String(session.taskRef?.current?.targetPages))) $('#targetPages').value = String(session.taskRef.current.targetPages)
    currentContext = result.context || {}
    taskState = result.state || session.status || 'waiting'
    latestMeasurement = session.taskRef?.current?.measurements || null
    $('#markdownContent').value = result.draft?.content || result.source?.content || ''
    updateCharCount()
    renderSessionMessages(session.messages || [])
    await loadTemplates()
    await loadPreviews()
    updateState(taskState, currentContext)
    setView('agent')
    if (currentContext.renderId) setPreview(true)
    addMessage(`已恢复会话 · 当前阶段：${taskState}`)
  } catch (error) {
    addMessage(`会话恢复失败：${error.message}`)
  }
}

function renderTemplateGallery() {
  const gallery = $('#templateGallery')
  if (!gallery) return
  gallery.replaceChildren(...templates.map((template) => {
    const card = document.createElement('article')
    card.className = 'cj-templateCard template-card'
    card.dataset.selected = template.id === $('#templateSelect').value ? 'true' : 'false'
    const thumb = document.createElement('div'); thumb.className = 'cj-templateThumb'
    const lines = document.createElement('div'); lines.className = 'thumb-lines'
    ;['', '', '', ''].forEach(() => { const line = document.createElement('i'); lines.append(line) })
    thumb.append(lines)
    const body = document.createElement('div'); body.className = 'cj-templateCardBody'
    const footer = document.createElement('div'); footer.className = 'cj-templateCardFooter'
    const title = document.createElement('strong'); title.className = 'cj-templateName'; title.textContent = template.name || template.id
    const description = document.createElement('div'); description.className = 'cj-templateDescription'; description.textContent = template.description || '可用于当前简历的独立模板。'
    const tags = document.createElement('div'); tags.className = 'cj-templateTags'; tags.textContent = `${template.renderer || 'composition'} · ${template.layout?.mode === 'two-column' ? '双栏' : '单栏'}`
    const meta = document.createElement('div'); meta.className = 'cj-templateMeta'; meta.textContent = `${template.id} · 修订 ${template.revision || 1}`
    const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button'; button.textContent = '选择到当前任务'
    button.addEventListener('click', async () => {
      $('#templateSelect').value = template.id
      persistPreferences()
      updateTemplateDescription()
      syncTemplateLabels()
      if (!sessionId) {
        setView('workspace')
        addMessage(`已选择模板「${template.name || template.id}」。请先读取简历建立当前任务，再应用模板。`)
        return
      }
      try {
        const result = await domainAction('/api/agent/template', { templateId: template.id })
        addMessage(`已应用模板「${result.result.name}」，旧预览已失效。`)
        await renderCurrent()
        setView('workbench')
      } catch (error) { addMessage(`模板应用失败：${error.message}`) }
    })
    footer.append(title)
    body.append(footer, tags, meta, description, button)
    card.append(thumb, body)
    return card
  }))
  if (!templates.length) gallery.innerHTML = '<div class="empty-view">请先读取工作区。</div>'
}

function renderQuickTemplates() {
  const gallery = $('#quickTemplateList')
  if (!gallery) return
  gallery.replaceChildren(...templates.map((template) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cj-templateCard'
    button.dataset.active = template.id === $('#templateSelect').value ? 'true' : 'false'
    const variant = ['technical', 'editorial', 'terminal', 'two-column'].includes(template.visual?.variant) ? template.visual.variant : 'technical'
    button.innerHTML = `<div class="cj-templatePaper cj-templatePaper-${variant}"><div class="cj-thumbTop"></div><div class="cj-thumbRule"></div><div class="cj-thumbSection"></div><div class="cj-thumbLines"></div></div><div class="cj-templateCardBody"><div class="cj-templateCardFooter"><strong class="cj-templateName"></strong></div><div class="cj-templateTags"></div><div class="cj-templateMeta"></div></div>`
    button.querySelector('.cj-templateName').textContent = template.name || template.id
    button.querySelector('.cj-templateTags').textContent = `${template.renderer || 'composition'} · ${template.layout?.mode === 'two-column' ? '双栏' : '单栏'}`
    button.querySelector('.cj-templateMeta').textContent = `${template.id} · 修订 ${template.revision || 1}`
    button.addEventListener('click', async () => {
      $('#templateSelect').value = template.id
      persistPreferences()
      updateTemplateDescription()
      try {
        if (sessionId) { const result = await domainAction('/api/agent/template', { templateId: template.id }); addMessage(`已应用模板「${result.result.name}」，旧预览已失效。`); await renderCurrent() }
        else addMessage(`已选择模板「${template.name || template.id}」，读取简历后会应用。`)
        closeWorkbenchPopovers()
      } catch (error) { addMessage(`模板应用失败：${error.message}`) }
    })
    return button
  }))
  if (!templates.length) gallery.innerHTML = '<div class="cj-templateEmpty">请先读取工作区。</div>'
}

function renderVersions() {
  const list = $('#versionsList')
  if (!list) return
  if (!versions.length) { list.innerHTML = '<div class="empty-view">当前工作区还没有正式投递版本。验收通过后，在工作台点击“保存正式版本”。</div>'; return }
  list.replaceChildren(...versions.map((version) => {
    const card = document.createElement('article'); card.className = 'cj-versionCard version-card'
    const main = document.createElement('div'); main.className = 'version-main'
    const title = document.createElement('h3'); title.className = 'cj-versionName'; title.textContent = version.name || '未命名版本'
    const meta = document.createElement('p'); meta.className = 'cj-versionMeta'; meta.textContent = `${version.savedAt ? new Date(version.savedAt).toLocaleString() : '时间未知'} · ${version.templateId || '未记录模板'}`
    const pathText = document.createElement('code'); pathText.className = 'cj-versionPath'; pathText.textContent = `当前工作区 · ${activeWorkspace?.resumeName || '简历'}`
    main.append(title, meta, pathText)
    const actions = document.createElement('div'); actions.className = 'version-actions'
    const badge = document.createElement('span'); badge.className = 'cj-versionBadge version-badge'; badge.textContent = version.archived ? '已归档' : '已固化'
    const open = document.createElement('button'); open.type = 'button'; open.className = 'text-button'; open.textContent = '打开'
    open.addEventListener('click', async () => {
      try {
        const result = await request(`/api/version?${workspaceQuery({ versionId: version.id })}`)
        $('#markdownContent').value = result.version.content || ''
        $('#editorStatus').textContent = `已打开正式版本「${result.version.name || version.id}」· 只读查看，写入需另存隔离草稿`
        updateCharCount()
        setView('workbench')
        addMessage(`已打开正式版本「${result.version.name || version.id}」。当前内容未写回源文件。`)
      } catch (error) { addMessage(`正式版本打开失败：${error.message}`) }
    })
    const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'text-button'; rename.textContent = '改名'; rename.disabled = Boolean(version.archived)
    rename.addEventListener('click', async () => {
      const name = window.prompt('请输入新的版本名称', version.name || '')
      if (!name || name.trim() === version.name) return
      try {
        await request('/api/versions/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(workspaceBody({ versionId: version.id, name: name.trim() })) })
        addMessage(`版本已改名为「${name.trim()}」。`); await loadVersions()
      } catch (error) { addMessage(`版本改名失败：${error.message}`) }
    })
    const archive = document.createElement('button'); archive.type = 'button'; archive.className = 'text-button'; archive.textContent = version.archived ? '已归档' : '归档'; archive.disabled = Boolean(version.archived)
    archive.addEventListener('click', async () => {
      if (!window.confirm(`确认归档「${version.name || version.id}」？归档不会删除文件。`)) return
      try {
        await request('/api/versions/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(workspaceBody({ versionId: version.id })) })
        addMessage(`版本「${version.name || version.id}」已归档，可在版本页打开“显示已归档”。`); await loadVersions()
      } catch (error) { addMessage(`版本归档失败：${error.message}`) }
    })
    actions.append(badge, open, rename, archive)
    card.append(main, actions)
    return card
  }))
}

function setView(view) {
  const validViews = new Set(['start', 'workspace', 'workbench', 'templates', 'versions', 'workshop', 'checks', 'agent', 'settings'])
  const nextView = validViews.has(view) ? view : 'workbench'
  const previewView = nextView === 'workbench' || nextView === 'agent'
  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.view === (nextView === 'agent' ? 'workbench' : nextView)
    item.classList.toggle('active', active)
    item.dataset.active = active ? 'true' : 'false'
  })
  $('#workbenchBody')?.setAttribute('data-view', previewView ? 'preview' : nextView)
  $('#workbenchBody')?.classList.toggle('agent-open', nextView === 'agent')
  const main = $('.cj-main')
  if (main) {
    main.className = `cj-main cj-main-${previewView ? 'preview' : nextView}`
  }
  $('#previewShell').hidden = !previewView
  const workbench = $('.cj-previewWorkspace')
  const agent = $('#agentPanel')
  const templateView = $('#templatesView')
  const startView = $('#startView')
  const workspaceView = $('#workspaceView')
  const workshopView = $('#workshopView')
  const versionsView = $('#versionsView')
  const checksView = $('#checksView')
  const settingsView = $('#settingsView')
  workbench.hidden = !previewView
  agent.hidden = nextView !== 'agent'
  startView.hidden = nextView !== 'start'
  workspaceView.hidden = nextView !== 'workspace'
  templateView.hidden = nextView !== 'templates'
  workshopView.hidden = nextView !== 'workshop'
  versionsView.hidden = nextView !== 'versions'
  checksView.hidden = nextView !== 'checks'
  settingsView.hidden = nextView !== 'settings'
  applyLayoutPrefs()
  closeWorkbenchPopovers()
  if (nextView === 'templates') renderTemplateGallery()
  if (nextView === 'versions') void loadVersions()
  if (nextView === 'workshop') {
    const selectedTemplate = templates.find((item) => item.id === $('#templateSelect').value)
    $('#workshopName').textContent = selectedTemplate?.name || '未选择模板'
    $('#workshopDescription').textContent = selectedTemplate?.description || '先在模板库选择一套视觉基线。'
    $('#workshopCopy').disabled = !selectedTemplate
    $('#workshopLoad').disabled = !selectedTemplate
    $('#workshopSave').disabled = !selectedTemplate || selectedTemplate.immutable
  }
}

function updateTemplateDescription() {
  const template = templates.find((item) => item.id === $('#templateSelect').value)
  $('#templateDescription').textContent = template ? `${template.description || ''} · 修订 ${template.revision || 1}` : '模板选择会进入当前任务上下文。'
}

async function loadSource() {
  if (!hasWorkspace()) { addMessage('请先选择一个工作区。'); return }
  const loadRevision = ++sourceLoadRevision
  try {
    // Reading a different source starts a fresh isolated task. Keeping the
    // previous session here caused the UI to show one source while actions
    // still targeted an older draft/template context.
    sessionId = ''
    currentContext = {}
    taskState = 'waiting'
    latestMeasurement = null
    loadedPreviewKey = ''
    receivedMeasurements.clear()
    const result = await request(`/api/source?${workspaceQuery()}`)
    if (loadRevision !== sourceLoadRevision) return
    if (result.path && activeWorkspace) activeWorkspace.resumeName = result.path.split('/').at(-1)
    $('#markdownContent').value = result.content || ''
    $('#editorStatus').textContent = '已读取源文件 · 原文件不会被直接覆盖'
    updateCharCount()
    if (await loadTemplates(loadRevision) === false || loadRevision !== sourceLoadRevision) return
    if (await loadPreviews(loadRevision) === false || loadRevision !== sourceLoadRevision) return
    const bootstrap = await request('/api/agent/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(workspaceBody({ targetPages: Number($('#targetPages').value), templateId: $('#templateSelect').value || 'campus-standard' })) })
    if (loadRevision !== sourceLoadRevision) return
    sessionId = bootstrap.sessionId
    updateState(bootstrap.state, bootstrap.context)
    // Reading a source is the entry point to the actual workbench. Without
    // this transition the request succeeds and the iframe is ready, but the
    // workspace page stays visible, making the user think the load failed.
    setView('workbench')
    setPreview()
    $('#editorStatus').textContent = '已读取并建立隔离预览 · 原文件不会被直接覆盖'
    addMessage(`已读取 ${activeWorkspace?.resumeName || result.path}，加载 ${templates.length} 套模板，并建立当前 A4 预览会话。`)
    await loadSessions()
  } catch (error) { if (loadRevision === sourceLoadRevision) addMessage(`读取失败：${error.message}`) }
}

function updateCharCount() { $('#charCount').textContent = `${$('#markdownContent').value.length} 字` }

function updatePreviewPathSelect(previewPaths = workspacePreviews) {
  const select = $('#resumePreviewSelect')
  if (!select) return
  const previewPath = previewPaths?.[0] || 'preview.html'
  const paths = [...new Set([...(Array.isArray(previewPaths) ? previewPaths : []), previewPath])].sort((left, right) => left.localeCompare(right))
  select.replaceChildren(...paths.map((value) => Object.assign(document.createElement('option'), { value, textContent: value })))
  select.value = paths.includes(previewPath) ? previewPath : paths[0] || ''
}

function scheduleDraftSync() {
  if (!sessionId || ['accepted', 'saved'].includes(taskState)) return
  clearTimeout(draftSyncTimer)
  draftSyncTimer = setTimeout(() => { void syncLatestDraft() }, 650)
}

async function syncLatestDraft() {
  if (draftSyncRunning || !sessionId) return
  draftSyncRunning = true
  const content = $('#markdownContent').value
  try {
    $('#editorStatus').textContent = '草稿同步中 · 稳定后自动更新 A4 预览'
    await domainAction('/api/agent/draft', { content })
    await renderCurrent()
    if ($('#markdownContent').value !== content) scheduleDraftSync()
  } catch (error) {
    addMessage(`自动预览失败：${error.message}`)
    $('#editorStatus').textContent = '自动预览失败 · 可稍后重试'
  } finally { draftSyncRunning = false }
}

async function renderCurrent() {
  if (!sessionId) return
  try {
    const result = await request('/api/agent/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })
    updateState(result.state, result.context)
    setPreview()
  } catch (error) { addMessage(`渲染未完成：${error.message}`) }
}

function setPreview(force = false) {
  if (!sessionId || !currentContext.renderId) return
  const previewKey = `${sessionId}:${currentContext.renderId}`
  if (!force && loadedPreviewKey === previewKey) return
  loadedPreviewKey = previewKey
  $('#previewEmpty').hidden = true
  $('#previewFrame').hidden = false
  $('#previewFrame').src = `/api/agent/preview?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}`
  $('#previewMeta').textContent = `当前渲染 ${currentContext.renderId}`
}

function submitPreviewMeasurement(payload) {
  const renderId = payload?.renderId || payload?.metrics?.renderId
  if (!payload || payload.source !== 'cvagent-resume-preview' || !renderId) return
  if (!sessionId || renderId !== currentContext.renderId) return
  const key = `${sessionId}:${renderId}`
  if (receivedMeasurements.has(key)) return
  receivedMeasurements.add(key)
  void request('/api/agent/measure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      renderId,
      pageCount: payload.metrics.pageCount,
      occupancy: payload.metrics.pages?.map((page) => page.occupancyRatio) || [],
      overflow: Boolean(payload.metrics.overflow),
    }),
  }).then((result) => {
    latestMeasurement = result.measurement || null
    updateState(result.state, result.context)
    $('#previewMeta').textContent = result.verification?.passed ? '已测量 · 验收通过' : '已测量 · 需要调整'
    if (result.verification?.blockers?.length) addMessage(`排版验收未通过：${result.verification.blockers.join('；')}`)
  }).catch((error) => {
    receivedMeasurements.delete(key)
    addMessage(`A4 测量回传失败：${error.message}`)
  })
}

window.addEventListener('message', (event) => {
  const payload = event.data
  if (event.source !== $('#previewFrame').contentWindow) return
  submitPreviewMeasurement(payload)
})

// The iframe posts the exact measurement payload. Same-origin previews also
// expose it so a delayed cross-document message cannot leave the workbench in
// "measuring".
$('#previewFrame').addEventListener('load', () => {
  const frame = $('#previewFrame')
  const payload = frame.contentWindow?.__cvagentMetrics
  submitPreviewMeasurement(payload)
})

async function downloadCurrentHtml() {
  if (!sessionId || !currentContext.renderId) return
  try {
    const response = await fetch(`/api/agent/preview?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}`)
    if (!response.ok) throw new Error('当前预览不可用')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'resume-preview.html'
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) { addMessage(`下载失败：${error.message}`) }
}

function printCurrentPdf() {
  if (!sessionId || !currentContext.renderId) return
  $('#previewFrame').contentWindow?.focus()
  $('#previewFrame').contentWindow?.print()
}

async function domainAction(path, body = {}) {
  const result = await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...body }) })
  updateState(result.state, result.context)
  return result
}

$('#resumePreviewSelect').addEventListener('change', () => { /* Preview files are informational; source selection stays workspace-scoped. */ })
$('#targetPages').addEventListener('change', persistPreferences)
$('#templateSelect').addEventListener('change', () => { persistPreferences(); updateTemplateDescription(); syncTemplateLabels() })
$('#markdownContent').addEventListener('input', () => { updateCharCount(); scheduleDraftSync() })

;[['fontSize', 'fontSizeValue'], ['lineHeight', 'lineHeightValue'], ['sectionGap', 'sectionGapValue'], ['pageMargin', 'pageMarginValue'], ['iconScale', 'iconScaleValue']].forEach(([inputId, valueId]) => {
  $(`#${inputId}`).addEventListener('input', () => { $(`#${valueId}`).textContent = $(`#${inputId}`).value })
})

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => setView(item.dataset.view))
})
document.querySelectorAll('[data-view="settings"]').forEach((item) => item.addEventListener('click', () => setView('settings')))

$('#loadSource').addEventListener('click', loadSource)
$('#chooseWorkspace').addEventListener('click', chooseWorkspace)
$('#workspaceFolderInput').addEventListener('change', async (event) => {
  const files = await readFallbackFiles(event.target.files)
  try {
    const firstPath = event.target.files?.[0]?.webkitRelativePath || ''
    const name = firstPath.split('/')[0] || '未命名工作区'
    await importWorkspace(name, files)
  } catch (error) {
    addMessage(`工作区导入失败：${error.message}`)
  } finally {
    event.target.value = ''
  }
})
$('#refreshTemplates').addEventListener('click', loadTemplates)
$('#openAgent').addEventListener('click', () => { setView('agent'); $('#message').focus() })
$('#closeAgent').addEventListener('click', () => setView('workbench'))
$('#refreshPreview').addEventListener('click', () => { if (currentContext.renderId) setPreview(true) })
$('#downloadHtmlTop').addEventListener('click', downloadCurrentHtml)
$('#exportPdfTop').addEventListener('click', printCurrentPdf)
$('#saveVersionTop').addEventListener('click', () => $('#saveVersion').click())
function closeWorkbenchPopovers() {
  $('#templatePicker').hidden = true
  $('#tuningPopover').hidden = true
  $('#templatePickerButton').setAttribute('aria-expanded', 'false')
  $('#toggleControls').setAttribute('aria-expanded', 'false')
}

function togglePopover(id, triggerId) {
  const target = $(`#${id}`)
  const nextHidden = !target.hidden
  closeWorkbenchPopovers()
  target.hidden = nextHidden
  $(`#${triggerId}`).setAttribute('aria-expanded', String(!nextHidden))
  if (!nextHidden && id === 'tuningPopover') $('#fontSize').focus()
}

$('#templatePickerButton').addEventListener('click', () => togglePopover('templatePicker', 'templatePickerButton'))
$('#templatePickerClose').addEventListener('click', closeWorkbenchPopovers)
$('#toggleControls').addEventListener('click', () => togglePopover('tuningPopover', 'toggleControls'))
$('#tuningPopoverClose').addEventListener('click', closeWorkbenchPopovers)
$('#startLoad').addEventListener('click', () => { setView('workspace'); if (hasWorkspace()) void loadSource() })
$('#startPreview').addEventListener('click', () => setView('workbench'))
$('#startAgent').addEventListener('click', () => setView('agent'))
$('#workspaceRead').addEventListener('click', loadSource)
$('#workshopBack').addEventListener('click', () => setView('templates'))
$('#workshopCopy').addEventListener('click', async () => {
  const sourceTemplateId = $('#templateSelect').value
  const newTemplateId = window.prompt('请输入新模板 ID（小写英文、数字和短横线）', `${sourceTemplateId}-copy`)
  if (!newTemplateId) return
  try {
    const result = await request('/api/templates/copy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(workspaceBody({ sourceTemplateId, newTemplateId: newTemplateId.trim(), name: `${$('#workshopName').textContent} · 副本` })) })
    addMessage(`模板副本「${result.result.template?.name || newTemplateId}」已创建，原模板未修改。`)
    await loadTemplates()
    $('#templateSelect').value = newTemplateId.trim()
    updateTemplateDescription()
    setView('templates')
  } catch (error) { addMessage(`模板复制失败：${error.message}`) }
})
$('#workshopLoad').addEventListener('click', async () => {
  const id = $('#templateSelect').value
  if (!id || !hasWorkspace()) return
  try {
    const result = await request(`/api/template?${workspaceQuery({ id })}`)
    const template = result.template || {}
    $('#templateJsonEditor').value = JSON.stringify(Object.fromEntries(Object.entries(template).filter(([key]) => key !== 'templateCss')), null, 2)
    $('#templateCssEditor').value = template.templateCss || ''
    $('#workshopStatus').textContent = templates.find((item) => item.id === id)?.immutable ? '内置模板只读；复制后才能保存修订。' : '已读取模板源，可保存当前副本。'
    $('#workshopSave').disabled = Boolean(templates.find((item) => item.id === id)?.immutable)
  } catch (error) { addMessage(`模板读取失败：${error.message}`) }
})
$('#workshopSave').addEventListener('click', async () => {
  const id = $('#templateSelect').value
  try {
    const template = JSON.parse($('#templateJsonEditor').value)
    template.templateCss = $('#templateCssEditor').value
    const result = await request('/api/templates/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(workspaceBody({ templateJson: template, replaceExisting: true })) })
    addMessage(`模板「${result.result.template?.name || id}」已保存修订 ${result.result.revision}。`)
    $('#workshopStatus').textContent = `已保存修订 ${result.result.revision}；原有简历绑定不会自动切换。`
    await loadTemplates()
  } catch (error) { addMessage(`模板保存失败：${error.message}`) }
})
$('#templatesBack').addEventListener('click', () => setView('workbench'))
$('#versionsBack').addEventListener('click', () => setView('workbench'))
$('#toggleArchived').addEventListener('click', async () => {
  showArchivedVersions = !showArchivedVersions
  $('#toggleArchived').textContent = showArchivedVersions ? '隐藏已归档' : '显示已归档'
  await loadVersions()
})
$('#checksBack').addEventListener('click', () => setView('workbench'))
$('#settingsBack').addEventListener('click', () => setView('workbench'))
$('#checksRun').addEventListener('click', () => $('#runQuality').click())

if ($('#newSession')) $('#newSession').addEventListener('click', () => {
  sessionId = ''; currentContext = {}; latestMeasurement = null; $('#sessionSelect').value = ''; renderSessionMessages([]); $('#agentPanel').hidden = false; updateState('未开始'); addMessage('已新建会话。工作区和源文件仍保留。')
})

$('#newSessionSidebar')?.addEventListener('click', () => {
  sessionId = ''
  currentContext = {}
  taskState = 'waiting'
  latestMeasurement = null
  $('#sessionSelect').value = ''
  renderSessionMessages([])
  setView('agent')
  $('#message')?.focus()
  addMessage('已新建会话。工作区和源文件仍保留。')
})

$('#sessionSelect').addEventListener('change', () => { void restoreSession($('#sessionSelect').value) })

$('#applyTemplate').addEventListener('click', async () => {
  try { const result = await domainAction('/api/agent/template', { templateId: $('#templateSelect').value }); addMessage(`已应用模板「${result.result.name}」，旧预览已失效。`); await renderCurrent() } catch (error) { addMessage(`模板应用失败：${error.message}`) }
})

$('#applyPresentation').addEventListener('click', async () => {
  try {
    await domainAction('/api/agent/presentation', { layout: { fontSize: Number($('#fontSize').value), lineHeight: Number($('#lineHeight').value), sectionGap: Number($('#sectionGap').value), pageMargin: Number($('#pageMargin').value) }, iconTuning: { '*': { scale: Number($('#iconScale').value), offsetY: 0 } } })
    addMessage('排版参数已写入当前任务，旧预览已失效。')
    await renderCurrent()
  } catch (error) { addMessage(`排版调整失败：${error.message}`) }
})

$('#writeDraft').addEventListener('click', async () => {
  if (!sessionId) { addMessage('请先发送一次 Agent 任务建立会话，再保存隔离草稿。'); return }
  try { await domainAction('/api/agent/draft', { content: $('#markdownContent').value }); addMessage('Markdown 已保存为隔离草稿，源文件未改动。'); await renderCurrent() } catch (error) { addMessage(`草稿保存失败：${error.message}`) }
})

$('#runQuality').addEventListener('click', async () => {
  try { const result = await domainAction('/api/agent/quality', { target: 'draft', targetPages: Number($('#targetPages').value) }); addMessage(`内容检查：${result.result.passed ? '通过' : '需要修改'}，得分 ${result.result.score}`) } catch (error) { addMessage(`检查失败：${error.message}`) }
})

$('#saveVersion').addEventListener('click', async () => {
  const name = window.prompt('请输入版本名称', '未命名投递版')
  if (!name) return
  try { const result = await request('/api/agent/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, name, confirm: true }) }); updateState(result.state, currentContext); addMessage(`正式版本「${result.version.name}」已保存，模板参数已绑定。`) } catch (error) { addMessage(`保存失败：${error.message}`) }
  await loadVersions()
})

$('#saveAsVersion').addEventListener('click', () => $('#saveVersion').click())

$('#message').addEventListener('input', () => { $('#runHint').textContent = `${$('#message').value.length} / 2000` })
$('#composer').addEventListener('submit', async (event) => {
  event.preventDefault()
  const message = $('#message').value.trim()
  if (!message || !hasWorkspace()) { addMessage('请先选择工作区并填写任务描述。'); return }
  addMessage(message, 'user'); $('#message').value = ''; $('#send').disabled = true; $('#runHint').textContent = 'Agent 执行中…'
  try {
    const result = await request('/api/agent/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(workspaceBody({ message, sessionId: sessionId || undefined, targetPages: Number($('#targetPages').value), templateId: $('#templateSelect').value || 'campus-standard' })) })
    sessionId = result.sessionId; updateState(result.state, result.context); if (result.renderPath) setPreview(); addMessage(result.assistantText || `任务进入「${result.state}」阶段。`); $('#runHint').textContent = '已返回'
  } catch (error) { $('#runHint').textContent = '执行失败'; addMessage(`Agent 未完成：${error.message}`) }
  finally { $('#send').disabled = false }
})

bindResizableLayout()
setView('start')
restorePreferences()
updatePreviewPathSelect()
updateState('等待')
void loadWorkspaceCatalog().then(() => loadSessions())
