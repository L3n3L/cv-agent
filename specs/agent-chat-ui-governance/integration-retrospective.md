# Agent 会话 UI 与可观测性对接复盘方案

更新：2026-09-19  
状态：第一轮代码整理、自动化测试与真实浏览器验收已完成

## 1. 目标与结论

CVAgent 的 Agent 面板目前已经接入 DeepAgent v3 流式入口和真实工具事件，但“会话消息、工具时间线、运行状态、错误状态、服务日志”还没有形成同一套状态契约。表现为：

- Agent 文字可能已经开始流式输出，但工具过程没有在同一阅读顺序中稳定出现；
- 运行结束后，前端重新拉取 session 时会清掉仍在显示的流式文本；
- Agent 失败后，顶部状态可能仍停留在“Agent 正在处理当前会话”；
- 工具事件有服务端日志，但浏览器端没有可按 `sessionId/runId/toolCallId` 对照的调试记录；
- `agent-chat.js` 负责事件分组、状态判断和 HTML 输出，`workbench-runtime.js` 又同时负责 SSE、session 同步、消息状态和渲染触发，边界过宽，容易产生竞态。

本次治理不改当前三栏工作台结构，也不重写成另一套聊天产品。目标是把 Agent 面板收敛成一个可恢复、可追踪、可测试的事件驱动模块：

```text
DeepAgent / 工具执行
        ↓
统一 AgentEvent（runId / messageId / toolCallId）
        ↓ SSE 实时传输 + session 事件回放 + 服务端日志
        ↓
前端状态归约器
        ↓
消息、工具组、运行状态、错误态
```

## 2. 外部方案调研

### 2.1 DeepAgents / LangChain

DeepAgents 官方将 Agent 视为基于 LangGraph 的 harness，内置规划、工具、skills、上下文管理和持久化能力；前端不应把一轮 Agent 运行简化成一次 `invoke` 的最终字符串。

官方的 subagent streaming 示例将主 Agent 消息、子 Agent 状态、工具触发关系拆开，通过稳定 ID 关联，并展示 `pending → running → complete/error` 的生命周期、耗时和错误。即使 CVAgent 当前没有子 Agent，也应复用这个思想：运行状态和最终文本是两条不同的 UI 数据。

参考：

- https://docs.langchain.com/oss/javascript/deepagents/overview
- https://docs.langchain.com/oss/javascript/deepagents/frontend/subagent-streaming
- https://docs.langchain.com/oss/javascript/langchain/frontend/integrations/overview

### 2.2 AG-UI 事件模型

AG-UI 将流式交互定义成有边界的事件序列，而不是任意文本：

- 文本：`start → content(delta) → end`；
- 工具：`start → args(delta) → end → result`；
- 运行：`started → finished/error`；
- 每个事件通过 `messageId`、`toolCallId` 和父级关系关联；
- 前端按到达顺序归约，并对乱序、重连和重复事件保持幂等。

这正好解决当前“有流式文字但看不到工具上下文”的问题。CVAgent 不直接引入 AG-UI 依赖，但将现有 SSE 字段按同一原则整理。

参考：https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx

### 2.3 Vercel AI SDK UI

Vercel AI SDK 的 `useChat` 不只维护 `content`，而是把消息拆成 `parts`，其中可以并列存在文本、reasoning、tool-call、tool-result；它还明确区分 `submitted`、`streaming`、`ready`、`error`，并提供 `onFinish`、`onError`、`onData` 等生命周期入口。

CVAgent 当前不需要替换成 AI SDK，但应吸收两个原则：

1. UI 渲染的是结构化消息片段，而不是把所有过程拼成一大段 Agent 文案；
2. “正在流式”“工具运行中”“运行失败”“运行完成”必须是状态，不应该伪装成模型输出。

参考：

- https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
- https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol

## 3. 当前代码问题定位

### 3.1 状态合并竞态

`frontend/react/src/runtime/workbench-runtime.js` 同时处理 SSE、乐观用户消息、流式 Agent 文本、session 回放和 UI 重绘。当前 `syncActiveSessionFromServer()` 在 session 不再是 `running` 时直接清空 `streamingAssistantText`，并用持久化消息覆盖本地消息。这会在 `agent_run_finished` 到达时抹掉最后一段正在显示的文本或当前轮用户消息。

### 3.2 失败状态不完整

SSE 收到 `agent_run_finished(outcome=failed)` 时只设置了 `agentRunError`，没有统一更新页面状态。`agent-chat.js` 的 `eventStatus()` 也把所有 `agent_run_finished` 当成 `done`，导致工具组和页面状态可能互相矛盾。

### 3.3 事件与展示耦合

`agent-chat.js` 直接从事件数组生成 HTML。它同时承担事件过滤、工具配对、状态判断、摘要格式化和视觉结构，缺少独立的纯归约层，难以单测“同一事件重复到达”“失败后回放”“工具先于文本到达”等情况。

### 3.4 可观测性断层

服务端已经记录 `tool_call_started/succeeded/failed`，但 `assistant_delta` 只实时广播、不落服务日志；浏览器端 `client-events.js` 只记录资源错误、脚本错误和未处理异常，不记录 SSE 连接、事件序列、重连和状态归约结果。出现 UI 问题时只能猜是模型、SSE 还是渲染造成的。

### 3.5 旧代码判断

当前 React 入口只从 `frontend/react/src/main.tsx` 显式加载运行时模块，历史 `backend/public` 和旧根入口已删除。现在的问题不是两套页面抢占，而是当前唯一运行时内部职责过重。保留的迁移兼容代码和 CSS 兼容类不属于 Agent 会话链路，不在本次清理范围内。

### 3.6 本轮已落地的修复

- 新增 `frontend/react/src/runtime/agent-chat-state.js`，集中处理运行状态、失败优先级、当前轮消息合并和旧 run 过滤；
- 运行失败时保留本地流式回答和当前用户消息，避免 session 同步把问题现场清掉；
- 对旧 run 的迟到增量、结束和渲染事件做 runId 过滤，避免旧请求覆盖当前会话；
- SSE 先建立订阅，再发送 ready 和持久化事件回放，避免连接建立窗口丢掉工具事件；
- 增加 Agent 助手消息开始/结束日志，结束日志只记录字符数，不记录正文；
- 增加 SSE 连接异常的前端遥测，并带 `sessionId/runId/workflowEvent`，方便从浏览器问题定位到服务端日志；
- 完成纯状态函数、SSE 诊断、流式消息生命周期和前端契约测试。

## 4. 统一实现契约

### 4.1 AgentEvent 最小字段

```text
event
timestamp
sessionId
runId
taskId
messageId?       // assistant_message_* / assistant_delta
toolCallId?      // tool_call_*
toolName?
outcome?
errorCode?
durationMs?
resultSummary?   // 脱敏后的结构化摘要
delta?           // 仅 assistant_delta，且只走实时 SSE
```

### 4.2 前端状态不变量

1. 同一个 `sessionId + runId` 只对应一个运行组；
2. 同一个 `toolCallId` 只对应一行工具记录，重复事件必须幂等；
3. `assistant_delta` 只能追加到同一个 `messageId`，不能覆盖已经完成的 Agent 消息；
4. `agent_run_finished(outcome=failed)` 的运行组必须是 `failed`，不能显示为 `done`；
5. session 回放不能清除仍有本地证据的当前轮，成功终态才用持久化最终消息替换流式草稿；
6. 工具和消息的可见状态必须来自真实事件，禁止前端生成“已执行 N 项工具”等没有事件依据的假进度；
7. 所有异步回调在写入 UI 前检查当前 `sessionId + runId`，旧 run 不得覆盖新 run。

### 4.3 UI 呈现原则

- Agent 最终回答是主内容；
- 工具过程是同一轮回答下的低干扰折叠组，运行中自动展开，完成后收起，失败项保持可见；
- 工具行只显示名称、状态、耗时和必要的错误/结果摘要，不展示内部 prompt、重复状态文案或伪造“下一步”；
- 连接中断显示为连接问题，不冒充 Agent 回复；
- 页面刷新后恢复已持久化的消息和工具事件，仍在运行的 run 通过 session 状态恢复为可诊断状态。

## 5. 代码整理方案

### 阶段 A：先收敛状态边界

- 在 `workbench-runtime.js` 中集中处理 run 生命周期，抽出“本地当前轮”和“服务端 session 快照”的合并函数；
- 明确 `running / success / failed / interrupted` 的终态转换；
- SSE 结束时先完成 UI 状态归约，再做 session 同步，避免同步请求反向抹掉增量状态；
- 统一更新 `routeStatus`、Agent 时间线和输入框可用状态。

已完成第一轮：状态合并和失败收尾已集中到 `agent-chat-state.js` 与 `syncActiveSessionFromServer()`，仍需浏览器验证断线与失败截图。

### 阶段 B：抽出纯事件归约层

- 从 `agent-chat.js` 抽出无 DOM 副作用的事件分组与工具行归约函数；
- 归约函数输入事件数组，输出 `RunViewModel[]`；
- HTML/React 视图只负责渲染 ViewModel，不再自己判断事件状态；
- 先保持现有 DOM 结构，避免把状态治理和视觉重做混在一起。

### 阶段 C：补齐调错设施

- 服务端继续保留工具日志，并统一 `sessionId/runId/taskId/toolCallId`；
- 增加 Agent run 的开始、SSE 发送、SSE 重连、状态归约失败等低噪声日志；
- 前端调试信息默认不显示给用户，只在开发模式写入受限的 client telemetry，不记录简历正文、prompt 或 token；
- 提供按 `sessionId/runId` 查询一轮完整事件的脚本输出，方便从浏览器截图反查服务端日志。

已完成第一轮：服务端保留工具事件和助手生命周期日志，SSE 支持持久化事件回放，浏览器上报连接异常；日志仍不记录简历正文、prompt、reasoning 或 token。

### 阶段 D：回归验证

- 单元测试：事件顺序、重复事件、失败终态、旧 run 竞态、session 合并；
- SSE 集成测试：异步 `202`、工具事件与增量文本交错、失败、断线后回放；
- 浏览器测试：发送普通对话、发送会触发工具的请求、运行中截图、完成后截图、刷新恢复、失败态；
- 运行 `backend` 测试、React typecheck/build，并检查浏览器控制台。

## 6. 明确不做

- 不切换 React/Vite，不重写当前三栏工作台；
- 不复制 assistant-ui 或 AI SDK 的整套运行时；
- 不把私有链式推理原文写入日志或用户聊天记录；
- 不继续增加“思路摘要”“下一步”等解释性占位文本；
- 不通过吞异常、延迟刷新或硬编码假工具记录来掩盖事件链路问题。

## 7. 验收清单

- [x] 用户发送消息后，文本增量、工具行和最终回答在同一 Agent 时间线中按事件顺序出现；
- [x] 工具调用过程中，工具行可见且显示进行中；工具结束后记录不消失；
- [x] Agent 失败时，页面状态、运行组和错误信息一致，不再显示“仍在处理”；
- [x] 刷新 Agent 面板后，已完成会话的消息和工具记录可恢复；
- [x] 旧 run 的延迟事件不会覆盖新 run；
- [x] 日志可用 `sessionId + runId + toolCallId` 定位一轮；
- [x] 后端测试、React typecheck/build 和真实浏览器验证通过；
- [x] 截图验收只记录真实浏览器状态，不把静态占位文案当成 Agent 输出。

## 8. 复盘记录

本次问题的根因不是“DeepAgent 没有能力”，也不是简单 CSS 问题，而是 Agent UI 尚未建立与 DeepAgent/LangGraph 流程匹配的事件边界。后续每新增一个 Agent 能力，必须同时补齐：事件定义、服务端日志、前端状态归约、持久化回放、自动测试和浏览器截图验收。

## 9. 本轮验收记录

- 自动化：backend `npm test` 67/67 通过；React `typecheck` 与 `build` 通过；
- 真实浏览器：`http://127.0.0.1:3191/react/` 刷新后，历史 Agent 消息、工具组和失败工具记录均可从 SSE 回放恢复；再次发送只读请求后，工具调用记录保留，最终回答正常出现；浏览器 error/warn 日志为空；
- 服务端日志：已看到 `agent_sse_connected`、`assistant_message_started`、`tool_call_started/succeeded/failed`、`assistant_message_finished`、`agent_run_finished`，可用 `sessionId + runId + toolCallId` 回溯；
- 当前浏览器里的 `measurement requires a current render` 属于已有历史会话在重启后回放的旧测量失败，不是本轮 Agent UI 代码异常；新只读请求正常完成。
