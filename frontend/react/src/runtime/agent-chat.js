import { projectWorkflowTimeline, runEventStatus, workflowGroupHasAssistantText } from './agent-chat-state.js'

;(function initAgentChat(global) {
  const toolLabels = {
    workspace_info: '读取工作区',
    resume_prepare: '准备简历任务',
    resume_production_guide: '读取简历生产契约',
    resume_read: '读取当前简历',
    resume_check: '检查简历内容',
    icon_list: '查询可用图标',
    layout_validate: '校验模板布局',
    template_list: '读取模板库',
    template_select: '切换简历模板',
    template_generate: '生成模板候选',
    template_save: '保存工作区模板',
    template_versions: '读取模板修订',
    template_restore: '恢复模板修订',
    workspace_materials_list: '读取工作区材料',
    workspace_material_read: '读取材料',
    read_file: '读取文件',
    write_file: '写入文件',
    presentation_update: '调整版式参数',
    presentation_suggest: '生成版式调整建议',
    resume_write: '写入隔离草稿',
    resume_render: '重新渲染简历',
    resume_metrics: '接收 A4 测量',
    resume_finalize: '完成排版验收',
    resume_save_version: '保存正式版本',
  }

  const statusLabels = {
    running: '进行中',
    done: '完成',
    waiting: '等待测量',
    blocked: '需调整',
    failed: '失败',
    idle: '等待',
  }

  const summaryLabels = {
    prepared: '准备结果',
    targetPages: '目标页数',
    fileName: '文件',
    fileCount: '材料数量',
    truncated: '列表已截断',
    bytes: '文件大小',
    headingCount: '标题数量',
    passed: '检查通过',
    score: '评分',
    warningCount: '警告数',
    templateCount: '模板数量',
    templateId: '模板',
    templateRevision: '模板版本',
    state: '状态',
    sourcePreserved: '源文件保留',
    contentVersion: '内容版本',
    renderId: '渲染版本',
    pageCount: '页数',
    occupancy: '页面占用',
    blockerCount: '阻断数',
    createdAsCopy: '已创建副本',
    revision: '修订号',
    persisted: '已保存',
    restoredFrom: '恢复来源',
    selected: '当前会话已切换',
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character])
  }

  function safeHref(value) {
    const href = String(value || '').trim()
    return /^https?:\/\//i.test(href) ? href : ''
  }

  function inlineMarkdown(value) {
    let html = escapeHtml(value)
    html = html.replace(/\\\|/g, '|')
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)/gi, (match, prefix, href) => {
      const safe = safeHref(href.replace(/[),.;!?]+$/g, ''))
      if (!safe) return match
      const trailing = href.slice(safe.length)
      return `${prefix}<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${escapeHtml(safe)}</a>${escapeHtml(trailing)}`
    })
    return html
  }

  function splitTableRow(line) {
    let value = String(line || '').trim()
    if (value.startsWith('|')) value = value.slice(1)
    if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)
    const cells = []
    let cell = ''
    let escaped = false
    for (const character of value) {
      if (character === '|' && !escaped) {
        cells.push(cell.trim())
        cell = ''
        continue
      }
      cell += character
      escaped = character === '\\' && !escaped
      if (character !== '\\') escaped = false
    }
    cells.push(cell.trim())
    return cells
  }

  function isTableSeparator(line) {
    const cells = splitTableRow(line)
    return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  }

  function renderTable(header, separator, bodyRows) {
    const rows = [header, ...bodyRows]
    const columnCount = Math.max(...rows.map((row) => row.length), separator.length)
    const alignments = separator.map((cell) => {
      if (/^:-{2,}:$/.test(cell)) return 'center'
      if (/^-{3,}:$/.test(cell)) return 'right'
      return 'left'
    })
    const renderCells = (cells, tag) => Array.from({ length: columnCount }, (_, index) => {
      const align = alignments[index] || 'left'
      return `<${tag} class="markdown-table-${align}">${inlineMarkdown(cells[index] || '')}</${tag}>`
    }).join('')
    const body = bodyRows.map((row) => `<tr>${renderCells(row, 'td')}</tr>`).join('')
    return `<div class="markdown-table-wrap"><table class="markdown-table"><thead><tr>${renderCells(header, 'th')}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table></div>`
  }

  function renderMarkdown(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n')
    const output = []
    let codeLines = []
    let inCode = false
    let listType = ''

    const closeList = () => {
      if (!listType) return
      output.push(`</${listType}>`)
      listType = ''
    }

    const closeCode = () => {
      if (!inCode) return
      output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      codeLines = []
      inCode = false
    }

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]
      if (/^\s*```/.test(line)) {
        closeList()
        if (inCode) closeCode()
        else inCode = true
        continue
      }
      if (inCode) {
        codeLines.push(line)
        continue
      }
      if (line.includes('|') && lines[lineIndex + 1] && isTableSeparator(lines[lineIndex + 1])) {
        closeList()
        const header = splitTableRow(line)
        const separator = splitTableRow(lines[lineIndex + 1])
        const bodyRows = []
        lineIndex += 1
        while (lines[lineIndex + 1] && lines[lineIndex + 1].trim() && !/^\s*```/.test(lines[lineIndex + 1]) && !isTableSeparator(lines[lineIndex + 1]) && String(lines[lineIndex + 1]).includes('|')) {
          lineIndex += 1
          bodyRows.push(splitTableRow(lines[lineIndex]))
        }
        output.push(renderTable(header, separator, bodyRows))
        continue
      }
      if (!line.trim()) {
        closeList()
        continue
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line)
      if (heading) {
        closeList()
        const level = Math.min(heading[1].length + 2, 5)
        output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
        continue
      }
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
      if (bullet) {
        if (listType !== 'ul') {
          closeList()
          output.push('<ul>')
          listType = 'ul'
        }
        output.push(`<li>${inlineMarkdown(bullet[1])}</li>`)
        continue
      }
      const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
      if (numbered) {
        if (listType !== 'ol') {
          closeList()
          output.push('<ol>')
          listType = 'ol'
        }
        output.push(`<li>${inlineMarkdown(numbered[1])}</li>`)
        continue
      }
      closeList()
      output.push(`<p>${inlineMarkdown(line)}</p>`)
    }
    closeList()
    closeCode()
    return output.join('') || '<p class="markdown-empty">Agent 暂无文字说明。</p>'
  }

  function readableTime(timestamp) {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  function normalizedMessages(messages) {
    return (Array.isArray(messages) ? messages : [])
      .filter((message) => ['user', 'assistant'].includes(message?.role))
      .map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        turnId: message.turnId,
        messageId: message.messageId || message.id,
        runId: message.runId,
      }))
      .filter((message) => String(message.content || '').trim())
  }

  function eventGroups(events) {
    const groups = []
    const byKey = new Map()
    const legacySequences = new Map()
    const legacyActiveKeys = new Map()
    let agentRunStarted = false
    for (const event of Array.isArray(events) ? events : []) {
      if (event.event === 'agent_run_started') agentRunStarted = true
      // Bootstrap, automatic A4 measurement, and background verification are
      // system activity. They belong to the audit log, not the conversation.
      if (!agentRunStarted) continue
      const stableTurnId = String(event.turnId || '').trim()
      const stableRunId = String(event.runId || '').trim()
      const baseKey = stableTurnId || stableRunId || String(event.taskId || 'current')
      // New events carry a per-turn runId. A paused production turn may emit
      // several agent_run_started records while it waits for measurement and
      // resumes; those records must remain one chronological workflow card.
      // Older persisted events have no runId, so retain the old start-based
      // split only for that legacy shape.
      let key = baseKey
      if (!stableTurnId && !stableRunId) {
        if (event.event === 'agent_run_started') {
          const sequence = (legacySequences.get(baseKey) || 0) + 1
          legacySequences.set(baseKey, sequence)
          legacyActiveKeys.set(baseKey, `${baseKey}:${sequence}`)
        }
        key = legacyActiveKeys.get(baseKey) || `${baseKey}:0`
      }
      if (!byKey.has(key)) {
        const group = { key, turnId: stableTurnId || '', runId: stableRunId || baseKey, events: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      byKey.get(key).events.push(event)
    }
    // Ordinary chat and read-only answers can complete without any tool call.
    // Do not render an empty "preparing tools" card for those turns; a tool
    // timeline is useful only when it contains an actual tool lifecycle.
    const isToolEvent = (event) => ['tool_call_started', 'tool_call_succeeded', 'tool_call_failed'].includes(event.event)
    const isVisibleAssistantEvent = (event) => event.event === 'assistant_delta' && String(event.delta || '').trim()
    // A message lifecycle can be opened and closed without producing any
    // user-visible text (for example, the model answers through the snapshot
    // path). That lifecycle is already represented by the message snapshot;
    // keeping it here would create an orphan "正在处理" block.
    return groups.filter((group) => group.events.some((event) => isToolEvent(event) || isVisibleAssistantEvent(event)))
  }

  function formatSummaryValue(key, value) {
    if (typeof value === 'boolean') return value ? '是' : '否'
    if (key === 'occupancy' && Array.isArray(value)) return value.map((item) => `${Math.round(Number(item) * 100)}%`).join(' / ')
    if (key === 'bytes') return `${value} B`
    return String(value ?? '')
  }

  function renderToolSummary(summary) {
    if (!summary || typeof summary !== 'object') return ''
    const items = Object.entries(summary)
      .filter(([key, value]) => summaryLabels[key] && value !== undefined && value !== null)
      .map(([key, value]) => `<span class="tool-detail-item"><b>${escapeHtml(summaryLabels[key])}</b><span>${escapeHtml(formatSummaryValue(key, value))}</span></span>`)
    return items.length ? `<div class="tool-detail">${items.join('')}</div>` : ''
  }

  function renderMessage(message, index) {
    const isUser = message.role === 'user'
    const role = isUser ? '用户' : 'Agent'
    const time = readableTime(message.timestamp)
    const body = isUser ? `<p>${escapeHtml(message.content)}</p>` : renderMarkdown(message.content)
    return `<article class="message ${isUser ? 'user-message' : 'agent-message'}" aria-label="${role}消息" data-message-index="${index}"><div class="message-meta"><span>${role}</span>${time ? `<time>${escapeHtml(time)}</time>` : ''}</div><div class="message-content${isUser ? '' : ' markdown-body'}">${body}</div></article>`
  }

  function renderToolEntry(entry) {
    const detail = `${renderToolSummary(entry.summary)}${entry.detail ? `<div class="tool-detail">${escapeHtml(entry.detail)}</div>` : ''}`
    const duration = entry.durationMs !== null && entry.durationMs !== undefined ? `${Math.max(0, Math.round(Number(entry.durationMs) || 0))} ms` : ''
    const label = toolLabels[entry.toolName] || entry.toolName || 'Agent 工具'
    return `<details class="tool-row ${escapeHtml(entry.state)}"><summary><i class="tool-state ${escapeHtml(entry.state)}" aria-hidden="true"></i><span>${escapeHtml(label)}</span><time>${escapeHtml(duration || statusLabels[entry.state] || '')}</time></summary>${detail}</details>`
  }

  function renderAssistantEntry(entry, activeRun) {
    const text = String(entry.text || '')
    if (!text.trim()) return ''
    const caret = activeRun && entry.state !== 'done' ? '<span class="streaming-caret" aria-hidden="true"></span>' : ''
    return `<article class="message agent-message timeline-assistant" aria-label="Agent消息"><div class="message-meta"><span>Agent</span><time>${escapeHtml(readableTime(entry.timestamp))}</time></div><div class="message-content markdown-body">${renderMarkdown(text)}${caret}</div></article>`
  }

  function renderToolGroup(entries, status, index, { activeRun = false } = {}) {
    const statusText = statusLabels[status] || status
    const isActive = activeRun && status === 'running'
    return `<details class="tool-group run-trace ${escapeHtml(status)}"${isActive ? ' data-active="true"' : ''}><summary class="run-label"><b>工具过程</b><span>${entries.length} 项工具 · ${escapeHtml(statusText)}</span></summary><div class="tool-group-entries">${entries.map((entry) => renderToolEntry(entry)).join('')}</div></details>`
  }

  function renderRunGroup(group, index, { activeRun = false } = {}) {
    const status = runEventStatus(group.events)
    const entries = projectWorkflowTimeline(group.events)
    const rows = []
    let toolEntries = []
    const flushTools = () => {
      if (!toolEntries.length) return
      rows.push(renderToolGroup(toolEntries, status, index, { activeRun }))
      toolEntries = []
    }
    entries.forEach((entry) => {
      if (entry.kind === 'tool') {
        toolEntries.push(entry)
        return
      }
      // DeepAgent emits assistant lifecycle boundaries even when no user-visible
      // text was produced. They are state facts, not visual separators. Do not
      // flush a tool group for an empty lifecycle row or one run becomes a
      // stack of blank "工具过程" blocks.
      if (!String(entry.text || '').trim()) return
      flushTools()
      rows.push(renderAssistantEntry(entry, activeRun))
    })
    flushTools()
    if (!rows.length) rows.push('<div class="tool-empty">正在处理</div>')
    return `<section class="run-trace ${escapeHtml(status)}" aria-label="Agent 工作流" data-run-index="${index}">${rows.join('')}</section>`
  }

  function renderInterleavedTimeline(messages, groups, { activeRun = false } = {}) {
    const normalized = normalizedMessages(messages)
    if (!normalized.length) return groups.map((group, index) => renderRunGroup(group, index, { activeRun: activeRun && index === groups.length - 1 }))

    // A completed turn is represented in two stores: the append-only event
    // rail (needed for live order) and the final session message snapshot.
    // The explicit turnId is the only join key. Never pair a workflow group
    // with a message by array position: old workflows can be replayed, a
    // continuation can share a turn, and a failed run may have no assistant
    // snapshot at all.
    const segments = []
    normalized.forEach((message) => segments.push(message))
    const groupsByTurn = new Map()
    groups.forEach((group, index) => {
      const key = String(group.turnId || '').trim()
      if (!key) return
      const list = groupsByTurn.get(key) || []
      list.push({ group, index })
      groupsByTurn.set(key, list)
    })
    const renderedGroups = new Set()
    const content = []
    let messageIndex = 0
    segments.forEach((message) => {
      const turnId = String(message.turnId || '').trim()
      if (message.role === 'user') {
        content.push(renderMessage(message, messageIndex))
        const turnGroups = groupsByTurn.get(turnId) || []
        turnGroups.forEach(({ group, index }) => {
          content.push(renderRunGroup(group, index, { activeRun: activeRun && index === groups.length - 1 }))
          renderedGroups.add(index)
        })
        messageIndex += 1
        return
      }
      const turnGroups = groupsByTurn.get(turnId) || []
      const groupRendersAssistant = turnGroups.some(({ group }) => workflowGroupHasAssistantText(group))
      if (!groupRendersAssistant) content.push(renderMessage(message, messageIndex))
      messageIndex += 1
    })

    // Legacy sessions without turnId and diagnostics without a matching
    // snapshot remain visible, but are never inserted by ordinal position.
    groups.forEach((group, index) => {
      if (renderedGroups.has(index)) return
      content.push(renderRunGroup(group, index, { activeRun: activeRun && index === groups.length - 1 }))
    })
    return content
  }

  function renderTimeline({ messages, events, sessionReady, activeRun = false, error = '' }) {
    const groups = eventGroups(events)
    const content = renderInterleavedTimeline(messages, groups, { activeRun })
    if (error) content.push(`<div class="agent-error" role="alert"><strong>本轮处理未完成</strong><span>${escapeHtml(error)}</span></div>`)
    if (!content.length) {
      content.push(`<div class="chat-empty"><strong>${sessionReady ? '开始对话' : '选择工作区'}</strong></div>`)
    }
    return content.join('')
  }

  global.cvAgentChat = Object.freeze({ escapeHtml, renderMarkdown, renderTimeline, toolLabels })
})(window)
