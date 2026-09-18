# 项目运行日志规范

这是代码运行日志规范，不是开发周报。实际运行日志位于 `logs/`，按日期生成 NDJSON 文件。

## 必须记录的事件

- `agent_run_started` / `agent_run_finished`
- `tool_call_started` / `tool_call_succeeded` / `tool_call_failed`
- `artifact_written`
- `render_started` / `render_succeeded` / `render_failed`
- `measurement_received`
- `verification_blocked` / `verification_passed`
- `save_confirmed` / `save_rejected`

## 必须携带的关联字段

任务事件至少带 `sessionId`、`runId`、`taskId`、`workspaceId`、`resumeId`；渲染、测量和当前渲染产物上的验收事件还必须带 `contentVersion`、`templateRevision`、`renderId`。尚未产生渲染产物时的 `verification_blocked` 可以省略渲染字段，但必须记录阻塞原因。

## 打印约束

- 事件名使用稳定的 `snake_case`，不要把自然语言当作事件名。
- 不打印完整简历、Markdown、HTML、Prompt、聊天消息、密钥、Cookie 或授权头。
- 优先打印数量、哈希、版本、耗时、错误码、指标摘要和下一步动作。
- 日志写入失败只能降级到 stderr，不能阻断简历业务。
- 日志只用于回放和诊断，不能作为工作区、简历、模板或验收状态的权威来源。

## 示例

```json
{"timestamp":"2026-09-11T00:00:00.000Z","level":"info","event":"verification_blocked","component":"resume-workflow","runId":"run-1","taskId":"task-1","workspaceId":"workspace-1","resumeId":"resume-1","contentVersion":"content-7","templateRevision":"campus@3","renderId":"render-8","data":{"reason":"sparse_page","pageCount":2}}
```

## 2026-09-11 运行闭环里程碑

- `workspace.json` 是工作区身份的唯一来源；请求中的路径只用于定位，不作为第二套身份状态。
- 原简历只读；Agent 写入 `.cvagent/drafts/<taskId>/resume.md`，草稿写入后必须使旧渲染和旧测量失效。
- Agent 工具调用记录统一带任务上下文，内容正文仍然脱敏，不把 Markdown 或聊天消息写入日志。
- 素材读取只允许用户授权工作区内的文本扩展名，并排除 `.cvagent` 运行目录。
- 没有当前测量结果时，验收接口同时返回 `state=blocked` 和阻塞任务快照，禁止调用方继续使用旧状态。
- 浏览器测量通过独立回传入口写入，并强制匹配当前 `renderId`；模型工具默认不能伪造测量值。
- 正式版本写入独立 `.cvagent/versions/<versionId>/`，只有验收通过且保存接口收到用户确认才允许落盘。
- 已用 8 项 Node 测试覆盖状态、日志、工作区隔离、HTTP Agent 入口、会话作用域和测量回传；测试不调用真实模型。

## 2026-09-12 来源一致性与像素基线复核

- 顶栏与 A4 工作区按 DSH 实测基线固定为 `mainBar 49px`、`previewWorkspace y=75 / height=531`；避免页面高度受内容或状态文案波动。
- 当前工作区预览下拉框由服务端只读扫描生成，排除 `.cvagent` 隔离目录；不再只显示一份当前文件，降低旧预览被误认为当前版本的风险。
- `loadSource` 使用请求代次丢弃过期响应；快速切换简历文件时，旧模板、旧 Markdown、旧渲染结果不能覆盖最后一次选择。
- 测量状态不再显示模板 ID，改为稳定的 `测量中 · 排版指标` / `留白 x% · n 页` 短状态，避免状态来源变化引起顶部按钮抖动。
- 本轮 `npm.cmd test` 为 15 项通过；浏览器连续切换验收通过，截图留档 `logs/cvagent-parity-final-race-guard.png`。
- 读取链路实测发现：`/api/source`、模板加载、bootstrap 和 render 都成功，但前端未调用 `setView('workbench')`，导致用户仍停留在工作区页面。已补齐自动切换，并增加 UI 合同测试；同时将 `.cj-workbench` 字体栈和 14px 基准字号对齐 DSH，模板快速选择立即同步顶部标签。
- 本轮后端冒烟：health/source/templates/previews/bootstrap/preview 全部成功；过期测量返回 HTTP 400；bootstrap 前后原始简历 SHA-256 不变。浏览器页面巡检覆盖开始、工作区、预览、版本、模板库、模板工坊、排版检查、Agent、设置，未出现新增控制台错误。
- 追加来源一致性防线：任务已有 `contentVersion` 后，`resume_inspect` 改读当前隔离草稿；只有尚未产生草稿时才读取源文件，并以测试确认不会把旧源内容带回 Agent 回路。

## 2026-09-12 测量回传字段一致性修复

- 浏览器实测发现 A4 iframe 已完成分页（`pageCount=2`），但工作台持续显示“测量中”，且没有发出 `/api/agent/measure` 请求。
- 根因：渲染器协议把 `renderId` 放在 metric payload 顶层，前端入口错误地只检查 `payload.metrics.renderId`，事件在入口被丢弃；属于典型的同一事实多种字段来源问题。
- 修复：前端统一解析顶层 `renderId`，兼容旧的 `metrics.renderId`；同源 iframe 同时暴露 `window.__cvagentMetrics`，在 `load` 时作为可靠回读路径；服务端继续强制校验当前 `sessionId + renderId`，旧测量仍返回 400。
- 验收：15/15 Node 测试通过；修复后浏览器实测状态变为“版式需调整 · 排版指标”，`pageCount=2`；无新增控制台错误。当前“需调整”是内容真实占用率未达通过阈值，不是回传故障。

## 2026-09-12 运行日志系统升级

- 日志统一为 schema v1：事件名规范化、级别过滤、序号、hostname、请求 ID 与任务上下文可串联。
- 增加敏感信息双层脱敏：敏感字段名直接替换，字符串中的 Bearer、`sk-`/`rk-` 和常见凭据赋值也替换；正文、Prompt、Cookie 和授权头不落盘。
- 增加按日文件轮转、单文件大小上限、文件数量上限和按天保留策略；轮转/清理只匹配 `agent-*.ndjson`。
- 子 logger 共享写入队列，新增 `timed()` 统一记录开始、成功、失败和耗时；HTTP 请求统一记录 `requestId`、路由、状态码和耗时，并返回 `x-cvagent-request-id` 方便定位。
- 增加只读日志查询脚本：`npm run logs` 输出汇总，`npm run logs:tail` 支持按事件、级别、时间和条数筛选。
- 新增 logger 脱敏、子 logger 关联、轮转和耗时失败测试；本轮不调用真实模型，不消耗模型 token。
- 脱敏回归中发现 `sk-` 规则会误伤 `task-UUID` 的子串，已改为独立 token 边界并补充长 task ID 测试；历史日志已完成一次脱敏迁移，当前 dry-run 无待处理记录。

## 2026-09-17 生产级日志升级与 MCP 工序审计对接

- 新增 `docs/LOGGING_UPGRADE_RETROSPECTIVE.zh.md`、`specs/logging-upgrade/`，固化生产级日志需求、设计、验收标准和后续对接规则；单用户范围不降低工序一致性和恢复要求。（已完成的规格随后移入仓库根目录 `docs/archive/2026-09-completed-work/`。）
- 新增 `src/core/event-catalog.js`，统一业务事件目录和关联字段校验；通用 `tool_call_*` 日志继续保留，但不再作为简历业务工序的唯一审计依据。
- 工具层补齐 `artifact_written`、`render_started/succeeded/failed`、`measurement_received`、`verification_passed/blocked/failed`；渲染 ID 在开始前生成并贯穿当前内容版本和模板版本。
- 服务层补齐 `agent_run_finished`、`session_restored`、`session_interrupted`、`source_changed`、`save_confirmed`、`save_rejected`；正式版本只有在用户确认且落盘成功后才记录 `save_confirmed`。
- 会话事件改为复用日志脱敏规则，并按 session 串行写入；服务关闭路径增加日志刷盘，避免尾部事件丢失。
- 修正脱敏规则：正文 `content` 仍脱敏，但 `contentVersion`、`contentHash` 等审计关联字段保留，保证工序可回放。
- 新增完整工序成功、验收阻塞、源文件变化和保存拒绝测试；本轮 `npm.cmd test` 为 22 项全部通过。

## 2026-09-17 工作区选择脱钩改造

- 新增工作区选择对接复盘和规格文档，明确 Web UI 不再暴露 `workspaceRoot` / `resumePath`。
- 新增 `workspace-registry`，将用户主动选择的目录导入到 CVAgent 受管工作区，自动识别 `resume.md` 或首个 Markdown 简历。
- 新增 `/api/workspaces`、`/api/workspaces/import`、`/api/workspace`，业务 API 优先接受不透明 `workspaceId`；旧路径契约保留给兼容调用。
- 工作区页面改为目录选择、最近工作区和自动识别简历；版本页面不再展示 `.cvagent` 内部路径。
- 新增 workspaceId API 链路和 UI 合同测试；本轮 `npm.cmd test` 为 24 项全部通过，HTTP 冒烟确认页面无路径输入、导入和 source 读取成功。
