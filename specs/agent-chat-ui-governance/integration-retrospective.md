# Agent 会话 UI 与可观测性对接复盘方案

更新：2026-09-19  
状态：事件时间线、测量暂停/恢复链路、终态归约与真实浏览器验收已完成

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

### 2.3 OpenAI Agents / LangGraph 的流式生命周期

官方 Agents SDK 将完整 stream 分成原始模型事件、消息/工具 run-item 事件和 Agent 生命周期事件；只消费文本流会丢失工具调用，调用方还必须持续 drain 到终态。LangGraph 原生提供 `interrupt`、checkpoint 和 `Command` 恢复机制，外部浏览器测量应当是运行状态的一次暂停/恢复，而不是一个和模型并发争抢 session 锁的普通 HTTP 回调。

CVAgent 当前采用相同的边界，但保留自己的业务工具和 session 持久化：`assistant_message_*` 与 `tool_call_*` 进入同一时间线；`resume_render` 后进入 `waiting_for_measurement`，测量完成后按验收结果启动下一轮 continuation。

参考：

- https://openai.github.io/openai-agents-js/guides/streaming/
- https://docs.langchain.com/oss/javascript/langgraph/interrupts

### 2.4 Vercel AI SDK UI

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
- 新增 `projectWorkflowTimeline()`，按 `timestamp + 首次出现顺序` 将 Agent 文本和工具事件投影到同一条时间线上，终态事件只更新原行，不把工具组整体后置；
- 工具详情统一使用默认闭合的 `details`，失败只在摘要显示状态，错误码和结果摘要需用户主动展开；
- 空的 `assistant_message_started` 生命周期不渲染成“正在输出”占位，只有收到真实 delta 才进入消息轨道；隐藏的 toast 同时清空文本，避免辅助树和调试截图残留旧状态；
- 增加 `agent_run_paused` 与 `waiting_for_measurement` 状态。生产 run 在 `resume_render` 成功后主动结束当前模型段、释放 session 锁，避免模型越过真实测量继续调用 `resume_finalize`；测量通过后，`resume_finalize` 将 `accepted` 视为本轮成功终点，即使底层 v3 stream 没有自行关闭，也会由服务端发出唯一的成功终态；
- 测量回调只处理暂停后的当前 render，低密度或溢出时再启动新的 continuation run，不再把“等待测量”记录成 `AGENT_RUN_FAILED`；
- Windows 持久化保留原子写入，但对目标文件短暂被浏览器/服务进程占用时的 `EACCES/EBUSY/EPERM` 做有上限的退避重试；超过上限仍然抛出真实错误，不吞异常；
- 为上述时间线投影和等待态补充自动化测试，当前 backend 测试为 69/69。

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
  reason?
  errorCode?
durationMs?
resultSummary?   // 脱敏后的结构化摘要
delta?           // 仅 assistant_delta，且只走实时 SSE
```

### 4.2 前端状态不变量

1. 同一个 `sessionId + runId` 只对应一个运行组；
2. 同一个 `toolCallId` 只对应一行工具记录，重复事件必须幂等；
3. `assistant_delta` 只能追加到同一个 `messageId`，不能覆盖已经完成的 Agent 消息；
4. `agent_run_finished(outcome=failed)` 的运行组必须是 `failed`，不能显示为 `done`；`outcome=paused` 必须显示为 `waiting`，不能显示为错误；
5. session 回放不能清除仍有本地证据的当前轮，成功终态才用持久化最终消息替换流式草稿；
6. 工具和消息的可见状态必须来自真实事件，禁止前端生成“已执行 N 项工具”等没有事件依据的假进度；
7. 所有异步回调在写入 UI 前检查当前 `sessionId + runId`，旧 run 不得覆盖新 run。

### 4.3 UI 呈现原则

- Agent 最终回答是主内容；
- 工具过程与 Agent 文本共用一条时间线；工具行默认折叠，运行中、完成和失败都不强制展开；
- 工具行只显示名称、状态、耗时和必要的错误/结果摘要，不展示内部 prompt、重复状态文案或伪造“下一步”；
- 连接中断显示为连接问题，不冒充 Agent 回复；
- 页面刷新后恢复已持久化的消息和工具事件，仍在运行的 run 通过 session 状态恢复为可诊断状态。

## 5. 代码整理方案

### 阶段 A：先收敛状态边界

- 在 `workbench-runtime.js` 中集中处理 run 生命周期，抽出“本地当前轮”和“服务端 session 快照”的合并函数；
- 明确 `running / success / failed / interrupted` 的终态转换；
- SSE 结束时先完成 UI 状态归约，再做 session 同步，避免同步请求反向抹掉增量状态；
- 统一更新 `routeStatus`、Agent 时间线和输入框可用状态。

已完成：状态合并和失败收尾已集中到 `agent-chat-state.js` 与 `syncActiveSessionFromServer()`；时间线投影也已进入同一纯函数边界。

### 阶段 B：抽出纯事件归约层

- 从 `agent-chat.js` 抽出无 DOM 副作用的事件分组与工具行归约函数；
- 归约函数输入事件数组，输出 `RunViewModel[]`；
- HTML/React 视图只负责渲染 ViewModel，不再自己判断事件状态；
- 先保持现有 DOM 结构，避免把状态治理和视觉重做混在一起。

已完成：`projectWorkflowTimeline()` 输出 assistant/tool entry，HTML 层只负责展示；工具默认闭合，未再通过 `open` 属性伪造过程状态。

### 阶段 B.1：建立外部测量暂停边界

- `resume_render` 是生产流程的阶段边界，不允许同一 Agent run 在没有当前浏览器测量时进入 finalize；
- 暂停后 session 锁必须释放，测量请求能立即完成；
- 测量通过则结束任务，测量不通过则通过新的 continuation run 继续，而不是复用已经越过边界的旧调用栈；
- 暂停、恢复、失败分别记录独立事件，UI 不把暂停态渲染成失败。

已完成：后端已接入 `agent_run_paused`、`waiting_for_measurement` 和 render 后 cooperative abort；自动 continuation 仍沿用原有预算与 renderId 幂等保护。

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

- [x] 用户发送消息后，文本增量、工具行和最终回答在同一 Agent 时间线中按事件顺序出现；已通过真实浏览器运行中截图验收；
- [x] 工具调用过程中，工具行可见且显示进行中；工具结束后记录不消失；已通过真实浏览器运行中截图验收；
- [x] Agent 失败时，页面状态、运行组和错误信息一致，不再显示“仍在处理”；
- [x] 刷新 Agent 面板后，已完成会话的消息和工具记录可恢复；
- [x] 旧 run 的延迟事件不会覆盖新 run；
- [x] 日志可用 `sessionId + runId + toolCallId` 定位一轮；
- [x] 后端测试、React typecheck/build 和真实浏览器均已通过本轮变更后的复测；
- [x] 截图验收只记录真实浏览器状态，不把静态占位文案当成 Agent 输出。

## 8. 复盘记录

本次问题的根因不是“DeepAgent 没有能力”，也不是简单 CSS 问题，而是 Agent UI 尚未建立与 DeepAgent/LangGraph 流程匹配的事件边界。后续每新增一个 Agent 能力，必须同时补齐：事件定义、服务端日志、前端状态归约、持久化回放、自动测试和浏览器截图验收。

## 9. 本轮验收记录

- 自动化：backend `npm test` 69/69 通过；React `typecheck` 与 `build` 通过；新增“暂停后成功终态覆盖旧暂停态”的状态归约测试；
- 真实浏览器：运行中可先看到 Agent 文本，再看到按到达顺序追加的工具行；工具行默认折叠；`resume_render` 后显示“等待测量”，真实测量完成后状态收口为完成，不再显示 `AGENT_RUN_FAILED`；刷新后仍能回放已持久化事件；
- 服务端日志：本轮真实失败可定位到 `session_683075da-c83a-41b4-bee8-5028e7f05336` / `run-694f7e52-7dcc-4773-b7dc-a27a5832a471`。日志原始时间是 UTC：`04:34:51Z` 开始，`04:35:43Z` 结束，换算香港时间为 `12:34:51`–`12:35:43`；期间存在连续的 `tool_call_started/succeeded`，并非没有工具调用；
- 失败根因：`render_61a2ee80-9208-46c7-b58f-d6a31888721c` 虽然已生成，但浏览器测量请求对当前 render 没有形成有效匹配，随后 `presentation_suggest` 报 `MEASUREMENT_REQUIRED`，`resume_metrics` 报 `measurement requires a current render`，最终是实际的 `AGENT_RUN_FAILED`，不是前端伪造；
- 当前修复：后端 `/api/agent/events` 和前端 SSE 代理均在响应头后立即 `flushHeaders()`，并设置 `socket.setNoDelay(true)`，避免事件都滞留到任务结束才被 EventSource 一次性消费。
- 本轮新增根因修复：即使 SSE 即时送达，旧实现仍会把整组工具统一插入最终回答之前；现在由纯投影按真实事件时间穿插。旧实现还在 `resume_render` 后继续调用 finalize，和浏览器测量竞争同一 session lock；现在生产 run 在 render 后进入 `waiting_for_measurement`，测量完成后再由 continuation 决定是否继续。
- 本轮收口：`resume_finalize` 成功且任务状态为 `accepted` 时立即写入成功终态，避免底层流没有自然关闭造成“工具已完成但会话永远等待”；session 原子写入对 Windows 短暂锁竞争做有限重试，真实持久化错误仍会暴露。
- 本轮再次收口：同一运行组可能同时包含“暂停阶段”和“恢复阶段”，前端不能用 `some(paused)` 推断最终状态；现在以最后一个 `agent_run_finished` 终态事件为准，`success` 覆盖早先的 `paused/blocked`，避免服务端已 `idle/accepted` 而 UI 仍显示“等待测量”。

## 10. 本轮 UI 规范化收口

针对刷新后误报、重复状态入口和工具名称暴露内部实现的问题，本轮继续收口：

- `liveState.runState` 作为当前运行态单一来源，统一覆盖 `running / waiting_for_measurement / idle / failed`；SSE、session 恢复、测量回调和请求失败都先更新该状态，再驱动页面状态。
- 恢复已完成的历史 session 时，不再把旧的测量失败当成当前问题弹出；只有当前 run 处于运行或等待测量状态时，测量失败才会进入用户可见提示。
- 取消“已发送，Agent 正在处理当前会话”这类与时间线重复的 toast，过程信息只保留在 Agent 时间线，避免状态入口互相竞争。
- 工具名称继续通过统一映射展示，`workspace_material_read / read_file / write_file` 不再把内部工具名直接暴露给用户。
- 保留历史 run 的真实事件和失败记录，避免为了视觉干净而篡改诊断证据；当前 run 的成功/失败状态以本轮终态为准。

### 10.1 本轮复测记录

- `frontend/react`：`npm.cmd run typecheck` 通过；`npm.cmd run build` 通过。
- 真实浏览器路由：`http://127.0.0.1:3191/react/`。操作顺序为刷新已完成 session → 打开 Agent → 发送只读请求 → 分别观察运行中与完成后状态。
- 刷新后的预期：没有历史 `预览测量失败` toast；已有消息和工具事件仍可回放。
- 运行中的预期：出现 `Agent 工作流 · 进行中`，工具行按事件顺序出现，默认折叠；没有额外“已发送” toast。
- 完成后的预期：本轮显示 `Agent 工作流 · 9 项工具 · 完成`，工具记录保留，未出现伪造的“下一步”或空的“正在输出”消息。
- 浏览器控制台：本轮未发现新增 `error` / `warn`。

当前结论：Agent 聊天 UI 的事件时间线、运行态、工具折叠、恢复回放和错误边界已形成统一契约；历史失败仍保留在历史 run 中，这是可追踪性，不应被隐藏。后续若要进一步减少历史噪音，应独立设计 run 筛选/归档，而不是从事件流中删除失败证据。

## 11. 草稿、预览与 Agent 工具互动数据流改造方案

更新：2026-09-19
状态：已完成只读盘点，待按任务清单执行
范围：Markdown 草稿、A4 预览、真实测量、Agent 工具事件、SSE、session 持久化和 React/runtime 状态边界

### 11.1 复盘结论

当前链路不是没有数据，而是存在三套状态源：

```text
后端 session / taskRef / 文件产物
        ↕
frontend runtime liveState
        ↕
React MarkdownPane / A4Pane 本地 state
```

三套状态在正常路径上可以同步，但没有统一的版本身份和事件游标。一旦发生 Agent 暂停、SSE 重连、手动编辑与 Agent 并行、预览 render 切换或 React 组件未重新挂载，就可能出现“预览已更新、编辑器还是旧内容”“工具完成但回答消失”“测量对应的不是当前预览”等问题。

目标不是重做当前三栏布局，而是建立一条明确的数据契约：

```text
resume.md（源文件，只读基线）
   ↓
isolated draft（当前编辑事实来源）
   ↓ contentVersion
immutable render（当前预览事实来源）
   ↓ renderId
browser measurement（当前验收事实来源）
   ↓
task state / session snapshot
   ↕
Agent event stream（工具与回答的可回放时间线）
```

### 11.2 当前三条数据流

#### A. 草稿流

1. `bootstrap` 读取工作区 `resume.md`，新工作区可先初始化空白源文件。
2. 当前内容写入 `.cvagent/drafts/<taskId>/resume.md`，并生成 `contentVersion`。
3. `resume_write`、手动 Markdown 应用和 Agent 生成内容都可能写入隔离草稿。
4. 写入后 task 从 `drafting` 开始重新计算渲染依赖，旧 `renderId` 和旧测量失效。
5. 正式保存只读取已验收的隔离草稿，不覆盖源 `resume.md`。

相关实现：`frontend/react/src/features/markdown/MarkdownPane.tsx`、`frontend/react/src/runtime/workbench-runtime.js`、`backend/src/core/workspace.js`、`backend/src/core/workflow.js`、`backend/src/agent/resume-tools.js`。

#### B. 预览与测量流

1. `resume_render` 使用当前 `contentVersion + templateRevision + presentation` 生成新的 `renderId`。
2. HTML 写入 `.cvagent/renders/<taskId>/<renderId>/preview.html`。
3. 前端 iframe 加载预览，读取逐页 DOM，计算 `pageCount / occupancy / overflow`。
4. 浏览器将测量结果 POST 到 `/api/agent/measure`。
5. 后端校验测量的 `renderId` 是否仍是当前 render，然后执行 `resume_metrics → resume_finalize`。
6. 验收通过进入 `accepted`；未通过进入 `needs_revision`，生产模式可以继续下一轮 Agent 调整。

相关实现：`frontend/react/src/runtime/workbench-runtime.js`、`frontend/react/src/features/preview/A4Pane.tsx`、`backend/src/core/render.js`、`backend/src/server.js`、`backend/src/core/workflow.js`。

#### C. Agent 工具与回答流

1. 用户消息先在前端乐观显示，再由 `/api/agent/run?stream=1` 返回 `202`。
2. 后端 `runAgentTurn()` 启动 DeepAgent，工具通过 `runResumeTool()` 执行。
3. 工具生命周期发出 `tool_call_started / tool_call_succeeded / tool_call_failed`。
4. Agent 文字通过 `assistant_message_started / assistant_delta / assistant_message_finished` 实时进入 SSE。
5. 非增量事件写入 session 的 `workflowEvents`，最终消息写入 `messages.ndjson`。
6. 前端通过 `/api/agent/events` 接收事件，归约为 Agent 文本和工具时间线。
7. 生产模式在 `resume_render` 后暂停，浏览器测量通过后再启动 continuation。

相关实现：`backend/src/server.js`、`backend/src/core/tool-runner.js`、`backend/src/agent/streaming.js`、`frontend/react/src/runtime/agent-chat-state.js`、`frontend/react/src/runtime/agent-chat.js`。

### 11.3 问题清单与优先级

| 优先级 | 问题 | 影响 | 根因 |
| --- | --- | --- | --- |
| P0 | React 编辑器与 runtime 草稿状态分离 | Agent 已写新草稿时，Markdown 仍显示旧内容；再次应用可能覆盖 Agent 结果 | `MarkdownPane` 只在挂载时初始化 `useState(content)`，没有按 `contentVersion` 同步 |
| P0 | Agent 在 render 后暂停时没有持久化当前回答 | 等待 A4 测量或恢复 session 后，已显示的回答可能消失 | `runAgentTurn()` 的暂停分支没有把 `streamed.result.messages` 或部分回答写入 session |
| P0 | SSE 断线期间的 assistant delta 无法回放 | 工具事件能恢复，回答文字中间出现缺口 | `assistant_delta` 只实时发送，不进入持久化事件或可恢复的运行快照 |
| P1 | 预览接口没有显式校验 `renderId` | iframe 可能展示新旧 render 混合内容，测量和画面身份不一致 | `/api/agent/preview` 只接收 `sessionId`，直接读取 session 当前 render |
| P1 | SSE 订阅与历史回放之间有竞态窗口 | Agent 在加载 session 后、订阅前启动时，事件可能漏掉 | 当前顺序是先读取快照，再 `subscribe()`，没有事件游标 |
| P1 | 事件去重键不稳定 | 同毫秒、同内容的连续 delta 可能被错误去重 | 前端用 timestamp 和 delta 拼键，没有 `eventId / sequence` |
| P1 | 预览页翻页、缩放控件没有接数据流 | UI 看起来可用，实际按钮无行为 | `renderPreview()` 只生成控件，没有页码和缩放状态管理 |
| P1 | 手动编辑与 Agent 运行没有语义互斥 | 请求虽被锁串行执行，但用户不知道谁会覆盖谁 | 后端只有 session 锁，没有前端 mutation 状态和版本冲突提示 |
| P2 | 事件最多保留 240 条且无分页 | 长会话可能丢失运行起点，历史工具组无法回放 | `workflowEvents` 和前端事件数组都使用固定截断 |
| P2 | 日志存在重复工具成功记录 | 调试日志统计可能把一次工具调用算成两次 | `runResumeTool` 的成功事件与 `sessionToolPersistence` 都写入 session 事件日志 |
| P2 | 服务端仍生成非模型的 reasoningSummary | 后续若直接渲染，容易再次出现“下一步/思路摘要”伪输出 | `workflowProgress()` 将工具事件拼成解释性文本 |

### 11.4 目标统一契约

#### 版本身份

所有草稿、预览和测量必须携带同一个可追踪身份：

```ts
type ArtifactIdentity = {
  sessionId: string
  runId: string
  taskId: string
  contentVersion: string
  templateRevision: string
  renderId: string
}
```

规则：

1. 草稿变化必须生成新的 `contentVersion`。
2. 模板或版式变化必须生成新的 `templateRevision` 或 presentation revision。
3. 每次渲染必须生成新的 `renderId`。
4. 测量只能提交当前 `renderId`，预览也必须请求当前 `renderId`。
5. 任意旧版本回调只能被记录，不能修改当前 task 状态。

#### 事件身份

现有事件需要补充稳定的事件序号：

```ts
type AgentEventEnvelope = ArtifactIdentity & {
  eventId: string
  sequence: number
  timestamp: string
  event: string
  toolCallId?: string
  messageId?: string
}
```

`eventId` 用于幂等去重，`sequence` 用于断线续传和排序，不能继续用文本内容与毫秒时间戳推断唯一性。

#### 状态所有权

- 后端 session/task：持久化事实来源，负责 task state、当前 render、当前 measurement、运行终态。
- Agent event stream：运行过程事实来源，负责工具和回答的时间顺序。
- 前端 runtime：只做事件归约和页面协调，不另造一套业务状态。
- React Markdown/A4：改为受控视图，内容和版式通过 `contentVersion / presentationRevision / renderId` 同步；不在组件内部长期持有脱离 session 的副本。

#### 流式回答与恢复

- `assistant_delta` 继续实时传输，不把私有 reasoning 原文发送给用户。
- 用户消息在 run 开始前持久化，避免失败后用户消息消失。
- assistant 内容在结束、暂停、失败时至少写入一次可恢复快照。
- SSE 重连按 `lastSequence` 回放缺失事件；如果 delta 已被压缩，则回放当前 assistant 快照。
- 工具事件保持结构化，不把工具内部 prompt、简历正文或私有 reasoning 写入日志。

### 11.5 修改任务清单

- [ ] 1. 建立统一 `ArtifactIdentity` 和 `AgentEventEnvelope`，后端生成 `eventId / sequence`。
  - 覆盖 `publishWorkflowEvent()`、session store、SSE broker。
  - **验收：** 同一事件重放幂等；同毫秒相同 delta 不丢失。
  - _对应问题：P1 事件竞态、P1 事件去重_

- [ ] 2. 补齐 Agent 消息持久化边界。
  - run 开始保存用户消息；暂停/失败保存 assistant 当前快照；成功保存最终消息。
  - **验收：** render 后暂停、工具失败、服务重启后，用户消息和已生成回答仍可恢复。
  - _对应问题：P0 暂停回答丢失、P0 SSE 断线缺口_

- [ ] 3. 改造 SSE 为“订阅后回放 + 游标续传”。
  - 连接建立时先注册 subscriber，再回放指定 sequence 之后的事件。
  - 客户端保留最后已确认 sequence，自动重连不重复、不漏事件。
  - **验收：** 人为断开 SSE 后重新连接，工具和回答均能补齐。
  - _对应问题：P0 delta 不可恢复、P1 订阅竞态_

- [ ] 4. 收拢 React 与 runtime 的状态同步。
  - MarkdownPane 接收 `contentVersion` 并按版本更新内容。
  - A4Pane 接收 `presentationRevision / renderId` 并同步布局和图标参数。
  - 禁止 Agent 生成新草稿后，编辑器继续保留旧 value。
  - **验收：** Agent 写入草稿后，Markdown、预览和 session API 三者内容版本一致。
  - _对应问题：P0 双状态源_

- [ ] 5. 让预览接口使用精确 render 身份。
  - `/api/agent/preview` 接收 `sessionId + renderId`，服务端校验并读取对应不可变产物。
  - iframe URL、测量请求、SSE `render_succeeded` 使用同一 `renderId`。
  - **验收：** 连续快速渲染两个版本，旧 iframe 的测量和内容不能覆盖新版本。
  - _对应问题：P1 预览 render 错位_

- [ ] 6. 为手动编辑、版式调整和 Agent 运行增加 mutation 状态。
  - 明确 `idle / agent_running / manual_mutation / waiting_measurement / failed`。
  - 冲突操作要么禁用，要么明确排队并显示目标版本。
  - **验收：** Agent 运行中点击手动应用，不会静默覆盖，并能看到排队或拒绝原因。
  - _对应问题：P1 语义冲突_

- [ ] 7. 完成预览页真实交互。
  - 页码、翻页、缩放和重新渲染绑定当前 render，不使用无状态按钮。
  - **验收：** 两页简历可以独立翻页；缩放只改变视图，不改变 render 和测量身份。
  - _对应问题：P1 死控件_

- [ ] 8. 清理日志和回放边界。
  - 区分实时事件、审计事件、消息快照，不重复计数工具成功。
  - 将固定 240 条改成按 cursor 分页或按 run 分段读取。
  - **验收：** 长会话可以完整读取指定 run；日志中的工具数量和 UI 数量一致。
  - _对应问题：P2 截断、P2 重复日志_

### 11.6 验收矩阵

| 场景 | 预期结果 |
| --- | --- |
| 手动修改 Markdown 并应用 | 草稿产生新 `contentVersion`，预览产生新 `renderId`，测量只接受新版本 |
| Agent 写入隔离草稿 | Markdown 编辑区、预览、session API 显示同一内容版本 |
| Agent render 后暂停 | 已输出回答和用户消息保留，状态显示等待测量，不显示失败 |
| SSE 中途断开 | 重连后按 sequence 补回工具和回答，不重复、不漏事件 |
| 连续快速渲染 | 旧 iframe 回调被拒绝，新 render 独占当前 task 状态 |
| Agent 执行时手动编辑 | 显示冲突/排队状态，不发生静默覆盖 |
| 两页完整预览 | 翻页和缩放有效，预览页面与测量 renderId 一致 |
| 服务重启后打开会话 | 草稿、当前 render、测量、工具事件和已生成回答可恢复 |
| 工具失败后重试成功 | 历史失败保留，最终 run 状态以最后终态为准，不伪造成功工具 |

### 11.7 非目标与边界

- 不重写当前三栏工作台，不因为数据流治理改动既有布局结构。
- 不把私有链式推理原文作为用户聊天内容或日志内容；用户可见的是助手回答增量、工具状态和必要结果摘要。
- 不删除历史失败事件；通过 run 分组、筛选和归档降低噪音。
- 不继续用前端 toast、伪造“下一步”或静态工具列表掩盖真实事件缺失。
- 不在本轮文档阶段修改代码；代码执行必须按任务清单逐项完成并补自动化与真实浏览器验收。

### 11.8 执行门槛

本方案确认后再开始代码修改。每完成一项任务，必须同时补：

1. 对应的状态/事件测试；
2. 真实 API 或 SSE 集成测试；
3. 真实浏览器截图验收；
4. 日志中可用 `sessionId + runId + eventId + sequence` 反查；
5. 文档中的任务状态和验收记录。
