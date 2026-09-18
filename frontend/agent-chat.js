(function initAgentChat(global) {
  const toolLabels = {
    workspace_info: '读取工作区',
    resume_prepare: '准备简历任务',
    resume_read: '读取当前简历',
    resume_check: '检查简历内容',
    template_list: '读取模板库',
    template_select: '切换简历模板',
    template_generate: '生成模板候选',
    template_save: '保存工作区模板',
    template_versions: '读取模板修订',
    template_restore: '恢复模板修订',
    workspace_materials_list: '读取工作区材料',
    presentation_update: '调整版式参数',
    resume_write: '写入隔离草稿',
    resume_render: '重新渲染简历',
    resume_metrics: '接收 A4 测量',
    resume_finalize: '完成排版验收',
  }

  const eventLabels = {
    artifact_written: '草稿已更新',
    render_started: '开始渲染',
    render_succeeded: '渲染完成',
    render_failed: '渲染失败',
    measurement_received: '收到真实 A4 测量',
    verification_passed: '排版验收通过',
    verification_blocked: '排版验收被阻断',
    verification_failed: '排版验收失败',
    save_confirmed: '正式版本已保存',
    save_rejected: '正式版本未保存',
    source_changed: '源文件发生变化',
  }

  const statusLabels = {
    running: '进行中',
    done: '完成',
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
      .map((message) => ({ role: message.role, content: message.content, timestamp: message.timestamp }))
      .filter((message) => String(message.content || '').trim())
  }

  function eventStatus(events) {
    if (events.some((event) => ['verification_blocked', 'tool_call_failed', 'render_failed', 'verification_failed'].includes(event.event))) return 'blocked'
    if (events.some((event) => event.event === 'agent_run_finished')) return 'done'
    if (events.some((event) => event.event === 'agent_run_started')) return 'running'
    return 'idle'
  }

  function eventGroups(events) {
    const groups = []
    const byKey = new Map()
    const runSequences = new Map()
    const activeKeys = new Map()
    for (const event of Array.isArray(events) ? events : []) {
      const baseKey = String(event.runId || event.taskId || 'current')
      if (event.event === 'agent_run_started') {
        const sequence = (runSequences.get(baseKey) || 0) + 1
        runSequences.set(baseKey, sequence)
        activeKeys.set(baseKey, `${baseKey}:${sequence}`)
      }
      const key = activeKeys.get(baseKey) || `${baseKey}:0`
      if (!byKey.has(key)) {
        const group = { key, runId: baseKey, events: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      byKey.get(key).events.push(event)
    }
    return groups
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

  function processRows(events) {
    const rows = []
    const rowByKey = new Map()
    for (const event of events) {
      const isTool = event.event === 'tool_call_started' || event.event === 'tool_call_succeeded' || event.event === 'tool_call_failed'
      if (event.event === 'agent_run_started' || event.event === 'agent_run_finished') continue
      const key = isTool ? `tool:${event.toolName || 'agent'}` : `event:${event.event}`
      if (!rowByKey.has(key)) {
        const row = { key, label: isTool ? (toolLabels[event.toolName] || event.toolName || 'Agent 工具') : (eventLabels[event.event] || 'Agent 处理'), state: 'running', detail: '', summary: null, timestamp: event.timestamp, durationMs: null }
        rowByKey.set(key, row)
        rows.push(row)
      }
      const row = rowByKey.get(key)
      row.timestamp = event.timestamp || row.timestamp
      row.durationMs = event.durationMs ?? row.durationMs
      if (event.event === 'tool_call_succeeded' || event.event === 'render_succeeded' || event.event === 'verification_passed' || event.event === 'measurement_received' || event.event === 'artifact_written' || event.event === 'save_confirmed') row.state = 'done'
      if (event.event === 'tool_call_failed' || event.event === 'render_failed' || event.event === 'verification_failed' || event.event === 'verification_blocked' || event.event === 'source_changed') row.state = 'blocked'
      if (event.event === 'tool_call_started' || event.event === 'render_started') row.state = 'running'
      if (event.errorCode) row.detail = event.errorCode
      if (event.resultSummary) row.summary = event.resultSummary
      if (event.outcome === 'failed') row.state = 'blocked'
    }
    return rows
  }

  function renderMessage(message, index) {
    const isUser = message.role === 'user'
    const role = isUser ? '用户' : 'Agent'
    const time = readableTime(message.timestamp)
    const body = isUser ? `<p>${escapeHtml(message.content)}</p>` : renderMarkdown(message.content)
    return `<article class="message ${isUser ? 'user-message' : 'agent-message'}" aria-label="${role}消息" data-message-index="${index}"><div class="message-meta"><span>${role}</span>${time ? `<time>${escapeHtml(time)}</time>` : ''}</div><div class="message-content${isUser ? '' : ' markdown-body'}">${body}</div></article>`
  }

  function renderRunGroup(group, index) {
    const status = eventStatus(group.events)
    const rows = processRows(group.events)
    const statusText = statusLabels[status] || status
    const runRows = rows.length ? rows.map((row) => {
      const detail = `${renderToolSummary(row.summary)}${row.detail ? `<div class="tool-detail">${escapeHtml(row.detail)}</div>` : ''}`
      const duration = row.durationMs !== null && row.durationMs !== undefined ? `${Math.max(0, Math.round(Number(row.durationMs) || 0))} ms` : ''
      return `<details class="tool-row" ${row.state === 'blocked' ? 'open' : ''}><summary><i class="tool-state ${escapeHtml(row.state)}" aria-hidden="true"></i><span>${escapeHtml(row.label)}</span><time>${escapeHtml(duration || statusLabels[row.state] || '')}</time></summary>${detail}</details>`
    }).join('') : '<div class="tool-empty">Agent 正在准备当前简历流程…</div>'
    const summary = rows.length ? `已执行 ${rows.length} 项工具` : '正在准备工具'
    return `<details class="tool-group ${escapeHtml(status)}" aria-label="Agent 制作流程" data-run-index="${index}" ${status === 'running' ? 'open' : ''}><summary class="run-label"><b>本轮简历制作</b><span>${escapeHtml(summary)} · ${escapeHtml(statusText)}</span></summary>${runRows}</details>`
  }

  function renderInterleavedTimeline(messages, groups) {
    const normalized = normalizedMessages(messages)
    if (!normalized.length) return groups.map((group, index) => renderRunGroup(group, index))

    // A conversation turn starts with a user message. Insert the matching
    // workflow group before that turn's final Agent answer, so tool work stays
    // in the same reading order as the conversation instead of being appended
    // after every message.
    const segments = []
    let segment = []
    normalized.forEach((message) => {
      if (message.role === 'user' && segment.length) {
        segments.push(segment)
        segment = []
      }
      segment.push(message)
    })
    if (segment.length) segments.push(segment)

    const content = []
    let groupIndex = 0
    let messageIndex = 0
    segments.forEach((turn) => {
      const assistantIndexes = turn.reduce((indexes, message, index) => {
        if (message.role === 'assistant') indexes.push(index)
        return indexes
      }, [])
      const insertionIndex = assistantIndexes.length ? assistantIndexes.at(-1) : turn.length

      turn.forEach((message, index) => {
        if (index === insertionIndex && groupIndex < groups.length) {
          content.push(renderRunGroup(groups[groupIndex], groupIndex))
          groupIndex += 1
        }
        content.push(renderMessage(message, messageIndex))
        messageIndex += 1
      })
    })

    // Keep unusual/bootstrap events visible even when the session has fewer
    // message turns than persisted workflow runs.
    while (groupIndex < groups.length) {
      content.push(renderRunGroup(groups[groupIndex], groupIndex))
      groupIndex += 1
    }
    return content
  }

  function renderTimeline({ messages, events, sessionReady, activeRun = false, error = '' }) {
    const groups = eventGroups(events)
    const latestStatus = groups.length ? eventStatus(groups.at(-1).events) : 'idle'
    const displayGroups = groups.slice()
    if (activeRun && latestStatus !== 'running') {
      displayGroups.push({
        key: 'active-run',
        events: [{ event: 'agent_run_started', runId: 'active-run', timestamp: new Date().toISOString() }],
      })
    }
    const content = renderInterleavedTimeline(messages, displayGroups)
    if (error) content.push(`<div class="agent-error" role="alert"><strong>本轮处理未完成</strong><span>${escapeHtml(error)}</span></div>`)
    if (!content.length) {
      content.push(`<div class="chat-empty"><strong>${sessionReady ? '从当前简历开始' : '选择工作区后开始'}</strong><p>${sessionReady ? '告诉 Agent 你想投递什么岗位，或直接说出要调整的内容。它会先读取草稿，再逐步完成检查、渲染和真实 A4 验收。' : '选择一个简历工作区，Agent 才能读取隔离草稿并执行制作流程。'}</p></div>`)
    } else if (displayGroups.length) {
      const latest = activeRun ? 'running' : latestStatus
      const next = latest === 'running' ? '正在等待当前步骤完成' : latest === 'blocked' ? '请补充信息或确认下一步调整' : '继续描述你希望调整的部分'
      content.push(`<div class="next-action"><span>下一步</span><b>${next}</b></div>`)
    }
    return content.join('')
  }

  global.cvAgentChat = Object.freeze({ eventLabels, escapeHtml, renderMarkdown, renderTimeline, toolLabels })
})(window)
