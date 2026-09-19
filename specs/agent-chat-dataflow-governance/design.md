# Agent 聊天数据流治理设计

更新：2026-09-19

## 1. 目标架构

保留“消息快照 + 工作流事件”的职责分离，但让事件成为可追踪的过程事实，让消息快照成为最终对话投影。前端不再依赖数组位置匹配，而是使用 turnId、runId、sequence、messageId 和 toolCallId 归并。

```text
Agent / Tool Runner
        │
        ├─ conversation turns ──── turnId
        │       └─ messages ────── session.messages / messages.ndjson
        │
        └─ workflow runs ───── runId + sequence ── events.ndjson + session snapshot
                                      │
                           SSE id / Last-Event-ID
                                      │
                                      ▼
                         frontend event/message reducer
                                      │
                                      ▼
                              timeline projection
```

## 2. 后端边界

### 2.1 消息生命周期

- 每次用户提交创建一个 `turnId`；用户消息、最终 assistant 消息和该轮所有自动 continuation 都归属于这个 turn。
- 每次实际 Agent 执行创建一个独立 `runId`；自动 continuation 复用原 `turnId`，但不能复用上一轮执行的 `runId`。
- 真实用户消息在 `runAgentTurn` 开始前写入 session，避免服务或浏览器在执行期间丢失用户输入。
- 内部 measurement continuation 指令不作为用户可见消息固化；它只作为 Agent 输入。
- `streamed.result.messages` 在所有退出分支统一归并，包括 paused 和 complete-after-finalize；归并失败时保留已存在的 session 消息。

### 2.2 事件生命周期

- 每个 workflow event 必须携带 `turnId`；执行事件同时携带本次执行的 `runId`。
- session 维护 `workflowSequence`，每次发布工作流事件先递增，再将 sequence 写入事件 payload。
- 非 delta 事件继续写入 session 快照和事件日志；delta 只走实时 SSE，避免逐 token 文件写入。
- 事件日志作为 SSE 回放源；本次重构前清空旧开发 session，不为旧事件补造 sequence。
- SSE workflow frame 使用 `id: sequence`，浏览器自动重连时由 `Last-Event-ID` 请求断点之后的事件。
- SSE 连接先注册实时订阅，再读取历史；前端收到重叠回放时按 sequence 去重，避免订阅与回放之间形成丢事件窗口。

### 2.3 兼容性

- 当前开发阶段不兼容旧 session；重构切换前清空 `.cvagent/sessions/*`，保留工作区源文件、模板、渲染产物和诊断日志。
- 非流式 `/api/agent/run` 保持原有同步 JSON 行为。
- 现有 session lock、工具权限和 A4 measurement renderId 校验保持不变。

## 3. 前端边界

- 前端只消费一个归并后的 `ConversationState`，组件不能分别追加 session messages、SSE delta 和 workflow events。
- 每个 turn 的展示结构是“用户消息 + AI 过程/回答 + 可折叠工具轨迹 + AI 最终消息”；工具轨迹属于 turn，不属于独立 conversation message。
- 工具轨迹默认折叠；运行中只显示轻量渐变状态，展开后才展示真实工具摘要和耗时。
- `mergeWorkflowEvents` 以 sequence 作为首选身份，旧事件才使用兼容 key。
- SSE 事件到达后保留本地流式文本作为当前轮 fallback，避免 delta 暂时缺失造成空消息。
- session 同步请求允许合并，但如果同步期间再次收到终态，必须排队一次最新同步，不能丢掉第二次刷新请求。
- delta 不进入持久化事件日志；若当前页面仍有累积文本，渲染层使用内存文本兜底，最终消息快照负责刷新后的完整恢复。
- workflow renderer 按 `turnId` 投影；完成迁移后删除基于 `groupIndex` 的关联和旧 timeline fallback。
- 展开/收起状态只存在于 UI 层，不得写入会话事实，也不得影响事件顺序和 run 状态。

## 4. 测试策略

1. 单元测试：sequence 去重、长事件流、消息快照归并和 queued sync 的状态契约。
2. HTTP/SSE 集成测试：paused 后读取 session、Last-Event-ID 断点回放、自动 continuation 的最终快照。
3. 前端构建：TypeScript typecheck 和 Vite build。
4. 回归：现有 Agent v3 流式、工具时间线、A4 测量和版本保存测试必须继续通过。

## 5. 风险与取舍

- 事件日志会增加磁盘写入，但只写非 delta 事件，仍然远低于逐 token 持久化。
- 老 session 的历史事件可能没有 sequence，只能兼容回放最近快照；新 session 从本次改造开始获得完整断点能力。
- 本阶段不强制将所有聊天 UI 改为 React，避免把数据流修复和视觉重构混在一起。

## 6. 旧实现退役规则

新实现不是在旧 renderer 上继续叠加分支。每个迁移任务必须按以下顺序完成：

1. 写新模型和迁移测试；
2. 迁移全部调用方；
3. 证明新路径成为唯一事实来源；
4. 删除旧 renderer、旧关联逻辑和无明确期限的 fallback；
5. 全局搜索旧符号和旧接口引用；
6. 通过构建、单测、浏览器刷新/断线/失败恢复验收。

如果旧实现暂时不能删除，必须在任务文档中记录明确删除条件；否则视为未完成架构迁移。
