# 日志升级需求

## 目标

为 CVAgent 的 MCP 对齐简历工序建立生产级运行审计能力，使一次简历生产任务可以被完整关联、诊断和恢复。

## 范围

- 单用户本地服务。
- Agent 运行、工具调用、草稿写入、渲染、浏览器测量、验收、用户确认保存、会话恢复和源文件变化。
- 本地 NDJSON 运行日志和会话事件文件。

## 非目标

- 多租户鉴权。
- 外部日志平台和云端告警。
- 以日志替代会话快照或工作区文件状态。

## 验收条件（EARS）

1. 当 Agent 开始一次任务时，CVAgent 应记录 `agent_run_started`，并携带 `sessionId`、`runId`、`taskId`、`workspaceId`、`resumeId`。
2. 当工具成功或失败时，CVAgent 应记录对应的 `tool_call_*` 事件，并记录工具名、耗时和错误摘要。
3. 当草稿写入成功时，CVAgent 应记录 `artifact_written`，并携带新的 `contentVersion`。
4. 当渲染开始、成功或失败时，CVAgent 应记录对应的 `render_*` 事件，并使用同一个 `renderId`。
5. 当浏览器测量回传时，CVAgent 应仅接受当前 `renderId`，并记录 `measurement_received`。
6. 当验收通过时，CVAgent 应记录带当前渲染上下文的 `verification_passed`；当验收条件不满足时，应记录 `verification_blocked`，若当前已有渲染产物则必须带 `contentVersion`、`templateRevision`、`renderId`，而不是将正常阻塞当作系统异常。
7. 当用户未确认、验收未通过或保存失败时，CVAgent 应记录 `save_rejected`，且不得记录 `save_confirmed`。
8. 当正式版本完成落盘且用户已确认时，CVAgent 应记录 `save_confirmed`。
9. 当服务从运行中的会话恢复时，CVAgent 应记录 `session_interrupted` 和恢复信息。
10. 当会话外源简历发生变化时，CVAgent 应记录 `source_changed` 并拒绝复用该会话。
11. 当日志写入失败时，CVAgent 应降级到 stderr，且不得阻断简历业务流程。
12. 当服务收到关闭信号时，CVAgent 应在退出前刷盘日志队列。
13. 任何运行日志和会话事件不得包含完整简历、Markdown、HTML、Prompt、聊天消息、Token、Cookie 或授权头。
