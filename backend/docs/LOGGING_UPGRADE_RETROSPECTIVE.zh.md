# CVAgent 生产级日志升级与 MCP 工序对接复盘

更新时间：2026-09-17

## 1. 结论

CVAgent 现有日志底座已经具备结构化 NDJSON、级别过滤、文件轮转、保留策略、脱敏、请求 ID、工具耗时和会话持久化能力，但这些能力还不能单独证明简历 Agent 工序是生产级的。

生产级要求不是“发生过什么工具调用”，而是能够对一次简历生产任务进行完整、稳定、可关联、可恢复的回放：

```text
resume_prepare
→ resume_read
→ resume_check
→ resume_write / mutation
→ resume_render
→ resume_metrics
→ resume_finalize
→ user_confirmation
→ resume_save_version
```

每个关键业务步骤都必须能回答：

- 哪个 session、哪个 run、哪个 task 触发的；
- 使用了哪一版内容、模板、渲染产物；
- 什么时候开始、什么时候结束、耗时多久；
- 是成功、阻塞还是失败；
- 失败后允许的下一步是什么；
- 服务重启或请求重试后是否能恢复和去重。

## 2. 本轮对接范围

### 2.1 必须完成

- 建立稳定的生产级业务事件目录，事件名使用 `snake_case`。
- 统一 `sessionId`、`runId`、`taskId`、`workspaceId`、`resumeId`、`contentVersion`、`templateRevision`、`renderId` 关联字段。
- 保留通用工具日志，同时补齐 MCP 简历工序的业务事件。
- 为渲染、测量、验收、保存、会话恢复、源文件变化补齐明确事件。
- 会话事件和运行日志使用同一套脱敏规则，不能因为写入 `events.ndjson` 而绕过脱敏。
- 服务退出时刷盘，避免最后一段工序日志丢失。
- 用测试验证完整工序的事件顺序、失败分支和重启恢复。

### 2.2 暂不纳入

- 多租户权限、账号认证和外部日志平台接入。
- 云端日志采集、告警平台和分布式追踪系统。
- 将日志作为简历状态的权威来源。权威来源仍然是会话快照、草稿、渲染产物和版本文件。

“单用户”只缩小身份和并发范围，不降低事件一致性、恢复和验收要求。

## 3. 事件契约

### 3.1 Agent 运行事件

```text
agent_run_started
agent_run_finished       outcome=success|failed
```

失败、异常退出和恢复必须带错误码或恢复原因；成功不能只记录模型文本长度，还要记录最终任务状态。

### 3.2 工具事件

```text
tool_call_started
tool_call_succeeded
tool_call_failed
```

工具事件用于技术层耗时和错误诊断，不能替代下方的业务事件。

### 3.3 简历业务事件

```text
artifact_written
render_started
render_succeeded
render_failed
measurement_received
verification_passed
verification_blocked
verification_failed
save_confirmed
save_rejected
session_restored
session_interrupted
source_changed
```

其中：

- `artifact_written` 表示隔离草稿或其他业务产物已经写入；
- `render_*` 必须关联即将生成或已经生成的 `renderId`；
- `measurement_received` 必须关联当前 `renderId`，并记录页数、占用率摘要、溢出状态；
- `verification_passed` / `verification_blocked` 表示验收结果，不表示 HTTP 请求是否成功；
- `save_confirmed` 只在用户明确确认并且正式版本落盘后记录；
- `save_rejected` 必须记录所有没有保存成功的业务原因；
- `session_interrupted` 表示从运行中会话恢复到最近一次快照，不等同于普通的 `session_restored`。

### 3.4 关联字段

基础工序事件必须带：

```text
sessionId
runId
taskId
workspaceId
resumeId
```

渲染、测量和已绑定当前渲染产物的验收事件必须带：

```text
contentVersion
templateRevision
renderId
```

如果验收在尚未产生渲染产物时就被调用，`verification_blocked` 可以不带这些渲染字段，但必须带阻塞原因；一旦阻塞针对当前渲染产物，则必须带完整渲染上下文。

允许记录数量、哈希、版本、耗时、错误码、状态和下一步动作；禁止记录完整简历、Markdown、HTML、Prompt、聊天消息、密钥、Cookie 和授权头。

## 4. 当前实现复盘

### 已有能力

- `src/core/logger.js` 已提供结构化日志、脱敏、轮转、保留和异步写入。
- `src/core/tool-runner.js` 已统一记录工具开始、成功、失败和耗时。
- `src/core/session-store.js` 已持久化快照、消息和会话事件。
- HTTP 层已有请求 ID 和请求耗时。
- 日志脱敏和文件轮转已有回归测试。

### 已识别问题

- 渲染、验收、保存失败主要只能从通用工具或 HTTP 日志推断。
- `agent_run_succeeded`、`agent_run_finished`、`tool_succeeded` 等名称不统一。
- 会话事件缺少统一的工序关联字段。
- 会话事件写入路径没有复用日志脱敏规则。
- 从 `running` 会话恢复、源文件变化和保存拒绝没有稳定业务事件。
- 服务关闭时没有统一的日志刷盘入口。
- 缺少从准备到保存的全链路事件序列测试。

## 5. 实施决策

1. 使用 `src/core/event-catalog.js` 作为唯一业务事件目录和字段规范入口。
2. `tool_call_*` 保留，用于技术层观测；业务事件由工具运行器按工具结果显式发出。
3. 渲染 ID 在渲染开始前生成并传入渲染器，保证 `render_started` 和 `render_succeeded` 使用同一个 ID。
4. 验收未通过是正常业务分支，记录 `verification_blocked`，不记录成系统异常。
5. 保存未发生或被拒绝必须记录 `save_rejected`；只有正式版本成功落盘后才记录 `save_confirmed`。
6. 会话事件只记录元数据，并统一经过日志脱敏；日志仍然不是状态权威来源。
7. 所有关键事件测试使用注入 Agent 和临时目录，不依赖真实模型或外部服务。

## 6. 生产验收标准

- 一次成功任务可以按 `sessionId + runId + taskId` 重建完整工序。
- 渲染、测量、验收和保存之间的 `contentVersion`、`templateRevision`、`renderId` 不可错配。
- 验收阻塞能明确看到阻塞原因和下一步，不被误判为系统崩溃。
- 保存确认不存在时一定有 `save_rejected`，不存在伪造的 `save_confirmed`。
- 服务在 Agent 执行中退出后，重新加载会话能记录中断恢复，并从最后一次持久化状态继续。
- 源简历在会话外变化时记录 `source_changed`，并拒绝继续复用旧会话。
- 事件内容经过脱敏，日志和会话事件中不出现简历正文、Prompt、Token 或 Cookie。
- 进程关闭前完成日志队列刷盘。
- 日志写入故障只降级到 stderr，不改变简历业务结果。

## 7. 后续演进

当前实现完成本地单用户的生产级工序审计基础。后续接入多用户或服务化部署时，再将同一事件契约映射到 OpenTelemetry、集中式日志和告警系统，不改变业务事件名称和关联字段。

## 8. 给后续自己的提醒

不要把“有 NDJSON 文件”和“日志设施齐全”混为一谈。判断 CVAgent 是否达到生产级，必须沿 MCP 工序检查：是否能从准备一路追踪到保存，是否能解释每次阻塞和失败，是否能在重启后恢复，是否能证明最终保存对应的是当前内容、模板和渲染产物。
