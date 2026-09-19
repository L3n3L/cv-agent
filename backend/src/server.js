import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfiguredResumeAgent } from './agent/configured-agent.js'
import { contextFields } from './core/context.js'
import { contentHash } from './core/content.js'
import { parseJsonBody, readJsonBody, requestRoute, sendJson } from './core/http.js'
import { createLogger } from './core/logger.js'
import { clientEventErrorCode, parseClientEvent } from './core/client-events.js'
import { emitWorkflowEvent, WORKFLOW_EVENTS } from './core/event-catalog.js'
import { assertSessionScope, createResumeSession, withSessionLock } from './core/session.js'
import { createSessionStore } from './core/session-store.js'
import { safeWorkflowSummary } from './core/workflow-summary.js'
import { createResumeToolHandlers, createResumeTools } from './agent/resume-tools.js'
import { measureSchema, presentationSchema, qualitySchema, templateCopySchema, templateSelectSchema, writeSchema } from './agent/schemas.js'
import { archiveResumeVersion, createResumeSource, ensureWorkspace, listResumeVersions, listWorkspacePreviews, readResumeDraft, readResumeVersion, readWorkspaceAsset, readWorkspaceText, renameResumeVersion, saveResumeVersion, writeResumeDraft } from './core/workspace.js'
import { createWorkspaceRegistry } from './core/workspace-registry.js'
import { confirmResumeTask, recordDraftWrite, saveResumeTask } from './core/workflow.js'
import { copyWorkspaceTemplate, getWorkspaceTemplateSnapshotIdentity, listWorkspaceTemplateVersions, listWorkspaceTemplates, loadWorkspaceTemplate, restoreWorkspaceTemplateVersion, saveWorkspaceTemplate } from './migrated/resume-engine/catalog.js'
import { renderResumeDraft } from './core/render.js'
import { generateTemplateCandidate } from './migrated/resume-engine/template-generation.js'
import { runAgentWithStreaming } from './agent/streaming.js'
import { AGENT_EXECUTION_MODES, classifyAgentExecutionMode, DEFAULT_AUTO_CONTINUATION_BUDGET, isProductionExecutionMode } from './agent/execution-policy.js'
import { resumeProductionSkillFiles } from './agent/resume-production-skill.js'

const port = Number(process.env.CVAGENT_PORT || 3180)
const logger = createLogger({ component: 'cvagent-server' })
const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')

async function serveStatic(request, response) {
  if (request.method !== 'GET') return false
  const pathname = request.url === '/' ? '/index.html' : request.url.split('?')[0]
  let relative
  try { relative = decodeURIComponent(pathname).replace(/^\/+/, '') } catch { return false }
  if (!relative || relative.split('/').includes('..')) return false
  const filePath = path.resolve(publicRoot, relative)
  if (path.relative(publicRoot, filePath).startsWith('..')) return false
  const content = await fs.readFile(filePath).catch(() => null)
  if (!content) return false
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
  response.writeHead(200, { 'content-type': types[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-store' })
  response.end(content)
  return true
}

function assistantText(result) {
  const messages = Array.isArray(result?.messages) ? result.messages : []
  const last = [...messages].reverse().find((message) => message?.role === 'assistant' || message?.type === 'ai' || message?.constructor?.name === 'AIMessage')
  if (typeof last?.content === 'string') return last.content
  if (Array.isArray(last?.content)) return last.content.filter((part) => part?.type === 'text').map((part) => part.text).join('')
  return ''
}

const TOOL_PHASES = Object.freeze({
  workspace_info: ['读取', '正在读取工作区信息。'],
  workspace_materials_list: ['读取材料', '正在读取可用材料，建立证据范围。'],
  workspace_material_read: ['读取材料', '正在读取与目标岗位相关的材料。'],
  resume_production_guide: ['准备', '正在读取简历生产契约。'],
  resume_prepare: ['准备', '正在准备本轮简历任务。'],
  resume_read: ['读取', '正在读取当前简历和已有内容。'],
  resume_check: ['检查', '正在检查结构、占位符和内容完整性。'],
  icon_list: ['检查', '正在确认可用图标，避免使用未注册 token。'],
  layout_validate: ['检查', '正在校验模板布局结构。'],
  template_list: ['模板', '正在读取当前工作区模板库。'],
  template_family_list: ['模板', '正在读取可用模板主题。'],
  template_select: ['模板', '正在应用明确选择的简历模板。'],
  template_copy: ['模板', '正在复制模板结构，保留原模板版本。'],
  template_generate: ['模板', '正在生成受约束的模板候选。'],
  template_save: ['模板', '正在保存已确认的工作区模板版本。'],
  template_versions: ['模板', '正在读取模板修订历史。'],
  template_restore: ['模板', '正在恢复指定模板修订。'],
  presentation_update: ['版式', '正在调整当前模板的版式参数。'],
  presentation_suggest: ['版式', '正在根据真实测量生成版式建议。'],
  template_autotune: ['版式', '正在执行一轮受约束的版式微调。'],
  resume_write: ['写入', '正在写入隔离草稿，源文件保持不变。'],
  resume_render: ['渲染', '正在用当前草稿和模板生成新的预览。'],
  resume_metrics: ['测量', '正在等待当前 render 的真实浏览器测量。'],
  resume_finalize: ['验收', '正在核对页数、占用率、溢出和版本身份。'],
  resume_save_version: ['保存', '正在保存用户确认的正式版本。'],
})

function safeProgressText(value, maxLength = 240) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength)
}

function workflowProgress(event = {}) {
  if (event.event === WORKFLOW_EVENTS.AGENT_RUN_STARTED) return { phase: '准备', reasoningSummary: '正在准备本轮任务。' }
  if (event.event === WORKFLOW_EVENTS.AGENT_RUN_FINISHED) return { phase: '完成', reasoningSummary: '本轮处理已完成，正在同步结果。' }
  const phase = TOOL_PHASES[String(event.toolName || '')]
  if (!phase) return {}
  if (event.event === WORKFLOW_EVENTS.TOOL_CALL_SUCCEEDED) return { phase: phase[0], reasoningSummary: `已完成${phase[0]}，正在整理下一步。` }
  if (event.event === WORKFLOW_EVENTS.TOOL_CALL_FAILED) return { phase: phase[0], reasoningSummary: `${phase[0]}步骤遇到阻断，需要检查失败原因。` }
  return { phase: phase[0], reasoningSummary: phase[1] }
}

function createWorkflowEventBroker() {
  const clients = new Map()
  return {
    subscribe(sessionId, response) {
      const key = String(sessionId)
      const current = clients.get(key) || new Set()
      current.add(response)
      clients.set(key, current)
      const cleanup = () => {
        clearInterval(heartbeat)
        current.delete(response)
        if (!current.size) clients.delete(key)
      }
      const heartbeat = setInterval(() => {
        if (response.writableEnded || response.destroyed) { cleanup(); return }
        try { response.write(': keep-alive\n\n') } catch { cleanup() }
      }, 15000)
      heartbeat.unref?.()
      response.once('close', cleanup)
      return cleanup
    },
    publish(sessionId, event) {
      const current = clients.get(String(sessionId))
      if (!current?.size) return
      const data = `event: workflow\ndata: ${JSON.stringify(event)}\n\n`
      for (const response of current) {
        try { response.write(data) } catch { response.destroy() }
      }
    },
  }
}

async function notifyWorkflowEvent(handler, payload) {
  try { await handler?.(payload) } catch { /* live event delivery is best effort */ }
}

async function publishWorkflowEvent(broker, session, event = {}, sessionStore = null) {
  if (!broker || !session?.sessionId || !event?.event) return
  const task = event.task || session.taskRef?.current || {}
  const resultSummary = safeWorkflowSummary(event.resultSummary)
  const progress = workflowProgress(event)
  const payload = {
    timestamp: new Date().toISOString(),
    event: event.event,
    sessionId: session.sessionId,
    ...contextFields(task.context),
    ...(event.toolName ? { toolName: event.toolName } : {}),
    ...(event.toolCallId ? { toolCallId: String(event.toolCallId) } : {}),
    ...(event.messageId ? { messageId: String(event.messageId) } : {}),
    ...(event.mode ? { mode: event.mode } : {}),
    ...(event.executionMode ? { executionMode: event.executionMode } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
    ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    ...(event.delta ? { delta: safeProgressText(event.delta, 2000) } : {}),
    ...(event.phase || progress.phase ? { phase: safeProgressText(event.phase || progress.phase, 48) } : {}),
    ...(event.reasoningSummary || progress.reasoningSummary ? { reasoningSummary: safeProgressText(event.reasoningSummary || progress.reasoningSummary) } : {}),
    ...(resultSummary ? { resultSummary } : {}),
  }
  // Text deltas are live transport data, not audit history. Persisting every
  // token would turn a long answer into hundreds of filesystem writes and
  // evict the tool/verification timeline that must remain after the session
  // ends. The final assistant message is persisted with the session snapshot.
  if (event.event !== WORKFLOW_EVENTS.ASSISTANT_DELTA) {
    session.workflowEvents = [...(Array.isArray(session.workflowEvents) ? session.workflowEvents : []), payload].slice(-240)
    await persistSession(sessionStore, session).catch(() => {})
  }
  broker.publish(session.sessionId, payload)
}

async function runAgentTurn(session, message, options = {}) {
  const taskRef = session.taskRef
  const task = taskRef.current
  const runLogger = options.serverLogger.child(contextFields(task.context))
  const mode = options.mode || 'user_message'
  const executionMode = options.executionMode || session.executionMode || AGENT_EXECUTION_MODES.CHAT
  session.runState = 'running'
  session.status = task.state
  session.lastError = null
  await persistSession(options.sessionStore, session, { event: WORKFLOW_EVENTS.AGENT_RUN_STARTED, state: session.status, mode, executionMode, ...contextFields(task.context) })
  await emitWorkflowEvent(runLogger, WORKFLOW_EVENTS.AGENT_RUN_STARTED, { ...task, sessionId: session.sessionId }, { state: session.status, mode, executionMode, resumePath: session.resumePath })
  await notifyWorkflowEvent(options.onWorkflowEvent, { event: WORKFLOW_EVENTS.AGENT_RUN_STARTED, task: { ...task, sessionId: session.sessionId }, mode, executionMode })
  const tools = createResumeTools({ sessionId: session.sessionId, workspaceRoot: session.workspaceRoot, resumePath: session.resumePath, sourceHash: session.sourceHash, taskRef, logger: runLogger, executionMode, onToolSuccess: sessionToolPersistence(options.sessionStore, session), onWorkflowEvent: options.onWorkflowEvent })
  const agent = await options.agentFactory({ tools, task, taskRef, executionMode })
  if (!agent || (typeof agent.invoke !== 'function' && typeof agent.streamEvents !== 'function')) throw Object.assign(new Error('agentFactory must return an invokable agent'), { code: 'AGENT_INVALID' })
  const input = { messages: [...(Array.isArray(session.messages) ? session.messages : []), { role: 'user', content: message }] }
  if (executionMode === AGENT_EXECUTION_MODES.PRODUCTION) input.files = await resumeProductionSkillFiles()
  const streamed = await runAgentWithStreaming(agent, input, {
    onAssistantStart: ({ messageId }) => notifyWorkflowEvent(options.onWorkflowEvent, { event: WORKFLOW_EVENTS.ASSISTANT_MESSAGE_STARTED, messageId, task: { ...task, sessionId: session.sessionId }, mode, executionMode }),
    onAssistantDelta: ({ messageId, delta }) => notifyWorkflowEvent(options.onWorkflowEvent, { event: WORKFLOW_EVENTS.ASSISTANT_DELTA, messageId, delta, task: { ...task, sessionId: session.sessionId }, mode, executionMode }),
    onAssistantFinish: ({ messageId }) => notifyWorkflowEvent(options.onWorkflowEvent, { event: WORKFLOW_EVENTS.ASSISTANT_MESSAGE_FINISHED, messageId, task: { ...task, sessionId: session.sessionId }, mode, executionMode }),
  })
  const result = streamed.result
  if (Array.isArray(result?.messages)) session.messages = result.messages
  const nextTask = taskRef.current
  session.runState = 'idle'
  session.status = nextTask.state
  session.lastError = null
  await persistSession(options.sessionStore, session, { event: WORKFLOW_EVENTS.AGENT_RUN_FINISHED, outcome: 'success', state: session.status, mode, executionMode, ...contextFields(nextTask.context) })
  await emitWorkflowEvent(runLogger, WORKFLOW_EVENTS.AGENT_RUN_FINISHED, { ...nextTask, sessionId: session.sessionId }, { outcome: 'success', state: nextTask.state, assistantChars: assistantText(result).length, mode, executionMode })
  await notifyWorkflowEvent(options.onWorkflowEvent, { event: WORKFLOW_EVENTS.AGENT_RUN_FINISHED, task: { ...nextTask, sessionId: session.sessionId }, outcome: 'success', mode, executionMode })
  return { result, task: nextTask }
}

async function loadSession(sessions, sessionStore, sessionId, serverLogger = null) {
  const safeId = String(sessionId || '').trim()
  if (!safeId) return null
  const cached = sessions.get(safeId)
  if (cached) return cached
  const restored = await sessionStore.load(safeId)
  if (restored) {
    sessions.set(safeId, restored)
    const interrupted = restored.lastError?.code === 'SESSION_INTERRUPTED'
    await emitWorkflowEvent(serverLogger, interrupted ? WORKFLOW_EVENTS.SESSION_INTERRUPTED : WORKFLOW_EVENTS.SESSION_RESTORED, { ...restored.taskRef.current, sessionId: restored.sessionId }, {
      state: restored.taskRef.current?.state || restored.status,
      runState: restored.runState,
      recovered: true,
    })
  }
  return restored
}

async function persistSession(sessionStore, session, event = null) {
  if (!session?.sessionId) return
  await sessionStore.save(session, event)
}

function sessionToolPersistence(sessionStore, session) {
  return async ({ toolName }) => {
    session.status = session.taskRef.current?.state || session.status || 'idle'
    await persistSession(sessionStore, session, { event: WORKFLOW_EVENTS.TOOL_CALL_SUCCEEDED, toolName, state: session.status, ...contextFields(session.taskRef.current?.context) })
  }
}

async function recordAgentRunFailure(session, error, options, mode = 'user_message') {
  if (!session) return
  const errorCode = String(error?.code || 'AGENT_RUN_FAILED')
  const errorMessage = String(error?.message || error)
  session.runState = 'failed'
  session.status = session.taskRef.current?.state || 'failed'
  session.lastError = { code: errorCode, message: errorMessage }
  if (errorCode === 'SOURCE_CHANGED') {
    await emitWorkflowEvent(options.serverLogger, WORKFLOW_EVENTS.SOURCE_CHANGED, { ...session.taskRef.current, sessionId: session.sessionId }, { errorCode, resumePath: session.resumePath }).catch(() => {})
  }
  await persistSession(options.sessionStore, session, { event: WORKFLOW_EVENTS.AGENT_RUN_FINISHED, outcome: 'failed', state: session.status, mode, errorCode, ...contextFields(session.taskRef.current?.context) }).catch(() => {})
  await emitWorkflowEvent(options.serverLogger, WORKFLOW_EVENTS.AGENT_RUN_FINISHED, { ...session.taskRef.current, sessionId: session.sessionId }, { outcome: 'failed', state: session.status, mode, errorCode }).catch(() => {})
  await publishWorkflowEvent(options.workflowEvents, session, {
    event: WORKFLOW_EVENTS.AGENT_RUN_FINISHED,
    task: { ...session.taskRef.current, sessionId: session.sessionId },
    outcome: 'failed',
    errorCode,
    mode,
  }, options.sessionStore).catch(() => {})
  await options.serverLogger.error('agent_run_failed', { ...contextFields(session.taskRef.current?.context), errorCode, errorMessage, mode }).catch(() => {})
}

function publicSessionSummary(sessionStore, session, includeMessages = false) {
  const value = sessionStore.summary(session, includeMessages)
  delete value.workspaceRoot
  delete value.sourceHash
  if (value.taskRef) {
    delete value.taskRef.renderAbsolutePath
    delete value.taskRef.draftRelativePath
  }
  return value
}

export function createServer(options = {}) {
  const serverLogger = options.logger || logger
  const agentFactory = options.agentFactory || ((agentOptions) => createConfiguredResumeAgent(agentOptions))
  const sessions = new Map()
  const sessionStore = options.sessionStore || createSessionStore({ directory: options.sessionDirectory })
  const workspaceRegistry = options.workspaceRegistry || createWorkspaceRegistry({ directory: options.workspaceDirectory })
  const workflowEvents = createWorkflowEventBroker()
  const server = http.createServer((request, response) => {
    const requestId = `req_${crypto.randomUUID()}`
    const route = requestRoute(request.url)
    const requestLogger = serverLogger.child({ requestId })
    const startedAt = Date.now()
    response.setHeader('x-cvagent-request-id', requestId)
    void requestLogger.info('http_request_started', { method: request.method, route })
    response.once('finish', () => { void requestLogger.info('http_request_finished', { method: request.method, route, statusCode: response.statusCode, durationMs: Date.now() - startedAt, ...(response.__cvagentErrorCode ? { errorCode: response.__cvagentErrorCode } : {}) }) })
    if (request.method === 'GET' && (request.url === '/' || request.url?.startsWith('/app.') || request.url?.startsWith('/styles.') || request.url?.startsWith('/workbench.css'))) {
      void serveStatic(request, response).then((served) => { if (!served) sendJson(response, 404, { error: 'not_found' }) })
      return
    }
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true, product: 'CVAgent' })
      return
    }
    if (request.method === 'POST' && request.url === '/api/client-events') {
      void handleClientEvent(request, response, { serverLogger: requestLogger })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/sessions')) {
      void handleSessions(request, response, { sessionStore, workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url === '/api/workspaces') {
      void handleWorkspaceList(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/workspace?')) {
      void handleWorkspaceDetail(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'POST' && request.url === '/api/workspaces/import') {
      void handleWorkspaceImport(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'POST' && request.url === '/api/workspaces/create') {
      void handleWorkspaceCreate(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/session?')) {
      void handleSession(request, response, { sessions, sessionStore, serverLogger: requestLogger, workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/templates/versions?')) {
      void handleTemplateVersions(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/templates')) {
      void handleTemplates(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/template?')) {
      void handleTemplate(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/template-preview?')) {
      void handleTemplatePreview(request, response, { sessions, sessionStore, serverLogger: requestLogger })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/asset?')) {
      void handleAsset(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'POST' && request.url === '/api/templates/generate') {
      void handleTemplateGenerate(request, response)
      return
    }
    if (request.method === 'POST' && (request.url === '/api/templates/copy' || request.url === '/api/templates/save' || request.url === '/api/templates/restore')) {
      void handleTemplateMutation(request, response, { action: request.url.split('/').at(-1), workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/source')) {
      void handleSource(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/previews')) {
      void handlePreviews(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'POST' && request.url === '/api/agent/bootstrap') {
      void handleAgentBootstrap(request, response, { serverLogger: requestLogger, sessions, sessionStore, workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/versions')) {
      void handleVersions(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/agent/events?')) {
      void handleAgentEvents(request, response, { sessions, sessionStore, serverLogger: requestLogger, workflowEvents })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/version?')) {
      void handleVersion(request, response, { workspaceRegistry })
      return
    }
    if (request.method === 'POST' && (request.url === '/api/versions/rename' || request.url === '/api/versions/archive')) {
      void handleVersionMutation(request, response, { action: request.url.split('/').at(-1), workspaceRegistry })
      return
    }
    if (request.method === 'POST' && new URL(request.url, 'http://127.0.0.1').pathname === '/api/agent/run') {
      void handleAgentRun(request, response, { serverLogger: requestLogger, agentFactory, sessions, sessionStore, workspaceRegistry, workflowEvents })
      return
    }
    if (request.method === 'POST' && request.url === '/api/agent/continue') {
      void handleAgentContinue(request, response, { serverLogger: requestLogger, agentFactory, sessions, sessionStore, workflowEvents })
      return
    }
    if (request.method === 'POST' && request.url === '/api/agent/measure') {
      void handleMeasurement(request, response, { serverLogger: requestLogger, agentFactory, sessions, sessionStore, workflowEvents })
      return
    }
    if (request.method === 'POST' && request.url === '/api/agent/save') {
      void handleSave(request, response, { serverLogger: requestLogger, sessions, sessionStore })
      return
    }
    if (request.method === 'POST' && (request.url === '/api/agent/template' || request.url === '/api/agent/template-copy' || request.url === '/api/agent/presentation' || request.url === '/api/agent/quality' || request.url === '/api/agent/draft' || request.url === '/api/agent/render')) {
      void handleDomainAction(request, response, { serverLogger: requestLogger, sessions, sessionStore, action: request.url.split('/').at(-1), workflowEvents })
      return
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/agent/preview')) {
      void handlePreview(request, response, { sessions, sessionStore, serverLogger: requestLogger })
      return
    }
    sendJson(response, 404, { error: 'not_found' })
  })
  server.flushLogs = async () => { await serverLogger.flush?.() }
  server.sessionStore = sessionStore
  server.sessions = sessions
  server.workspaceRegistry = workspaceRegistry
  server.workflowEvents = workflowEvents
  return server
}

async function handleClientEvent(request, response, options) {
  try {
    const event = parseClientEvent(await readJsonBody(request, 32 * 1024))
    await options.serverLogger.warn('client_event_received', event)
    sendJson(response, 202, { ok: true, accepted: true })
  } catch (error) {
    const errorCode = clientEventErrorCode(error)
    sendJson(response, 400, { ok: false, errorCode, errorMessage: 'client event was rejected' })
  }
}

async function resolveWorkspaceInput(input, workspaceRegistry) {
  const workspaceId = String(input?.workspaceId || '').trim()
  if (workspaceId) {
    const record = await workspaceRegistry.resolve(workspaceId)
    return { ...record, resumePath: record.resumePath }
  }
  const workspaceRoot = String(input?.workspaceRoot || '').trim()
  if (!workspaceRoot) throw Object.assign(new Error('workspaceId is required'), { code: 'WORKSPACE_REQUIRED' })
  const workspace = await ensureWorkspace(workspaceRoot, input?.workspaceName)
  return { ...workspace, resumePath: String(input?.resumePath || 'resume.md').trim() }
}

async function handleWorkspaceList(request, response, options) {
  try {
    sendJson(response, 200, { ok: true, workspaces: await options.workspaceRegistry.list() })
  } catch (error) {
    sendJson(response, 500, { ok: false, errorCode: String(error?.code || 'WORKSPACE_LIST_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleWorkspaceDetail(request, response, options) {
  try {
    const workspaceId = new URL(request.url, 'http://127.0.0.1').searchParams.get('workspaceId') || ''
    sendJson(response, 200, { ok: true, workspace: await options.workspaceRegistry.metadata(workspaceId) })
  } catch (error) {
    const code = String(error?.code || 'WORKSPACE_READ_FAILED')
    sendJson(response, 400, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handleWorkspaceImport(request, response, options) {
  try {
    const body = await readJsonBody(request, 48 * 1024 * 1024)
    const workspace = await options.workspaceRegistry.importFiles({ name: body.name, files: body.files })
    sendJson(response, 201, { ok: true, workspace: options.workspaceRegistry.publicWorkspace(workspace) })
  } catch (error) {
    const code = String(error?.code || 'WORKSPACE_IMPORT_FAILED')
    const clientErrorCodes = new Set(['INVALID_JSON', 'REQUEST_TOO_LARGE', 'WORKSPACE_INVALID', 'WORKSPACE_FILES_REQUIRED', 'WORKSPACE_TOO_MANY_FILES', 'WORKSPACE_IMPORT_TOO_LARGE', 'WORKSPACE_FILE_UNSUPPORTED', 'WORKSPACE_FILE_INVALID', 'WORKSPACE_FILE_TOO_LARGE', 'WORKSPACE_RESUME_NOT_FOUND'])
    sendJson(response, clientErrorCodes.has(code) ? 400 : 500, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handleWorkspaceCreate(request, response, options) {
  try {
    const body = await readJsonBody(request, 16 * 1024)
    const workspace = await options.workspaceRegistry.createEmpty({ name: body.name })
    sendJson(response, 201, { ok: true, workspace: options.workspaceRegistry.publicWorkspace(workspace) })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'WORKSPACE_CREATE_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleSessions(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = query.searchParams.get('workspaceId')
      ? await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId') }, options.workspaceRegistry)
      : null
    const sessions = await options.sessionStore.list({
      workspaceRoot: workspace?.root || query.searchParams.get('workspaceRoot') || '',
      resumePath: workspace?.resumePath || query.searchParams.get('resumePath') || '',
    })
    sendJson(response, 200, { ok: true, sessions: sessions.map((session) => publicSessionSummary(options.sessionStore, session, false)) })
  } catch (error) {
    sendJson(response, 500, { ok: false, errorCode: String(error?.code || 'SESSIONS_LIST_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleSession(request, response, options) {
  try {
    const sessionId = new URL(request.url, 'http://127.0.0.1').searchParams.get('sessionId') || ''
    const session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    if (!session) throw Object.assign(new Error('session was not found'), { code: 'SESSION_NOT_FOUND' })
    const source = await readWorkspaceText(session.workspaceRoot, session.resumePath)
    const draft = session.taskRef.current?.context?.contentVersion && session.taskRef.draftRelativePath
      ? await readResumeDraft(session.workspaceRoot, session.taskRef.current.context.taskId, session.resumePath).catch(() => null)
      : null
    const sessionSummary = publicSessionSummary(options.sessionStore, session, true)
    const workspace = await options.workspaceRegistry.metadata(session.workspaceId).catch(() => ({ id: session.workspaceId, name: path.basename(session.workspaceRoot), resumeName: path.basename(session.resumePath) }))
    sendJson(response, 200, { ok: true, session: sessionSummary, workspace, state: session.taskRef.current?.state || session.status, context: contextFields(session.taskRef.current?.context), presentation: session.taskRef.presentation || null, source: { path: source.relativePath, content: source.content }, draft: draft ? { path: draft.draftRelativePath, content: draft.content } : null })
  } catch (error) {
    const code = String(error?.code || 'SESSION_READ_FAILED')
    sendJson(response, code === 'SESSION_NOT_FOUND' ? 404 : 500, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handlePreviews(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId'), workspaceRoot: query.searchParams.get('workspaceRoot') }, options.workspaceRegistry)
    const result = await listWorkspacePreviews(workspace.root)
    sendJson(response, 200, { ok: true, previews: result.previews, truncated: result.truncated })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'PREVIEWS_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleAgentEvents(request, response, options) {
  try {
    const sessionId = new URL(request.url, 'http://127.0.0.1').searchParams.get('sessionId') || ''
    const session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    if (!session) throw Object.assign(new Error('session was not found'), { code: 'SESSION_NOT_FOUND' })
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.write(`event: ready\ndata: ${JSON.stringify({ sessionId, state: session.taskRef.current?.state || session.status })}\n\n`)
    options.workflowEvents.subscribe(sessionId, response)
  } catch (error) {
    const code = String(error?.code || 'AGENT_EVENTS_FAILED')
    sendJson(response, code === 'SESSION_NOT_FOUND' ? 404 : 400, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handleTemplates(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId'), workspaceRoot: query.searchParams.get('workspaceRoot') }, options.workspaceRegistry)
    const templates = await listWorkspaceTemplates(workspace.root)
    sendJson(response, 200, { ok: true, workspaceId: workspace.id, templates })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'TEMPLATE_LIST_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleTemplateVersions(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId'), workspaceRoot: query.searchParams.get('workspaceRoot') }, options.workspaceRegistry)
    const templateId = String(query.searchParams.get('templateId') || '').trim()
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(templateId)) throw Object.assign(new Error('templateId must be lower-kebab-case'), { code: 'TEMPLATE_INVALID' })
    const versions = await listWorkspaceTemplateVersions(workspace.root, templateId)
    sendJson(response, 200, { ok: true, workspaceId: workspace.id, templateId, versions })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'TEMPLATE_VERSIONS_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleTemplateGenerate(request, response) {
  try {
    const body = await readJsonBody(request, 192 * 1024)
    const candidate = generateTemplateCandidate(body.brief)
    sendJson(response, candidate.valid ? 200 : 400, { ok: candidate.valid, candidate, persisted: false })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'TEMPLATE_GENERATE_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleTemplate(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId'), workspaceRoot: query.searchParams.get('workspaceRoot') }, options.workspaceRegistry)
    const id = query.searchParams.get('id') || ''
    const template = await loadWorkspaceTemplate(workspace.root, id)
    sendJson(response, 200, { ok: true, workspaceId: workspace.id, template })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'TEMPLATE_READ_FAILED'), errorMessage: String(error?.message || error) })
  }
}

/**
 * Render a read-only gallery thumbnail from the current isolated draft.
 * It intentionally does not mutate task context: choosing a template remains
 * an explicit session action, while the gallery can show the real renderer.
 */
async function handleTemplatePreview(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1').searchParams
    const sessionId = String(query.get('sessionId') || '').trim()
    const templateId = String(query.get('templateId') || '').trim()
    const session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    if (!session) throw Object.assign(new Error('session was not found'), { code: 'SESSION_NOT_FOUND' })
    const current = session.taskRef.current
    const contentVersion = current?.context?.contentVersion || session.sourceHash
    let draft = null
    if (current?.context?.contentVersion && session.taskRef.draftRelativePath) {
      draft = await readResumeDraft(session.workspaceRoot, current.context.taskId, session.resumePath).catch(() => null)
    }
    const source = draft || await readWorkspaceText(session.workspaceRoot, session.resumePath)
    if (!contentVersion || !source?.content) throw Object.assign(new Error('current resume draft was not found'), { code: 'DRAFT_NOT_FOUND' })
    const template = await loadWorkspaceTemplate(session.workspaceRoot, templateId)
    if (!template?.id) throw Object.assign(new Error(`template is not available in CVAgent: ${templateId}`), { code: 'TEMPLATE_NOT_FOUND' })
    const renderId = `thumb_${crypto.randomUUID()}`
    const rendered = await renderResumeDraft({
      renderId,
      workspaceRoot: session.workspaceRoot,
      resumePath: session.resumePath,
      taskId: current?.context?.taskId || `template_${sessionId}`,
      contentVersion,
      content: source.content,
      templateId: template.id,
      templateRevision: `${template.id}@${Number(template.metadata?.revision || 1)}`,
    })
    const html = await fs.readFile(rendered.absolutePath, 'utf8')
    await options.serverLogger.info('template_preview_rendered', {
      sessionId,
      templateId: template.id,
      renderId,
      bytes: rendered.bytes,
    })
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'unsafe-inline'" })
    response.end(html)
  } catch (error) {
    const code = String(error?.code || 'TEMPLATE_PREVIEW_FAILED')
    const status = new Set(['SESSION_NOT_FOUND', 'DRAFT_NOT_FOUND', 'TEMPLATE_NOT_FOUND']).has(code) ? 404 : 400
    sendJson(response, status, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handleAsset(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId'), workspaceRoot: query.searchParams.get('workspaceRoot') || query.searchParams.get('root') }, options.workspaceRegistry)
    const asset = await readWorkspaceAsset(workspace.root, query.searchParams.get('path') || '')
    response.writeHead(200, { 'content-type': asset.contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    response.end(asset.content)
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'ASSET_READ_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleTemplateMutation(request, response, options) {
  try {
    const body = await readJsonBody(request, 192 * 1024)
    const workspace = await resolveWorkspaceInput(body, options.workspaceRegistry)
    let result
    if (options.action === 'copy') {
      result = await copyWorkspaceTemplate(workspace.root, body.sourceTemplateId, body.newTemplateId, body.name)
    } else if (options.action === 'restore') {
      if (body.confirmedByUser !== true) throw Object.assign(new Error('template restore requires explicit user confirmation'), { code: 'TEMPLATE_CONFIRMATION_REQUIRED' })
      result = await restoreWorkspaceTemplateVersion(workspace.root, body.templateId, body.versionId)
    } else {
      const template = typeof body.templateJson === 'string' ? JSON.parse(body.templateJson) : body.templateJson
      if (body.confirmedByUser !== true) throw Object.assign(new Error('template save requires explicit user confirmation'), { code: 'TEMPLATE_CONFIRMATION_REQUIRED' })
      result = await saveWorkspaceTemplate(workspace.root, template, { replaceExisting: Boolean(body.replaceExisting), sourceTemplateId: body.sourceTemplateId })
    }
    sendJson(response, 200, { ok: true, workspaceId: workspace.id, result })
  } catch (error) {
    const code = String(error?.code || 'TEMPLATE_MUTATION_FAILED')
    sendJson(response, ['TEMPLATE_CONFLICT', 'TEMPLATE_NOT_FOUND', 'TEMPLATE_INVALID', 'TEMPLATE_CONFIRMATION_REQUIRED', 'WORKSPACE_INVALID'].includes(code) ? 400 : 500, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handleSource(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId'), workspaceRoot: query.searchParams.get('workspaceRoot'), resumePath: query.searchParams.get('resumePath') }, options.workspaceRegistry)
    const file = await readWorkspaceText(workspace.root, workspace.resumePath)
    sendJson(response, 200, { ok: true, path: file.relativePath, content: file.content })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'SOURCE_READ_FAILED'), errorMessage: String(error?.message || error) })
  }
}

/**
 * Prepare a local resume session without invoking a model.  The workbench
 * must be usable after a user reads a source file; waiting for an Agent run
 * here made the Markdown pane look loaded while leaving the A4 preview and
 * all persistence actions inert.
 */
async function handleAgentBootstrap(request, response, options) {
  let session = null
  try {
    const body = await readJsonBody(request, 64 * 1024)
    const workspaceInput = await resolveWorkspaceInput(body, options.workspaceRegistry)
    let resumePath = workspaceInput.resumePath || 'resume.md'
    const templateId = String(body.templateId || 'campus-standard').trim()
    const workspace = workspaceInput
    let source
    let initializedFromEmptyWorkspace = false
    try {
      source = await readWorkspaceText(workspace.root, resumePath)
    } catch (error) {
      if (error?.code !== 'WORKSPACE_FILE_NOT_FOUND' || body.createResume !== true) throw error
      source = await createResumeSource(workspace.root, resumePath)
      initializedFromEmptyWorkspace = true
      const registered = await options.workspaceRegistry.setResumePath(workspace.id, resumePath)
      Object.assign(workspace, registered)
      resumePath = registered.resumePath
    }
    const template = await loadWorkspaceTemplate(workspace.root, templateId)
    if (!template?.id) throw Object.assign(new Error(`template is not available in CVAgent: ${templateId}`), { code: 'TEMPLATE_NOT_FOUND' })
    const sessionId = `session_${crypto.randomUUID()}`
    const templateRevision = `${template.id}@${Number(template.metadata?.revision || 1)}`
    session = createResumeSession({ workspace, resumePath, templateId: template.id, templateRevision, targetPages: body.targetPages, intakeRequired: initializedFromEmptyWorkspace, sessionId, sourceHash: contentHash(source.content) })
    options.sessions.set(sessionId, session)
    const task = session.taskRef.current
    const runLogger = options.serverLogger.child(contextFields(task.context))
    const draft = await writeResumeDraft(workspace.root, task.context.taskId, resumePath, source.content)
    session.taskRef.current = recordDraftWrite(session.taskRef.current, { workspaceId: workspace.id, resumeId: resumePath, contentVersion: draft.contentVersion, intakeComplete: !initializedFromEmptyWorkspace })
    session.taskRef.draftRelativePath = draft.draftRelativePath
    const handlers = createResumeToolHandlers({ sessionId: session.sessionId, workspaceRoot: workspace.root, resumePath, sourceHash: session.sourceHash, taskRef: session.taskRef, logger: runLogger, onToolSuccess: sessionToolPersistence(options.sessionStore, session), onWorkflowEvent: (event) => publishWorkflowEvent(options.workflowEvents, session, event, options.sessionStore) })
    const rendered = await handlers.resumeRender()
    await runLogger.info('session_bootstrapped', { workspaceRoot: workspace.root, resumePath, templateId: template.id, renderId: rendered.renderId })
    const current = session.taskRef.current
    const sessionSummary = options.sessionStore.summary(session, true)
    sendJson(response, 200, { ok: true, sessionId, workspace: options.workspaceRegistry.publicWorkspace(workspace), state: current.state, targetPages: current.targetPages, context: contextFields(current.context), presentation: session.taskRef.presentation || null, draft: { contentVersion: draft.contentVersion }, renderPath: session.taskRef.renderRelativePath || rendered.relativePath || null, source: { path: source.relativePath, content: source.content }, messages: sessionSummary.messages, workflowEvents: sessionSummary.workflowEvents })
  } catch (error) {
    const details = { errorCode: String(error?.code || 'AGENT_BOOTSTRAP_FAILED'), errorMessage: String(error?.message || error) }
    const clientErrorCodes = new Set(['INVALID_JSON', 'REQUEST_TOO_LARGE', 'WORKSPACE_REQUIRED', 'WORKSPACE_INVALID', 'WORKSPACE_MANIFEST_INVALID', 'WORKSPACE_FILE_INVALID', 'WORKSPACE_FILE_NOT_FOUND', 'WORKSPACE_FILE_TOO_LARGE', 'WORKSPACE_RESUME_INVALID', 'WORKSPACE_RESUME_EXISTS', 'WORKSPACE_RESUME_NOT_FOUND', 'DRAFT_EMPTY', 'DRAFT_TOO_LARGE', 'TEMPLATE_NOT_FOUND'])
    sendJson(response, clientErrorCodes.has(error?.code) ? 400 : 500, { ok: false, ...details })
  }
}

async function handleVersions(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId'), workspaceRoot: query.searchParams.get('workspaceRoot') }, options.workspaceRegistry)
    const includeArchived = query.searchParams.get('includeArchived') === 'true'
    const allVersions = await listResumeVersions(workspace.root)
    const versions = includeArchived ? allVersions : allVersions.filter((version) => !version.archived)
    sendJson(response, 200, { ok: true, workspaceId: workspace.id, versions })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'VERSION_LIST_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleVersion(request, response, options) {
  try {
    const query = new URL(request.url, 'http://127.0.0.1')
    const workspace = await resolveWorkspaceInput({ workspaceId: query.searchParams.get('workspaceId'), workspaceRoot: query.searchParams.get('workspaceRoot') }, options.workspaceRegistry)
    const version = await readResumeVersion(workspace.root, query.searchParams.get('versionId') || '')
    sendJson(response, 200, { ok: true, workspaceId: workspace.id, version })
  } catch (error) {
    sendJson(response, 400, { ok: false, errorCode: String(error?.code || 'VERSION_READ_FAILED'), errorMessage: String(error?.message || error) })
  }
}

async function handleVersionMutation(request, response, options) {
  try {
    const body = await readJsonBody(request, 32 * 1024)
    const workspace = await resolveWorkspaceInput(body, options.workspaceRegistry)
    let version
    if (options.action === 'rename') version = await renameResumeVersion(workspace.root, body.versionId, body.name)
    else version = await archiveResumeVersion(workspace.root, body.versionId)
    sendJson(response, 200, { ok: true, workspaceId: workspace.id, version })
  } catch (error) {
    const code = String(error?.code || 'VERSION_MUTATION_FAILED')
    sendJson(response, ['VERSION_INVALID', 'VERSION_NOT_FOUND', 'VERSION_NAME_INVALID', 'WORKSPACE_INVALID'].includes(code) ? 400 : 500, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handleDomainAction(request, response, options) {
  let session = null
  try {
    const body = await readJsonBody(request, 128 * 1024)
    const sessionId = String(body.sessionId || '').trim()
    session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    if (!session) throw Object.assign(new Error('session was not found'), { code: 'SESSION_NOT_FOUND' })
    return await withSessionLock(session, async () => {
      const runLogger = options.serverLogger.child(contextFields(session.taskRef.current.context))
      const handlers = createResumeToolHandlers({ sessionId: session.sessionId, workspaceRoot: session.workspaceRoot, resumePath: session.resumePath, sourceHash: session.sourceHash, taskRef: session.taskRef, logger: runLogger, onToolSuccess: sessionToolPersistence(options.sessionStore, session), onWorkflowEvent: (event) => publishWorkflowEvent(options.workflowEvents, session, event, options.sessionStore) })
      const input = options.action === 'template'
        ? parseJsonBody(templateSelectSchema, body, 'DOMAIN_INPUT_INVALID')
        : options.action === 'template-copy'
          ? parseJsonBody(templateCopySchema, body, 'DOMAIN_INPUT_INVALID')
          : options.action === 'presentation'
            ? parseJsonBody(presentationSchema, body, 'DOMAIN_INPUT_INVALID')
            : options.action === 'quality'
              ? parseJsonBody(qualitySchema, body, 'DOMAIN_INPUT_INVALID')
              : options.action === 'draft'
                ? parseJsonBody(writeSchema, body, 'DOMAIN_INPUT_INVALID')
                : {}
      let result
      if (options.action === 'template') result = await handlers.templateSelect(input)
      else if (options.action === 'template-copy') result = await handlers.templateCopy(input)
      else if (options.action === 'presentation') result = await handlers.presentationUpdate(input)
      else if (options.action === 'quality') result = await handlers.resumeQuality(input)
      else if (options.action === 'draft') result = await handlers.resumeDraftWrite(input)
      else result = await handlers.resumeRender()
      sendJson(response, 200, { ok: true, sessionId, result, state: session.taskRef.current.state, context: contextFields(session.taskRef.current.context) })
    })
  } catch (error) {
    const code = String(error?.code || 'DOMAIN_ACTION_FAILED')
    sendJson(response, ['SESSION_NOT_FOUND', 'DOMAIN_INPUT_INVALID'].includes(code) ? 400 : 500, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handleMeasurement(request, response, options) {
  let session = null
  try {
    const body = await readJsonBody(request, 64 * 1024)
    const input = parseJsonBody(measureSchema, body, 'MEASUREMENT_INVALID')
    const sessionId = String(body.sessionId || '').trim()
    session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    if (!session) throw Object.assign(new Error('session was not found'), { code: 'SESSION_NOT_FOUND' })
    const result = await withSessionLock(session, async () => {
      if (String(input.renderId) !== String(session.taskRef.current.context.renderId || '')) throw Object.assign(new Error('measurement renderId is stale'), { code: 'MEASUREMENT_STALE' })
      const runLogger = options.serverLogger.child(contextFields(session.taskRef.current.context))
      const handlers = createResumeToolHandlers({ sessionId: session.sessionId, workspaceRoot: session.workspaceRoot, resumePath: session.resumePath, sourceHash: session.sourceHash, taskRef: session.taskRef, logger: runLogger, onToolSuccess: sessionToolPersistence(options.sessionStore, session), onWorkflowEvent: (event) => publishWorkflowEvent(options.workflowEvents, session, event, options.sessionStore) })
      const measurement = await handlers.resumeMeasure(input)
      const verification = await handlers.resumeVerify()
      return { measurement, verification, state: session.taskRef.current.state, context: contextFields(session.taskRef.current.context) }
    })
    const autoContinuation = scheduleMeasurementContinuation(session, input.renderId, result.verification, options)
    sendJson(response, 200, { ok: true, sessionId, ...result, autoContinuation })
  } catch (error) {
    const details = { errorCode: String(error?.code || 'MEASUREMENT_FAILED'), errorMessage: String(error?.message || error) }
    const clientErrorCodes = new Set(['INVALID_JSON', 'REQUEST_TOO_LARGE', 'MEASUREMENT_INVALID', 'SESSION_NOT_FOUND', 'MEASUREMENT_STALE', 'TOOL_FAILED'])
    sendJson(response, clientErrorCodes.has(error?.code) ? 400 : 500, { ok: false, ...details })
  }
}

async function handleAgentContinue(request, response, options) {
  let session = null
  let task = null
  try {
    const body = await readJsonBody(request, 64 * 1024)
    const sessionId = String(body.sessionId || '').trim()
    const renderId = String(body.renderId || '').trim()
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw Object.assign(new Error('sessionId is invalid'), { code: 'SESSION_INVALID' })
    if (!renderId) throw Object.assign(new Error('renderId is required'), { code: 'CONTINUATION_RENDER_REQUIRED' })
    session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    if (!session) throw Object.assign(new Error('session was not found'), { code: 'SESSION_NOT_FOUND' })
    return await withSessionLock(session, async () => {
      task = session.taskRef.current
      if (String(task.context.renderId || '') !== renderId) throw Object.assign(new Error('continuation renderId is stale'), { code: 'MEASUREMENT_STALE' })
      if (task.state === 'accepted' || task.state === 'saved') {
        sendJson(response, 200, { ok: true, continued: false, sessionId, assistantText: '', state: task.state, context: contextFields(task.context), blockers: task.blockers })
        return
      }
      if (task.state !== 'needs_revision') throw Object.assign(new Error(`agent continuation requires needs_revision, received ${task.state}`), { code: 'CONTINUATION_NOT_ALLOWED' })
      const blockers = task.blockers.length ? `\n当前阻断项：\n- ${task.blockers.join('\n- ')}` : ''
      const message = String(body.message || `真实浏览器已经完成 renderId=${renderId} 的 A4 测量。请根据最终验收结果继续修订当前简历，重新检查、渲染，并等待下一次真实测量。${blockers}`).trim()
      session.executionMode = AGENT_EXECUTION_MODES.PRODUCTION
      const turn = await runAgentTurn(session, message, { agentFactory: options.agentFactory, serverLogger: options.serverLogger, sessionStore: options.sessionStore, executionMode: AGENT_EXECUTION_MODES.PRODUCTION, mode: 'measurement_continuation', onWorkflowEvent: (event) => publishWorkflowEvent(options.workflowEvents, session, event, options.sessionStore) })
      task = turn.task
      sendJson(response, 200, { ok: true, continued: true, sessionId, assistantText: assistantText(turn.result), state: task.state, context: contextFields(task.context), draft: task.artifacts.contentVersion ? { contentVersion: task.artifacts.contentVersion } : null, renderPath: session.taskRef.renderRelativePath || null })
    })
  } catch (error) {
    const details = { errorCode: String(error?.code || 'AGENT_CONTINUE_FAILED'), errorMessage: String(error?.message || error) }
    if (session) {
      session.runState = 'failed'
      session.status = session.taskRef.current?.state || 'failed'
      session.lastError = { code: details.errorCode, message: details.errorMessage }
      await persistSession(options.sessionStore, session, { event: WORKFLOW_EVENTS.AGENT_RUN_FINISHED, outcome: 'failed', state: session.status, mode: 'measurement_continuation', errorCode: details.errorCode, ...contextFields(session.taskRef.current?.context) }).catch(() => {})
      await emitWorkflowEvent(options.serverLogger, WORKFLOW_EVENTS.AGENT_RUN_FINISHED, { ...session.taskRef.current, sessionId: session.sessionId }, { outcome: 'failed', state: session.status, mode: 'measurement_continuation', errorCode: details.errorCode }).catch(() => {})
    }
    await options.serverLogger.error('agent_continuation_failed', { ...(task ? contextFields(task.context) : {}), ...details })
    const clientErrorCodes = new Set(['INVALID_JSON', 'REQUEST_TOO_LARGE', 'SESSION_INVALID', 'CONTINUATION_RENDER_REQUIRED', 'SESSION_NOT_FOUND', 'MEASUREMENT_STALE', 'CONTINUATION_NOT_ALLOWED', 'SOURCE_CHANGED'])
    sendJson(response, clientErrorCodes.has(error?.code) ? 400 : 500, { ok: false, ...details })
  }
}

async function handleAgentRun(request, response, options) {
  let task = null
  let session = null
  try {
    const body = await readJsonBody(request)
    const message = String(body.message || '').trim()
    const workspaceInput = await resolveWorkspaceInput(body, options.workspaceRegistry)
    const resumePath = workspaceInput.resumePath
    if (!message) throw Object.assign(new Error('message is required'), { code: 'MESSAGE_REQUIRED' })
    const workspace = workspaceInput
    const source = await readWorkspaceText(workspace.root, resumePath)
    const sourceHash = contentHash(source.content)
    const sessionId = String(body.sessionId || `session_${crypto.randomUUID()}`).trim()
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw Object.assign(new Error('sessionId is invalid'), { code: 'SESSION_INVALID' })
    session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    assertSessionScope(session, workspace, resumePath)
    if (session?.sourceHash && session.sourceHash !== sourceHash) throw Object.assign(new Error('source resume changed outside this session; prepare a new session before continuing'), { code: 'SOURCE_CHANGED' })
    if (!session) {
      const templateId = String(body.templateId || 'campus-standard').trim()
      const template = await loadWorkspaceTemplate(workspace.root, templateId)
      if (!template?.id) throw Object.assign(new Error(`template is not available in CVAgent: ${templateId}`), { code: 'TEMPLATE_NOT_FOUND' })
      const templateRevision = `${template.id}@${Number(template.metadata?.revision || 1)}`
      session = createResumeSession({ workspace, resumePath, templateId: template.id, templateRevision, targetPages: body.targetPages, sessionId, sourceHash })
      options.sessions.set(sessionId, session)
    }
    const executionMode = classifyAgentExecutionMode(message)
    session.executionMode = executionMode
    if (isProductionExecutionMode(executionMode)) {
      session.automation = { continuationCount: 0, continuationBudget: session.automation?.continuationBudget || DEFAULT_AUTO_CONTINUATION_BUDGET, lastContinuationRenderId: null }
    }
    await persistSession(options.sessionStore, session)
    const execute = () => withSessionLock(session, async () => {
      const turn = await runAgentTurn(session, message, { agentFactory: options.agentFactory, serverLogger: options.serverLogger, sessionStore: options.sessionStore, executionMode, mode: 'user_message', onWorkflowEvent: (event) => publishWorkflowEvent(options.workflowEvents, session, event, options.sessionStore) })
      task = turn.task
      return { sessionId, executionMode, assistantText: assistantText(turn.result), state: task.state, context: contextFields(task.context), draft: task.artifacts.contentVersion ? { contentVersion: task.artifacts.contentVersion } : null, renderPath: session.taskRef.renderRelativePath || null }
    })
    const streamRequested = new URL(request.url, 'http://127.0.0.1').searchParams.get('stream') === '1'
    if (streamRequested) {
      sendJson(response, 202, { ok: true, accepted: true, sessionId, executionMode, state: session.taskRef.current?.state || session.status, runState: 'running' })
      void execute().catch((error) => recordAgentRunFailure(session, error, options).catch(() => {}))
      return
    }
    const result = await execute()
    sendJson(response, 200, { ok: true, ...result })
  } catch (error) {
    const details = { errorCode: String(error?.code || 'AGENT_RUN_FAILED'), errorMessage: String(error?.message || error) }
    if (session) {
      await recordAgentRunFailure(session, error, options)
    } else {
      await options.serverLogger.error('agent_run_failed', { ...(task ? contextFields(task.context) : {}), ...details })
    }
    const clientErrorCodes = new Set(['INVALID_JSON', 'REQUEST_TOO_LARGE', 'MESSAGE_REQUIRED', 'WORKSPACE_REQUIRED', 'WORKSPACE_INVALID', 'WORKSPACE_MANIFEST_INVALID', 'WORKSPACE_FILE_INVALID', 'WORKSPACE_FILE_NOT_FOUND', 'WORKSPACE_FILE_TOO_LARGE', 'WORKSPACE_RESUME_NOT_FOUND', 'DRAFT_EMPTY', 'DRAFT_TOO_LARGE', 'SESSION_INVALID', 'SESSION_SCOPE_MISMATCH', 'SOURCE_CHANGED'])
    sendJson(response, clientErrorCodes.has(error?.code) ? 400 : 500, { ok: false, ...details })
  }
}

function scheduleMeasurementContinuation(session, renderId, verification, options) {
  const task = session?.taskRef?.current
  const automation = session.automation || (session.automation = { continuationCount: 0, continuationBudget: DEFAULT_AUTO_CONTINUATION_BUDGET, lastContinuationRenderId: null })
  const budget = Math.max(0, Number(automation.continuationBudget) || DEFAULT_AUTO_CONTINUATION_BUDGET)
  if (!isProductionExecutionMode(session.executionMode) || verification?.state !== 'needs_revision' || verification?.blockers?.includes('尚未完成首次信息收集')) return { scheduled: false, budget, round: automation.continuationCount }
  if (automation.lastContinuationRenderId === renderId) return { scheduled: false, duplicate: true, budget, round: automation.continuationCount }
  if (automation.continuationCount >= budget) return { scheduled: false, exhausted: true, budget, round: automation.continuationCount }
  automation.continuationCount += 1
  automation.lastContinuationRenderId = String(renderId)
  const round = automation.continuationCount
  void persistSession(options.sessionStore, session, { event: WORKFLOW_EVENTS.AGENT_RUN_STARTED, mode: 'measurement_continuation_scheduled', executionMode: session.executionMode, continuationRound: round, continuationBudget: budget, state: task?.state, ...contextFields(task?.context) }).catch(() => {})
  setTimeout(() => {
    void withSessionLock(session, async () => {
      const current = session.taskRef.current
      if (current.state !== 'needs_revision' || String(current.context.renderId || '') !== String(renderId)) return
      const blockers = current.blockers.length ? `\n当前阻断项：\n- ${current.blockers.join('\n- ')}` : ''
      const message = `真实浏览器已经完成 renderId=${renderId} 的 A4 测量。请根据当前验收结果继续修订，不要询问用户确认；重新检查、渲染，并等待下一次真实测量。${blockers}`
      await runAgentTurn(session, message, { agentFactory: options.agentFactory, serverLogger: options.serverLogger, sessionStore: options.sessionStore, executionMode: AGENT_EXECUTION_MODES.PRODUCTION, mode: 'measurement_continuation', onWorkflowEvent: (event) => publishWorkflowEvent(options.workflowEvents, session, event, options.sessionStore) })
    }).catch((error) => recordAgentRunFailure(session, error, { ...options, workflowEvents: options.workflowEvents }, 'measurement_continuation').catch(() => {}))
  }, 0)
  return { scheduled: true, budget, round }
}

async function handlePreview(request, response, options) {
  try {
    const sessionId = new URL(request.url, 'http://127.0.0.1').searchParams.get('sessionId') || ''
    const session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    if (!session?.taskRef.renderAbsolutePath) throw Object.assign(new Error('current render was not found'), { code: 'RENDER_NOT_FOUND' })
    const html = await fs.readFile(session.taskRef.renderAbsolutePath, 'utf8')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" })
    response.end(html)
  } catch (error) {
    const code = String(error?.code || 'RENDER_NOT_FOUND')
    sendJson(response, 404, { ok: false, errorCode: code, errorMessage: String(error?.message || error) })
  }
}

async function handleSave(request, response, options) {
  let session = null
  try {
    const body = await readJsonBody(request, 32 * 1024)
    const sessionId = String(body.sessionId || '').trim()
    session = await loadSession(options.sessions, options.sessionStore, sessionId, options.serverLogger)
    if (!session) throw Object.assign(new Error('session was not found'), { code: 'SESSION_NOT_FOUND' })
    return await withSessionLock(session, async () => {
      if (body.confirm !== true) throw Object.assign(new Error('explicit user confirmation is required'), { code: 'SAVE_CONFIRMATION_REQUIRED' })
      const task = session.taskRef.current
      if (task.state !== 'accepted') throw Object.assign(new Error('resume verification has not passed'), { code: 'SAVE_NOT_ALLOWED' })
      const runLogger = options.serverLogger.child(contextFields(task.context))
        const templateId = task.context.templateId || session.templateId || 'campus-standard'
        const templateRevision = Number(String(task.context.templateRevision || `${templateId}@1`).match(/@(\d+)/)?.[1] || 1)
        const templateSnapshot = await getWorkspaceTemplateSnapshotIdentity(session.workspaceRoot, templateId, templateRevision)
        const saved = await saveResumeVersion(session.workspaceRoot, task.context.taskId, session.resumePath, {
          ...contextFields(task.context),
          state: task.state,
          name: body.name,
          targetRole: body.targetRole,
          company: body.company,
          jobDescriptionPath: body.jobDescriptionPath,
          templateId,
          templateRevision: task.context.templateRevision || `${templateId}@${templateRevision}`,
          templateSnapshot,
          presentation: session.taskRef.presentation,
        })
      session.taskRef.current = saveResumeTask(confirmResumeTask(task))
      session.status = session.taskRef.current.state
      session.runState = 'idle'
      session.lastError = null
      await persistSession(options.sessionStore, session, { event: WORKFLOW_EVENTS.SAVE_CONFIRMED, state: session.status, versionId: saved.id, ...contextFields(session.taskRef.current.context) })
      await emitWorkflowEvent(runLogger, WORKFLOW_EVENTS.SAVE_CONFIRMED, { ...session.taskRef.current, sessionId: session.sessionId }, { versionId: saved.id, versionName: saved.name })
        sendJson(response, 200, { ok: true, sessionId, state: session.taskRef.current.state, version: { id: saved.id, name: saved.name, resumePath: saved.resumePath, contentVersion: saved.contentVersion, templateRevision: saved.templateRevision, templateSnapshot: saved.templateSnapshot, targetRole: saved.targetRole, company: saved.company, jobDescriptionPath: saved.jobDescriptionPath } })
    })
  } catch (error) {
    const details = { errorCode: String(error?.code || 'SAVE_FAILED'), errorMessage: String(error?.message || error) }
    if (session) {
      await emitWorkflowEvent(options.serverLogger, WORKFLOW_EVENTS.SAVE_REJECTED, { ...session.taskRef.current, sessionId: session.sessionId }, details).catch(() => {})
    }
    const clientErrorCodes = new Set(['SESSION_NOT_FOUND', 'SAVE_CONFIRMATION_REQUIRED', 'SAVE_NOT_ALLOWED', 'WORKSPACE_FILE_NOT_FOUND'])
    sendJson(response, clientErrorCodes.has(error?.code) ? 400 : 500, { ok: false, ...details })
  }
}

export function startServer() {
  const server = createServer()
  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    await new Promise((resolve) => server.close(() => resolve()))
    if (signal) await logger.info('agent_server_stopped', { signal })
    await server.flushLogs()
  }
  server.shutdown = shutdown
  server.listen(port, '127.0.0.1', () => {
    void logger.info('agent_server_started', { port })
  })
  process.once('SIGINT', () => { void shutdown('SIGINT').then(() => process.exit(0)) })
  process.once('SIGTERM', () => { void shutdown('SIGTERM').then(() => process.exit(0)) })
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer()
