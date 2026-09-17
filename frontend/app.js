const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]

const sessions = {
  campus: { title: '校招一页版', status: '草稿 · 3 个阻断项', meta: 'resume.md · 校招标准 · A4' },
  product: { title: 'AI 产品经理定向版', status: '已渲染 · 待确认', meta: '林能隆 · AI 产品经理校招 · resume.md' },
  compress: { title: '压缩项目经历', status: '已保存 · 3 天前', meta: '林能隆 · AI 产品经理校招 · resume.md' },
}
const routeCopy = {
  workbench: { kicker: '简历工作台', title: '' },
  preview: { kicker: '成品', title: '预览' },
  templates: { kicker: '工作区资源', title: '模板库' },
  checks: { kicker: '验收', title: '排版检查' },
  versions: { kicker: '工作区成果', title: '投递版本' },
}
let currentRoute = 'workbench'
let currentSession = 'campus'
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

function updateHeader() {
  const data = sessions[currentSession]
  const copy = routeCopy[currentRoute]
  const routeStatus = { templates: '6 个模板', versions: '2 个正式版本', checks: '3 个阻断项' }
  $('#routeKicker').textContent = copy.kicker
  $('#routeTitle').textContent = currentRoute === 'workbench' ? data.title : copy.title
  $('#routeStatus').textContent = routeStatus[currentRoute] || data.status
  $('#routeStatus').classList.toggle('neutral-status', Boolean(routeStatus[currentRoute] && currentRoute !== 'checks'))
  $('#routeMeta').textContent = currentRoute === 'templates' || currentRoute === 'versions' ? '林能隆 · AI 产品经理校招 · 当前工作区' : data.meta
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

function renderChatLegacy() {
  return `<div class="chat-layout"><div class="chat-stream"><div class="timeline-label">今天 · 10:24</div><article class="message agent-message"><div class="avatar">A</div><div class="message-body"><div class="message-author">CVAgent <span>10:24</span></div><div class="message-bubble">我已读取当前简历和模板。你可以让我修改内容、调整版式，或针对一个岗位生成投递版。</div></div></article><article class="message user-message"><div class="avatar">L</div><div class="message-body"><div class="message-author">你 <span>10:25</span></div><div class="message-bubble">把实习经历改成更偏 AI 产品经理的投递版，并尽量压到一页。</div></div></article><div class="run-card"><div><i class="run-dot done">✓</i><b>已读取简历与模板</b><span>10:25</span></div><div><i class="run-dot done">✓</i><b>内容检查完成</b><span>10:25</span></div><div class="blocked"><i class="run-dot">3</i><b>排版验收未通过</b><span>2 页 / 目标 1 页</span></div></div><article class="message agent-message"><div class="avatar">A</div><div class="message-body"><div class="message-author">CVAgent <span>10:26</span></div><div class="message-bubble">当前有 3 个排版阻断项。建议先压缩项目经历，再重新渲染；右上角可以打开预览和手动调整。</div><div class="message-actions"><button type="button" data-suggest="先压缩项目经历，再重新渲染">采纳建议</button><button type="button" data-open-preview>打开预览</button></div></div></article></div><form class="composer" id="composer"><textarea id="messageInput" rows="3" placeholder="描述你要怎么改，例如：把实习经历改成 AI 产品经理投递版"></textarea><div class="composer-foot"><span>当前会话草稿 · 修改后需要重新渲染</span><span><kbd>Enter</kbd> 发送 <button type="submit">发送 ↗</button></span></div></form></div>`
}

function renderChat() {
  return `<div class="chat-layout"><div class="chat-stream"><div class="timeline-label">今天 · 10:24</div><article class="message agent-message"><div class="avatar">A</div><div class="message-body"><div class="message-author">CVAgent <span>10:24</span></div><div class="message-bubble">已载入当前简历和校招标准。可以修改内容、版式或生成投递版。</div></div></article><article class="message user-message"><div class="avatar">L</div><div class="message-body"><div class="message-author">你 <span>10:25</span></div><div class="message-bubble">把实习经历改成更偏 AI 产品经理的投递版，并尽量压到一页。</div></div></article><div class="run-card" aria-label="检查结果"><div class="run-label"><b>检查结果</b><span>10:25</span></div><div><i class="run-dot done">✓</i><b>已读取简历与模板</b></div><div><i class="run-dot done">✓</i><b>内容检查完成</b></div><div class="blocked"><i class="run-dot">3</i><b>排版验收未通过</b><span>2 页 / 目标 1 页</span></div></div><article class="message agent-message"><div class="avatar">A</div><div class="message-body"><div class="message-author">CVAgent <span>10:26</span></div><div class="message-bubble">当前有 3 个排版阻断项。先压缩项目经历，再重新渲染。</div><div class="message-actions"><button type="button" data-suggest="先压缩项目经历，再重新渲染">采纳建议</button><button type="button" data-open-preview>打开预览</button></div></div></article></div><form class="composer" id="composer"><textarea id="messageInput" rows="2" placeholder="描述你要怎么改，例如：把实习经历改成 AI 产品经理投递版"></textarea><div class="composer-foot"><span><kbd>Enter</kbd> 发送 <button type="submit">发送 ↗</button></span></div></form></div>`
}

function renderChatRefined() {
  return `<div class="chat-layout"><div class="chat-stream"><section class="turn turn-completed" aria-label="今天的对话"><div class="timeline-label">今天 · 10:24</div><article class="message agent-message" aria-label="Agent 消息"><div class="message-body"><div class="message-bubble">已载入当前简历和校招标准。可以修改内容、版式或生成投递版。</div></div></article><article class="message user-message" aria-label="用户消息"><div class="message-body"><div class="message-bubble">把实习经历改成更偏 AI 产品经理的投递版，并尽量压到一页。</div></div></article><section class="run-card tool-group" aria-label="本轮处理过程"><div class="run-label"><b>已处理 12 秒</b><span>10:25</span></div><details class="tool-row"><summary><i class="tool-state done" aria-hidden="true"></i><span>读取简历与模板</span><time>已完成</time></summary><div class="tool-detail">已载入 resume.md 和校招标准。</div></details><details class="tool-row"><summary><i class="tool-state done" aria-hidden="true"></i><span>检查页面密度</span><time>已完成</time></summary><div class="tool-detail">当前 2 页，目标 1 页。</div></details><details class="tool-row"><summary><i class="tool-state blocked" aria-hidden="true"></i><span>排版验收未通过</span><time>2 页 / 目标 1 页</time></summary><div class="tool-detail">项目经历和技能描述需要进一步压缩。</div></details></section><article class="message agent-message" aria-label="Agent 消息"><div class="message-body"><div class="message-bubble">当前有 3 个排版阻断项。请在工作台中压缩项目经历，再重新渲染确认成品。</div></div></article></section></div><form class="composer" id="composer"><textarea id="messageInput" rows="2" placeholder="描述你要怎么改，例如：把实习经历改成 AI 产品经理投递版"></textarea><div class="composer-foot"><span><kbd>Enter</kbd> 发送 <button type="submit">发送 ↗</button></span></div></form></div>`
}

function renderEditorLegacy() {
  return `<div class="editor-layout"><div class="editor-head"><div><b>Markdown 编辑器</b><span>修改只写入当前会话草稿，不覆盖源文件。</span></div><span id="editorState">未保存修改</span></div><textarea id="resumeEditor" spellcheck="false"># 林能隆

AI 产品经理（2027 届校招）

## 教育经历

山东农业大学 · 信息学院 · 计算机科学与技术（本科）

## 实习经历

### 智联招聘 · AI 产品实习生

- 将线上对话按场景筛选为基线，设计硬指标与软指标。
- 独立实现提示词迭代工作台，支持变量注入、批量实验和版本管理。
- 推动 Function Calling 迁移，降低提示词复杂度与输入成本。

## 项目经历

### HR Agent — AI 智能招聘分析工具

- 设计上传、分析、报告、人才库闭环。
- 负责五维人才画像、混合检索和结果呈现。</textarea><div class="editor-foot"><span>Markdown · 当前会话隔离草稿</span><button class="primary-small" id="editorApply" type="button">应用修改并重新渲染</button></div></div>`
}

function renderEditor() {
  return renderEditorLegacy()
    .replace('Markdown 编辑器', 'resume.md')
    .replace('修改只写入当前会话草稿，不覆盖源文件。', '当前会话草稿')
    .replace('未保存修改', '未保存')
    .replace('Markdown · 当前会话隔离草稿', 'Markdown 草稿')
    .replace('应用修改并重新渲染', '应用并重新渲染')
}

function renderWorkbench() {
  $('#routeView').innerHTML = `<div class="workbench-view"><div class="workbench-split"><section class="editor-pane" aria-label="Markdown 编辑区">${renderEditor()}</section><div class="resize-handle resize-editor" data-resize="editor" role="separator" aria-label="调整 Markdown 与预览宽度" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="900" tabindex="0"></div><section class="direct-preview-pane" aria-label="A4 预览区"><div class="direct-preview-head"><div><div class="eyebrow">A4 预览</div><b>校招标准</b><span>草稿 · 2 页 / 目标 1 页</span></div><div class="preview-actions"><span>适配宽度</span></div></div><div class="direct-preview-stage"><div class="direct-preview-frame-wrap"><iframe title="当前简历 A4 直接预览" src="./real-template?template=campus-standard" scrolling="no"></iframe></div></div><div class="direct-preview-foot"><span><i></i> 实时渲染</span><button class="secondary-button" type="button" data-open-full-preview>打开完整预览</button></div></section></div></div>`
  applyLayoutPrefs()
  $('#assistantContent').innerHTML = renderChatRefined()
  $('#editorApply').addEventListener('click', () => { $('#editorState').textContent = '已应用 · 待渲染'; updateSessionStatus('草稿已更新 · 待渲染'); showToast('内容已写入当前会话草稿') })
  bindChat()
  $('[data-open-full-preview]').addEventListener('click', () => renderRoute('preview'))
}

function renderPreview() {
  $('#routeView').innerHTML = `<div class="preview-page"><div class="page-toolbar preview-actions"><button class="secondary-button" type="button">上一页</button><button class="secondary-button" type="button">下一页</button><select aria-label="预览缩放"><option>100%</option><option>80%</option><option>120%</option></select></div><div class="full-preview-canvas"><div class="full-real-frame-wrap"><iframe class="full-real-frame" title="当前简历完整 A4 预览" src="./real-template?template=campus-standard"></iframe></div></div><div class="preview-foot"><span><i></i> 当前 render · 待测量</span><button class="primary-small" type="button">重新渲染</button></div></div>`
}

function templateCard(id, name, revision, type, selected, tags) {
  return `<article class="template-card ${selected ? 'selected' : ''}" data-template="${id}"><div class="template-thumb" aria-label="${name}真实模板缩略图"><iframe class="template-real-thumb" title="${name}真实模板缩略图" src="./real-template?template=${encodeURIComponent(id)}" loading="lazy"></iframe></div><div class="template-info"><div class="template-name"><b>${name}</b><span>${selected ? '当前使用' : '可选择'}</span></div><small>${revision}</small><div class="tag-row">${tags.map((tag) => `<i>${tag}</i>`).join('')}</div><button class="secondary-button template-select" data-template="${id}" type="button">${selected ? '当前使用' : '选择模板'}</button></div></article>`
}

function renderTemplates() {
  $('#routeView').innerHTML = `<div class="templates-page"><div class="template-grid">${templateCard('campus-standard', '校招标准', '内置模板 · campus-standard', 'standard', true, ['单栏', '校招', '标准'])}${templateCard('business-ledger-plus', '商务履历增强', '内置模板 · business-ledger-plus', 'business', false, ['商务', '时间线', '社招'])}${templateCard('magazine-feature', '杂志开篇', '内置模板 · magazine-feature', 'editorial', false, ['运营', '杂志', '叙事'])}${templateCard('geek-lab', '极客实验室', '内置模板 · geek-lab', 'terminal', false, ['Geek', '暗黑', '模块化'])}${templateCard('case-study', '重点案例', '内置模板 · case-study', 'case', false, ['作品集', '重点内容', '产品'])}${templateCard('portrait-profile', '肖像侧栏', '内置模板 · portrait-profile', 'portrait', false, ['设计', '头像', '个人品牌'])}</div></div>`
  $$('.template-select').forEach((button) => button.addEventListener('click', () => { $$('.template-card').forEach((card) => { card.classList.toggle('selected', card === button.closest('.template-card')); card.querySelector('.template-name span').textContent = card === button.closest('.template-card') ? '当前使用' : '可选择' }); $$('.template-select').forEach((item) => { item.textContent = item === button ? '当前使用' : '选择模板' }); updateSessionStatus('模板已更新 · 待重新渲染'); showToast(`已选择「${button.closest('.template-card').querySelector('.template-name b').textContent}」`) }))
}

function renderChecks() {
  $('#routeView').innerHTML = `<div class="checks-page"><div class="check-overview"><div><small>当前页数</small><strong>2 页</strong><span>目标 1 页</span></div><div><small>当前渲染</small><strong>待测量</strong><span>render · 2026.09</span></div><div><small>保存正式版</small><strong>不可用</strong><span>验收通过后开放</span></div></div><div class="blocker-list"><article class="blocker-item"><i>1</i><div><b>内容过多</b><p>项目经历和技能描述占用空间较大。</p><span>影响：第 2 页出现残留内容</span></div><button class="secondary-button" type="button">回到编辑</button></article><article class="blocker-item"><i>2</i><div><b>页面密度不均</b><p>第 2 页只有技能和荣誉内容。</p><span>影响：成品视觉不完整</span></div><button class="secondary-button" type="button">查看第 2 页</button></article><article class="blocker-item"><i>3</i><div><b>Section Gap 偏大</b><p>当前模板段落间距为 20px。</p><span>建议：先降低 Section Gap，再重新渲染</span></div><button class="primary-small" type="button">打开微调</button></article></div></div>`
}

function renderVersions() {
  $('#routeView').innerHTML = `<div class="versions-page"><div class="page-toolbar"><button class="primary-small" type="button" disabled title="当前简历未通过验收">创建正式版本</button></div><div class="version-list"><article class="version-row current"><div class="version-mark">D</div><div class="version-copy"><b>当前草稿</b><span>校招一页版 · 草稿 · 需要重新验收</span><small>最后修改：刚刚 · 未固化</small></div><em>不可导出</em><button class="secondary-button" type="button">继续调整</button></article><article class="version-row"><div class="version-mark saved">01</div><div class="version-copy"><b>上一版校招简历</b><span>校招一页版 · 正式版本</span><small>保存于 2026-09-14 · A4 · 1 页</small></div><em class="saved-label">已保存</em><button class="secondary-button" type="button">打开</button></article><article class="version-row"><div class="version-mark saved">02</div><div class="version-copy"><b>AI 产品经理定向版</b><span>针对产品岗位的投递版本</span><small>保存于 2026-09-12 · A4 · 1 页</small></div><em class="saved-label">已保存</em><button class="secondary-button" type="button">打开</button></article></div></div>`
}

function bindChat() {
  $('#composer').addEventListener('submit', (event) => {
    event.preventDefault()
    const input = $('#messageInput')
    const value = input.value.trim()
    if (!value) return
    const article = document.createElement('article')
    article.className = 'message user-message'
    article.setAttribute('aria-label', '用户消息')
    article.innerHTML = '<div class="message-body"><div class="message-bubble"></div></div>'
    article.querySelector('.message-bubble').textContent = value
    const stream = $('.chat-stream')
    stream.append(article)
    input.value = ''
    article.scrollIntoView({ behavior: 'smooth', block: 'end' })
    updateSessionStatus('草稿已更新 · 需要重新渲染')
    showToast('已加入当前会话草稿')
    const progress = document.createElement('div')
    progress.className = 'turn-progress is-running'
    progress.setAttribute('role', 'status')
    progress.innerHTML = '<i aria-hidden="true"></i><span>正在更新简历草稿</span><time>进行中</time>'
    stream.append(progress)
    progress.scrollIntoView({ behavior: 'smooth', block: 'end' })
    window.setTimeout(() => {
      progress.classList.remove('is-running')
      progress.innerHTML = '<i aria-hidden="true"></i><span>已记录修改要求，重新渲染后确认页数和成品效果</span><time>完成</time>'
      const response = document.createElement('article')
      response.className = 'message agent-message'
      response.setAttribute('aria-label', 'Agent 消息')
      response.innerHTML = '<div class="message-body"><div class="message-bubble">这条修改要求已加入当前会话。请继续编辑或应用草稿后查看最新成品。</div></div>'
      stream.append(response)
      response.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 900)
  })
}

function renderRoute(route) {
  currentRoute = route
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.route === route))
  if (route !== 'workbench') setPreviewOpen(false)
  if (route === 'workbench') { $('#routeActions').innerHTML = '<button class="ghost-button" id="workbenchAssistantButton" type="button">打开 Agent</button>'; renderWorkbench() }
  if (route === 'preview') { $('#routeActions').innerHTML = '<button class="ghost-button" type="button">导出预览</button>'; renderPreview() }
  if (route === 'templates') { $('#routeActions').innerHTML = '<button class="ghost-button" type="button">导入模板</button>'; renderTemplates() }
  if (route === 'checks') { $('#routeActions').innerHTML = '<button class="ghost-button" type="button">重新检查</button>'; renderChecks() }
  if (route === 'versions') { $('#routeActions').innerHTML = '<button class="ghost-button" type="button">版本说明</button>'; renderVersions() }
  updateHeader()
  const assistantButton = $('#workbenchAssistantButton')
  if (assistantButton) assistantButton.addEventListener('click', () => setPreviewOpen(!previewOpen))
}

$$('.nav-item').forEach((item) => item.addEventListener('click', () => renderRoute(item.dataset.route)))
$$('.session-item').forEach((item) => item.addEventListener('click', () => { currentSession = item.dataset.session; $$('.session-item').forEach((session) => session.classList.toggle('active', session === item)); renderRoute(currentRoute); showToast(`已切换到「${sessions[currentSession].title}」`) }))
$('#drawerClose').addEventListener('click', () => setPreviewOpen(false))
$('#workspaceSwitcher').addEventListener('click', () => { const button = $('#workspaceSwitcher'); const menu = $('#workspaceMenu'); const open = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!open)); menu.hidden = open })
$$('[data-workspace]').forEach((button) => button.addEventListener('click', () => { $('#workspaceLabel').textContent = button.dataset.workspace; $('#workspaceMenu').hidden = true; $('#workspaceSwitcher').setAttribute('aria-expanded', 'false'); showToast(`已绑定工作区「${button.dataset.workspace}」`) }))
$('#newSession').addEventListener('click', () => showToast('已准备新会话入口'))

bindResizableLayout()
renderRoute('workbench')
