# CVAgent Agent 聊天数据流对接复盘

更新：2026-09-19  
状态：复盘发现 P0 数据流问题，当前不得标记为完成

> 本文在原有对接记录上追加一次真实会话故障复盘。第 11 节之后的结论优先于前文“本轮实现完成”的表述：当前 sequence、SSE replay 和消息预保存虽然已经落地，但还没有完成多轮会话的事实归并，也没有完成旧渲染逻辑退役。

## 1. 本次对接目标

让用户看到的聊天、工具执行时间线、A4 测量暂停和会话恢复保持一致。核心要求不是把所有事件都展示出来，而是任何一次刷新、断线、暂停、自动 continuation 或最终完成，都不能让当前轮消息回退或漏掉。

## 2. 现状判断

当前实现不是 DeepAgent 单一消息流，而是：

- Agent 最终消息：`session.messages`，保存到 `messages.ndjson`；
- 工具与状态过程：`session.workflowEvents`，通过 SSE 和 session 快照传输；
- 当前浏览器临时数据：`liveState.messages` 与 `liveState.agentEvents`。

这种职责分离本身符合 Agent 产品的常见做法。本轮确认并修复了以下不稳定点：

1. paused 和 complete-after-finalize 提前返回时，最终消息没有统一写回 session；
2. 用户消息只存在 Agent 的临时 input 中，执行中刷新会丢失；
3. workflow event 没有 sequence，SSE 重连只能依赖时间戳和有限窗口；
4. SSE 回放与实时订阅之间存在窗口，前端终态同步会丢掉后到的刷新请求；
5. 前端只依赖 delta 事件渲染当前回答，delta 暂时缺失时会出现空回答。

## 3. 本轮实施原则

- 不改变简历工具、A4 验收和权限业务；
- 不借数据流修复重做聊天视觉；
- 以 sequence、runId、messageId 和 toolCallId 作为事实身份；
- 让 paused、failed 和正常完成都经过同一套消息归并；
- 保留历史失败和工具证据，避免为了“看起来干净”删除诊断事实。

## 4. 验收口径

本轮已证明：

- 用户消息在 Agent 开始执行前可恢复；
- paused 后读取 session 仍包含当前轮消息；
- SSE 自动重连不会重复工具，也不会漏掉断点之后的事件；
- 自动 continuation 完成后不会被上一轮同步请求覆盖；
- 现有前端布局和 A4 预览未因本轮数据流改动回退；
- backend 72 项测试、前端 typecheck/build 均通过；
- 本地浏览器已打开工作台并验证了工作区、Markdown 编辑区、A4 预览和 Agent 抽屉的可见链路。

仍需后续专项验证：浏览器在真实生产 Agent 执行中主动断开再重连时，delta 之前已经渲染的部分只能依赖当前页面内存；完整刷新后的回答以最终消息快照为准，不把每个 token 写入磁盘。

## 5. 草稿、预览与 Agent 工具流补充盘点

### 5.1 草稿链路

草稿不是单一的“编辑器文本”，而是由源文件、隔离草稿和渲染输入共同组成：

```text
工作区 resume.md
    ↓ 读取/创建内容版本
任务隔离草稿 .cvagent/drafts/<taskId>/resume.md
    ↓ Agent 工具修改或人工编辑
contentVersion / draftVersion
    ↓ 作为一次渲染输入
renderId
```

当前风险是 React 编辑器仍保有自己的本地文本状态。Agent 写入隔离草稿后，如果没有收到明确的版本更新，编辑器可能继续显示旧内容；人工编辑和 Agent 同时修改时，也可能出现“界面看起来成功、下一次读取又回退”的错觉。

### 5.2 预览与真实测量链路

预览不是 Agent 直接返回的字符串，而是一个需要浏览器参与的闭环：

```text
resume.md
    → render(resume, template)
    → .cvagent/renders/<taskId>/<renderId>/preview.html
    → iframe 加载
    → 浏览器测量 pageCount / occupancy / overflow
    → /api/agent/measure
    → resume_metrics
    → resume_finalize
```

因此 `renderId`、模板版本和草稿版本必须绑定。当前预览读取路径只按 session 找“当前 render”，不够支持断线恢复和历史结果核对；测量事件也不能只依赖最新快照，否则会把旧测量误套到新渲染上。

### 5.3 Agent 聊天与工具链路

目标链路应当是同一条有序事件流，而不是“工具列表”和“最终回答”两套互不相干的 UI 数据：

```text
用户消息
    → 创建 runId，并持久化 user message
    → DeepAgent streamEvents
        ├─ assistant delta
        ├─ tool started / tool result / tool failed
        ├─ pause（例如等待 A4 测量）
        └─ final / failed
    → workflow event 持久化并通过 SSE 推送
    → 前端按 sequence 归并消息、工具卡片和 run 状态
```

工具过程默认折叠，只保留工具名、结果状态和耗时等摘要；展开后查看参数、结果和错误。它们是同一轮 Agent 事实的不同呈现，不应在请求结束时消失，也不应靠前端临时数组重建。

## 6. 当前工作树改动与复盘边界

当前工作树已经有一组未提交的后端数据流改动，方向包括：

- 为 workflow event 增加 `sequence`，支持按断点读取；
- 在 Agent 执行前保存用户消息；
- 在 paused、failed 和提前结束路径统一捕获 Agent 消息；
- SSE 使用 `Last-Event-ID` 尝试补发断点后的事件。

这些改动只能记为“实施中”，不能直接视为完成。还需要验证：

1. SSE 订阅与历史补发之间不存在事件竞态；
2. assistant delta 断线后有明确的恢复策略，不会只存在于浏览器内存；
3. 前端以 `eventId / sequence / messageId` 去重，而不是用时间戳和文本猜测；
4. 自动 continuation 不会用旧 session 快照覆盖新消息；
5. `renderId`、`draftVersion` 和测量结果不会串线；
6. 现有 React 编辑器和 A4 面板能跟随外部版本更新，不继续持有陈旧状态。

## 7. 修改后的统一设计

### 7.1 统一事实身份

每个 Agent 运行至少携带：

- `runId`：一次用户请求及其自动 continuation 的身份；
- `sequence`：workflow event 的单调序号；
- `messageId`：用户消息和 assistant 消息的持久化身份；
- `toolCallId`：一次工具调用的开始、结果和失败关联键；
- `draftVersion` / `renderId`：草稿输入和预览结果的版本身份。

所有接口、SSE 事件和前端 reducer 都使用这些身份，不用数组位置作为关联依据。

### 7.2 统一前端状态归并

前端只保留一套可恢复的会话状态：

```text
session snapshot
    + SSE replay events
    + live events
    → normalize
    → dedupe by stable identity
    → ordered run timeline
```

React 组件只消费归并后的状态。编辑器、预览和 Agent 面板不能各自维护一份互相覆盖的“当前内容”；局部 UI 状态只允许保存展开/收起、滚动位置和输入草稿。

### 7.3 失败与暂停的用户语义

- `paused`：表示等待外部事实或用户动作，不是失败；保留当前轮消息和已完成工具。
- `failed`：表示本轮执行失败；保留失败工具、错误码、runId 和可诊断上下文。
- `completed`：表示 Agent 已结束本轮；若还有自动 continuation，状态应明确为 continuation 中，不能提前显示完成。

UI 不生成虚假的“下一步”或“思路摘要”。只有模型真实输出、真实工具事件和后端真实状态才可进入会话记录。

## 8. 修改任务与验收矩阵

| 优先级 | 修改项 | 验收方式 |
| --- | --- | --- |
| P0 | 统一保存用户消息和 Agent 结果消息 | 新会话、工具成功、工具失败、暂停后刷新，消息均不丢失 |
| P0 | SSE sequence、断点补发、稳定去重 | 发送期间刷新/断网重连，工具顺序不重复、不缺失 |
| P0 | 前端 timeline reducer | 工具事件与 assistant 文本按真实发生顺序穿插显示 |
| P0 | 消除旧事件覆盖新状态 | 自动 continuation 完成后，页面不回退到旧回答 |
| P1 | 草稿版本与编辑器外部同步 | Agent 写入后编辑器更新；人工未提交内容不被静默覆盖 |
| P1 | renderId 与测量结果绑定 | 两次快速渲染不会把上一版测量写到下一版 |
| P1 | 预览恢复接口支持精确 renderId | 刷新后仍能打开本轮实际预览，而不是只打开当前最新结果 |
| P1 | 工具卡片默认折叠、可展开 | 默认只显示摘要，展开可查看真实输入、输出和错误 |
| P2 | workflow 日志查询分页与过滤 | 长会话可按 runId、toolCallId、sequence 定位问题 |
| P2 | 前端/后端诊断字段统一 | 日志能关联浏览器事件、SSE 事件、工具调用和渲染任务 |

## 9. 非目标与执行门槛

本次不以重做当前三栏交互结构、替换 UI 框架或增加更多解释性文案为目标；也不通过隐藏工具、伪造“已完成”或生成摘要来掩盖链路问题。执行顺序固定为：

1. 先补数据流单元测试和失败路径测试；
2. 再收敛后端事件持久化、SSE replay 和前端 reducer；
3. 再处理草稿/预览版本同步；
4. 最后用真实浏览器完成新会话、工具调用、暂停测量、刷新重连和失败恢复验收。

任何一项 P0 验收失败，都不能把本轮标为“完成”；必须在 UI 上显示真实的 paused 或 failed 状态，并保留可追踪日志。

## 10. 本轮落地记录

### 10.1 后端

- `runAgentTurn()` 在用户轮次开始时先把 user message 放入 session；模型只返回 assistant 时，会与已有输入消息合并，避免覆盖历史。
- 正常完成、等待测量和 finalize 提前完成都调用同一套消息捕获逻辑；measurement continuation 的内部指令不会写进用户会话。
- `session.workflowSequence` 为非 delta workflow event 分配单调序号；事件同时进入 session 快照和 `events.ndjson`，delta 只作为实时传输。
- SSE 使用 `Last-Event-ID` 读取序号之后的持久化事件，并在读取历史前先注册订阅，避免回放窗口丢事件。
- session workflow 快照和前端归并窗口从 240 扩大到 2000，避免长工作流丢失 `agent_run_started` 边界；完整历史仍保留在事件日志中。

### 10.2 前端

- `mergeWorkflowEvents()` 以 sequence 去重并优先按 sequence 排序；旧 session 没有 sequence 时继续使用兼容键。
- SSE 回放与实时事件重复到达时，在变更 run 状态前先去重，避免重复的 run-start 清空当前回答。
- paused 终态同步与 failed 一样保留当前轮；同步请求进行期间到达新的终态会排队一次最新同步，不再丢弃。
- 当前页面内已经累积的 assistant 文本在 delta 缺失时会生成临时渲染兜底，最终仍以服务端消息快照为准。
- 前端代理透传 `Last-Event-ID`，否则浏览器在 3191/3192 代理层自动重连时无法把游标交给后端。

### 10.3 验收证据

| 检查项 | 结果 |
| --- | --- |
| backend 全量测试 | 72/72 通过 |
| 前端 typecheck | 通过 |
| Vite production build | 通过 |
| 用户消息执行中可恢复 | 集成测试通过 |
| continuation 内部指令不进入会话 | 集成测试通过 |
| sequence cursor 回放 | session store 测试通过 |
| 前端代理透传 Last-Event-ID | contract 测试通过 |
| 本地浏览器工作台/A4/Agent 抽屉 | 已打开并目视检查 |

### 10.4 未在本轮扩大范围的事项

- 不把 assistant delta 逐 token 落盘，避免日志膨胀；若进程在最终消息生成前退出，页面内的部分回答不能跨完整刷新恢复。
- 不在本轮引入 Redis、消息队列或多实例 broker；当前事件 broker 仍是单进程边界。
- 不把 UI 视觉重构与本轮数据流治理混在一起，避免回归难以定位。

## 11. 真实会话故障复盘（2026-09-19）

### 11.1 用户可见现象

用户在 Agent 抽屉中看到以下异常：

- 旧的 `47 项工具` 工作流出现在当前用户消息前面；
- 当前用户消息与当前 Agent 回复没有形成一个连续回合；
- 当前回复出现重复渲染；
- 页面显示 Agent 仍在运行，但工具实际上已经失败；
- 刷新后旧的用户/Agent 对话内容消失，只剩工具流水和当前回复。

### 11.2 日志证据

本次 session：

```text
session_1b690ace-1d0d-4f1e-8d4d-6a3ca2954102
```

本地时间线（日志为 UTC，以下换算为 UTC+8）：

| 时间 | 事实 | 结论 |
| --- | --- | --- |
| 14:54:22 | 生产模式 Agent run 开始 | 正常启动 |
| 14:55:10 | 首轮生产 run 暂停等待测量 | 这是预期的业务暂停 |
| 14:55:11 | 自动 continuation 开始 | 进入第二个执行阶段 |
| 14:55:25 | `presentation_suggest` 失败，`MEASUREMENT_REQUIRED` | 工具已失败 |
| 14:55:25 之后 | 没有对应的 `agent_run_finished` | 后端运行没有正常收口 |
| 14:56:52 | session 恢复时被标记为 `session_interrupted` | 说明此前确实存在悬挂执行 |
| 15:07:40 | 用户发送 `·1` | 新一轮聊天开始 |
| 15:07:46 | 新一轮 `agent_run_finished(outcome=success)` | 当前 chat run 本身正常结束 |

同一个 session 的 workflow 分组实际是：

```text
旧生产 run       47 个工具，暂停
自动 continuation  7 个工具，工具失败且无终态
当前 chat run      1 个工具，成功
```

因此“卡死”并不是错觉：旧 continuation 在工具失败后没有产生终态。当前 15:07 的聊天请求后来是正常完成的，但它复用了包含旧悬挂 workflow 的同一 session。

### 11.3 消息持久化证据

当前 `messages.ndjson` 中可以恢复当前这一轮的输入和 Agent 输出，但不能恢复旧生产轮的完整用户/Agent 对话。旧轮只剩 workflow 事件，且 assistant delta 没有持久化，因此无法仅靠事件日志还原完整聊天正文。

这意味着当前实现同时存在两种事实：

```text
消息事实：messages.ndjson
工具事实：events.ndjson / workflowEvents / SSE
```

但两者之间没有持久化的 turn 关联键，历史事件无法可靠归属到具体用户消息。

### 11.4 前端渲染证据

当前前端在 `agent-chat.js` 中按 workflow group 的数组序号关联消息：

```js
const groupForTurn = groupIndex < groups.length ? groups[groupIndex] : null
```

这不是业务身份，只是当前数组的相对位置。当消息只有当前一轮、workflow 却包含历史生产 run、自动 continuation 和当前 chat run 时，渲染器会产生：

```text
当前用户消息
→ 旧 47 工具工作流
→ 当前最终 Agent 消息
→ 旧 7 工具工作流
→ 当前 1 工具工作流
→ 当前 Agent delta 再渲染一次
```

所以本次不是“消息没进后端”，而是“消息和 workflow 在前端被错误拼接”。

## 12. 根因判断

### P0-1：执行身份和会话身份混用

当前上下文中的 `runId` 实际上贯穿同一个任务 session，不能单独标识每一次用户回合或自动 continuation。前端再用本地序号切组，导致历史 run 和当前 run 只能靠推断关联。

### P0-2：工具失败没有终态不变量

工具失败后必须保证：

```text
tool_call_failed
→ agent_run_finished(outcome=failed)
→ session.runState=failed
→ SSE 通知终态
```

当前自动 continuation 没有满足这个不变量，服务恢复时才通过 `session_interrupted` 兜底。

### P0-3：消息、delta、workflow 三套来源没有单一归并器

最终 assistant 消息来自 session snapshot，实时回答来自 SSE delta，工具流来自 workflow events。当前前端在多个位置分别追加和刷新它们，导致最终消息和实时消息重复，也导致历史工作流插入当前 turn。

## 13. 本轮继续实施与真实浏览器复核（2026-09-19）

### 13.1 已完成的修复

- 前端 `eventGroups()` 改为优先按稳定 `runId` 分组。同一个 run 在 A4 测量暂停、自动 continuation 和最终收口之间不再按多个 `agent_run_started` 拆成多张工作流卡；没有 `runId` 的旧事件继续使用旧的 start-based 兼容分组。
- `runAgentTurn()` 的开始、暂停、成功和提前完成终态都显式携带本轮 runId；异常对象也会带回本轮 runId，统一失败收口不会再退回 task context 的旧 runId。
- Agent 失败路径统一写入 `agent_run_finished(outcome=failed)`、`session.runState=failed` 和 SSE 终态，失败工具仍保留在工作流时间线中。
- 新增前端回归测试，验证同一 runId 的暂停/续跑只产生一条工作流卡片；后端全量测试由 70 项增至 71 项并全部通过。

### 13.2 真实浏览器复核结果

重新构建 Vite 产物并刷新 `http://127.0.0.1:3191/react/` 后，旧会话的可见时间线从“同一任务拆成多张卡片”收敛为；随后又创建了一个干净 session 做独立验收：

```text
旧用户消息
  → 旧 run 的 55 项工具（一张可折叠工作流卡）
  → 当前用户消息
  → 当前 run 的读取工具（一张可折叠工作流卡）
  → 当前 Agent 回答
```

工具行默认折叠，刷新后仍保留；当前 A4 iframe 继续按 `sessionId + renderId` 加载，真实测量状态仍可见。

干净 session 的真实结果为：发送只读请求后出现 2 个真实工具、随后出现 Agent 一句话回答；刷新并重新打开 Agent 后，用户消息、2 个工具行和最终回答都仍在，页面没有 `AGENT_RUN_FAILED`。

### 13.3 尚未宣称完成的验收

- 干净新会话已完成“发送 → 工具出现 → Agent 回答 → 刷新恢复”浏览器验收；执行中约 250ms 时已经出现真实工具卡，工具默认折叠，最终回答随后进入同一轮。
- 已用注入失败 Agent 覆盖服务端失败终态：`agent_run_finished(outcome=failed)`、当前 `runId` 和 `session.runState=failed` 均能在恢复接口中读回；真实浏览器失败样式仍建议在后续 UI 专项中补一张截图。
- 断网重连的 delta 只能恢复最终消息快照，未把每个 token 落盘的设计仍保持不变。

### P1-1：历史事件可见，但历史对话不可恢复

保留工具诊断事实是正确的，但如果没有 turn/message 归属，历史工具流只能成为孤立流水，不能继续作为用户可读的对话记录。

## 14. 工程决策：停止无期限增量，进入收敛式重构

从本节开始，CVAgent 的跨模块改动必须遵守“先迁移、后删除”的收敛规则。新增兼容逻辑只能是临时迁移手段，不能成为永久架构。

### 14.1 允许的增量

只有满足以下条件，才允许先新增：

1. 新实现有明确的替代目标和删除边界；
2. 新旧路径不会同时成为事实来源；
3. 有对应的迁移测试；
4. 文档中记录删除条件和预计删除任务；
5. 新实现验证通过后，必须在同一特性周期内删除旧路径。

### 14.2 禁止的增量

以下方式不得继续使用：

- 在旧 renderer 上继续叠加特殊分支；
- 为了兼容历史状态无限增加 fallback；
- 同时从 snapshot、SSE、local state 追加同一条消息；
- 用数组下标、文本内容或时间戳猜测业务关联；
- 工具失败后只更新某个局部状态，不发出 run 终态；
- 新旧 API、旧前端入口或旧数据模型长期并存但没有退役日期；
- 测试只验证“新增功能能工作”，不验证旧路径已经删除。

### 14.3 每次跨模块改动的强制流程

```text
盘点事实来源
    ↓
定义唯一模型和身份键
    ↓
写迁移/回归测试
    ↓
接入新实现
    ↓
迁移全部调用方
    ↓
删除旧实现和兼容分支
    ↓
全局搜索残留引用
    ↓
构建、单测、浏览器验收
```

代码 review 不能只问“新功能能不能跑”，还必须回答：

- 哪一段旧代码被替代？
- 哪些调用方已经迁移？
- 哪些旧文件、旧分支、旧状态字段已删除？
- 如果暂时不能删，删除条件和期限是什么？

## 15. 本次必须删除和重构的范围

### P0：会话数据模型

增加稳定的：

- `turnId`：一次用户会话回合；
- `runId`：一次实际执行尝试；
- `messageId`：用户消息或 assistant 消息；
- `toolCallId`：工具调用生命周期；
- `sequence`：事件顺序。

自动 continuation 必须复用原 `turnId`，但生成新的 `runId`。不能再用 session/task 的长期身份替代单轮执行身份。

### P0：前端 timeline renderer

重写为单一 reducer：

```text
session snapshot
+ replay events
+ live events
→ normalize
→ dedupe
→ group by turnId
→ render
```

完成后删除：

- `groupIndex` 关联消息和工作流的逻辑；
- 按数组位置插入 workflow 的 fallback；
- assistant snapshot 与 delta 的重复渲染路径；
- 无法判断归属时默认插入当前 turn 的逻辑。

### P0：工具过程的 Codex 式折叠呈现

每个用户 turn 的可见结构固定为：

```text
用户消息
按真实 sequence 发生的 Agent 状态、工具调用和阶段性内容
最终 Agent 回复
```

工具过程不是独立聊天消息，也不能把几十项工具直接铺满主阅读流。它属于当前 turn 的过程轨迹：

- 默认收起，只显示当前阶段、工具数量和整体状态；
- 用户主动展开后，按真实 sequence 查看工具名称、耗时、成功或失败摘要；
- 工具仍在执行时，收起状态使用极轻的渐变/呼吸动效表示“正在调用工具”，不显示大量重复行；
- 工具完成后，动效停止并保留稳定的完成摘要；
- 工具失败、暂停或等待测量时，折叠摘要必须显示真实状态；
- 展开/收起只属于 UI 局部状态，不得改变 session、turn、run 或消息事实；
- 刷新和 SSE 重连后，工具是否展开可以恢复为默认收起，但工具结果和终态不能丢失。

**时间顺序是最高优先级。** Renderer 不得按“先渲染所有用户消息，再渲染所有工具，再渲染所有 Agent 回复”的类型分组，也不得把旧 workflow 插入当前消息之前。必须按照事件的 `sequence`，在同一个 `turnId` 内保留真实发生顺序：

```text
t1 用户消息
t2 Agent 开始处理
t3 工具 A 调用 / 结果
t4 Agent 阶段性状态或文本
t5 工具 B 调用 / 结果
t6 Agent 最终回复
```

连续的工具阶段在视觉上可以收纳成折叠块，但这不是“每个用户回合最多一个工具块”的规则。只要有真实的阶段性 Agent 文本把两个工具阶段隔开，就允许出现多个折叠块；如果中间只有空的 `assistant_message_started/finished` 生命周期事件，不能因此制造空白块或额外间距。折叠只是展示压缩，不是时间顺序重排。折叠块内部仍必须保留真实 `sequence`；如果阶段性 Agent 文本和工具调用交错发生，展开后也必须按真实顺序呈现。

这意味着 renderer 必须先按 turnId 归并消息和工具轨迹，再把工具轨迹作为该 turn 内的可折叠过程块渲染，不能把 workflow group 直接当成聊天消息插入主时间线。

### P0：执行终态

统一所有异常、暂停、成功和自动 continuation 的终态处理。工具失败后不得让 session 长期处于 `running`，服务恢复只能作为兜底，不得作为正常状态机。

### P1：历史消息恢复

最终 assistant 消息必须持久化为完整可恢复记录。delta 可以继续只做实时传输，但不能依赖 delta 作为刷新后唯一的正文来源。

### P1：开发期旧 session 处理

当前仍处于开发阶段，不为旧 session 增加迁移兼容层。数据流重构切换前直接清空开发环境的 `.cvagent/sessions/*`，保留工作区源文件、模板、渲染产物和诊断日志。新 session 从 `turnId` 模型重新创建。

禁止把旧 session 的孤立 workflow 强行拼到新消息前面，也禁止为了“保留历史”伪造用户消息正文。未来进入需要保留用户数据的阶段后，再单独设计版本化迁移，不在本次重构中埋入永久兼容代码。

## 16. 新的完成标准

本项数据流重构只有同时满足以下条件，才允许标记完成：

| 检查项 | 必须满足 |
| --- | --- |
| 多轮顺序 | 用户消息、工具流、Agent 回复按真实 turn 顺序展示 |
| 历史恢复 | 刷新后旧消息和当前消息都可恢复 |
| SSE 重连 | 不重复、不漏事件，不改变已有 turn 归属 |
| 工具失败 | 失败后必有 `agent_run_finished`，页面不再显示运行中 |
| 自动 continuation | 属于原 turn，不创建孤立的第二段聊天 |
| assistant 去重 | delta 与最终消息只显示一条 |
| 工具过程呈现 | 工具默认收起，可手动展开；执行中只有轻量渐变状态，完成后保留摘要 |
| session reset | 重构前旧开发 session 已清空，新 session 全部使用新数据模型 |
| 删除验证 | 旧 renderer、旧关联逻辑和临时 fallback 已删除 |
| 浏览器验收 | 新会话、刷新、断线、失败、暂停、恢复全部实测通过 |

未达到以上标准前，不能再通过增加 UI 条件分支来“修正显示效果”，也不能把状态文案改成完成来掩盖数据流未收口。

## 17. 市场方案调研结论（2026-09-19）

### 17.1 结论

本方案不是闭门造车。它与当前成熟 Agent 产品和 Agent SDK 的共同方向一致：

1. **一次用户回合包含多个工具调用，但最终收敛为一个可恢复的 Agent 回合**；
2. **事件流使用结构化语义事件，而不是让前端从文本或数组位置猜测状态**；
3. **工具过程采用 progressive disclosure（渐进披露）**：主阅读流保持干净，细节按需展开；
4. **执行过程可持久化、可重放、可重连**，刷新后仍能恢复同一回合和终态。

OpenAI 对 Codex Agent Loop 的公开描述是：模型可以返回最终回答，也可以请求工具调用；工具结果追加回上下文，循环继续，并最终以 assistant 消息结束。也就是说，“用户消息 → 多次工具调用 → 最终回答”本身就是成熟 Agent 的基本执行模型，而不是本项目特有的设计。

OpenAI 对 Codex Harness 的公开说明还强调了 thread 生命周期、事件历史、客户端重连，以及由 App Server 把底层事件转换为稳定的 UI 事件流。这直接支持本项目正在采用的 `turnId/runId/messageId/toolCallId/sequence` 和“snapshot + replay + live event → reducer”的方向。

### 17.2 与市场做法的对照

| 市场通用做法 | 本项目方案 | 判断 |
| --- | --- | --- |
| 一个 turn 内允许多轮 tool call，最后由 assistant 终止 | `turnId` 归并多个 `runId`，最终 assistant 作为回合终点 | 对齐 |
| 工具调用、工具结果、消息完成使用语义事件 | `tool_call_started/succeeded/failed`、assistant 完成、run 终态 | 对齐，需继续删除文本推断和数组位置推断 |
| 支持流式 delta，同时保存可恢复的最终消息 | delta 仅实时传输，最终 assistant 正文持久化 | 对齐 |
| 刷新、断线、后台运行后可恢复执行轨迹 | snapshot、replay、live event 合并并去重 | 方向正确，当前实现仍需落地 |
| 默认只展示结果，工具详情按需展开 | 工具过程默认收起，展开查看名称、耗时、结果和错误 | 对齐 |
| 运行中显示明确但克制的状态，完成后停止动效 | 轻量渐变/呼吸动效 + 稳定终态摘要 | 对齐；动效只是表现，不能作为状态事实 |
| 长任务需要区分 running、waiting、failed、complete | `running/waiting/failed/paused/complete` | 对齐，必须保证每个路径都有终态 |

OpenAI Agents SDK 的流式事件也区分了原始响应 delta 和高层运行项，例如工具调用、工具输出、消息创建等事件；Anthropic 的工具流式接口同样把工具使用、工具结果和错误作为可解析的独立事件。由此可见，前端应该消费稳定的事件模型，而不是根据“出现了几段文字”重建 Agent 状态。

### 17.3 需要修正的一点：不要固定渲染两个 AI 气泡

当前文档中的可见结构是正确方向，但不能把“AI 阶段性状态”和“AI 最终回答”机械实现为两个固定的 assistant 聊天气泡，否则会重新制造重复回答和时间顺序歧义。

更准确的实现规则是：

```text
用户消息
Agent 回合时间线
  ├─ 按 sequence 展示阶段性状态和工具过程
  └─ 工具完成后展示最终回答
```

如果后端确实产生了有业务含义的阶段性 assistant message，它可以按真实 `sequence` 出现在工具前或工具之间；但不能为了填充 UI，人为复制一条“当前 AI 消息”。最终回答也必须以实际完成事件为准。中间的思考、工具调用、阶段性状态属于同一个 Agent 回合，不应被数组位置或消息类型重新排序。

### 17.4 对 CVAgent 的产品取舍

成熟产品通常把“结果”放在主阅读流，把“过程”放在可折叠的状态块或任务面板中。对于 CVAgent，右侧 Agent 抽屉已经承担辅助职责，因此优先采用 **当前 turn 内联的可折叠工具轨迹**，而不是再增加一个永久显示的工具侧栏：

- 未展开时，用户只看到自己的请求、Agent 当前状态和最终结果；
- 运行中只展示“正在读取简历 / 正在重新渲染”等低噪声状态；
- 展开后才查看工具名称、耗时、结果摘要、错误和 sequence；
- 工具失败或等待用户/测量时，状态必须可见，并解除输入区的假死；
- 对可能产生外部影响的动作，沿用明确的确认状态，不用“采纳建议”“打开预览”等泛化按钮堆叠主流程。

### 17.5 研究后的验收标准

后续浏览器验收增加以下判断：

1. 不展开任何工具时，用户能读完完整对话，不会被几十条工具行打断；
2. 每个工具都能区分调用中、成功、失败、暂停，不能只显示一个无限转圈；
3. 动效停止不等于任务完成，真实终态必须来自事件和服务端状态；
4. 刷新或 SSE 重连后，用户消息、Agent 回合、工具轨迹和最终回答顺序不变；
5. 工具详情可访问但不抢占最终回答的视觉层级；
6. 运行失败后输入框可继续操作，并提供与业务匹配的重试/继续路径；
7. 折叠控件使用真实按钮和 `aria-expanded`，不能只依靠视觉点击区域。

### 17.6 参考资料

- OpenAI, [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
- OpenAI, [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)
- OpenAI Agents SDK, [Streaming](https://openai.github.io/openai-agents-python/streaming/)
- Anthropic, [Fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)
- AI UX Playground, [Task queue pattern](https://www.aiuxplayground.com/pattern/task-queue/)
- Jacar, [UI design for agents: principles we're starting to understand](https://jacar.es/en/ui-design-for-agents-principles-were-starting-to-understand/)

### 17.7 设计出处审计与执行门槛（2026-09-19）

本节把本复盘文档中的产品设计判断和协议判断拆开。以后新增任何聊天 UI 设计，必须先补齐“参考产品/官方来源、具体状态、采用或拒绝的范围、浏览器验收方式”；只有内部自定义且没有出处的视觉或交互规则，不得直接进入实现。

| 设计点 | 明确出处 | 本项目采用范围 | 不应误称为出处的内容 |
| --- | --- | --- | --- |
| 用户消息、Agent 文本、工具调用共用一条可恢复时间线 | OpenAI Codex Harness：typed items、item lifecycle、thread history/reconnect；[Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/) | 以 `turnId/runId/sequence` 归并并按事件顺序回放 | “把数组里已有文字重新排序”不是协议依据 |
| 一个用户回合可以有多次工具调用，最后以 Agent 结果收口 | OpenAI Codex Agent Loop；[Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) | 同一 `turnId` 可以包含多个 `runId` 和多个工具阶段 | “每回合最多一个工具折叠块”没有出处，已撤回 |
| 工具细节默认不抢占主阅读流，用户按需展开 | Codex UI 的真实验收截图（用户提供，作为视觉参考）+ Codex Harness 的结构化 item 生命周期 | 连续工具阶段默认折叠；展开保留名称、耗时、状态、错误和真实顺序 | 官方文章没有规定 CVAgent 必须使用某个 CSS 或固定卡片样式 |
| 运行中用低对比度动效，完成后保持稳定摘要 | Codex UI 的真实验收截图（用户提供，作为视觉参考） | 仅作为运行态表现，终态仍由服务端事件决定 | 动效本身不能证明任务成功，也不能代替 `agent_run_finished` |
| Agent 线程、事件、重连和客户端恢复 | OpenAI Codex Harness；[Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/) | snapshot + replay + live event 归约与幂等 | 不复制 Codex 私有实现，只对齐可观察的生命周期原则 |
| 队列、检查点、侧边任务状态 | Cursor Agent 官方文档；[Cursor Agent overview](https://cursor.com/docs/agent/overview) | 仅用于后续队列/检查点能力的参考 | Cursor 的布局细节不自动成为 CVAgent 规范 |
| 调试追踪与聊天展示分离 | OpenAI Agents SDK Tracing；[Tracing](https://openai.github.io/openai-agents-js/guides/tracing/)、LangGraph Studio；[LangGraph Studio](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/langgraph_studio.md) | 诊断日志和 trace 供开发者查问题，聊天只显示低噪声过程摘要 | 不把 trace/span 列表原样铺进用户聊天 |

因此，本轮的硬性修正是：**不再以固定块数量约束 renderer，而以真实事件边界约束 renderer。** 空 assistant 生命周期事件只能更新状态，不能切断连续工具组；有实际可读的阶段性 Agent 文本时，才允许在其前后形成不同的工具组。这个规则有 Codex 的事件生命周期依据，也直接对应当前截图中“多个空工具过程块”的实际缺陷。

## 18. 本轮落地记录与验收结果（2026-09-19）

### 18.1 已落地的代码边界

- 后端为每个用户回合生成 `turnId`，为每次实际执行生成独立 `runId`；自动 measurement continuation 复用原 `turnId`，不复用上一轮 `runId`。
- 用户消息在 Agent 启动前写入 session；失败、暂停、成功和刷新恢复都从同一份 session 快照读取，不再依赖浏览器内存中的临时消息。
- workflow event 使用 session 内单调 `sequence`；session 快照、事件日志和 SSE 都保留 `turnId/runId/messageId/toolCallId`，前端按 sequence 去重和排序。
- SSE 连接在读取历史前先订阅实时事件，并支持 `Last-Event-ID` 回放；重连造成的重复事件由 sequence 身份消除。
- Agent 失败时沿用已启动 run 的 `runId` 产生 `agent_run_finished(outcome=failed)`，不再让页面因为终态身份变化而永久显示“运行中”。
- 前端移除了按数组位置和 `groupIndex` 关联消息的路径，workflow group 只通过 `turnId` 归属到用户回合；保留的流式文本 fallback 只用于当前屏幕，不成为刷新后的事实来源。
- 工具轨迹已经改成 turn 内的可折叠过程块：默认收起，运行中用低对比度渐变提示，展开后保留真实工具顺序、耗时、摘要和失败信息；Agent 文本仍然在过程块外按时间位置可读。
- 本轮执行 run 的 `runId` 同步写入 task context，避免持久化事件和生产日志分别关联到不同 run。

### 18.2 对“刚改代码”的影响判断

本轮检查发现的实际影响不是业务接口被破坏，而是两类数据流风险：

1. 前端开发服务读取的是 `frontend/react/dist`，源码改动后如果不重新 build，浏览器仍会加载旧 bundle，表现为“代码改了但页面没变”；本轮已重新执行 Vite build。
2. Agent factory 在异步执行前失败时，旧异常处理会重新生成一个失败 `runId`；当前已让异常携带原执行 runId，并补充失败回归断言。

因此不能把这次改动判断为“没有影响”；影响已定位、修正，并由自动化测试和浏览器失败恢复链路验证。

### 18.3 验收证据

- Backend：`npm.cmd test`，74/74 通过。
- Frontend：`npm.cmd run build`，TypeScript 检查和 Vite build 均通过。
- 浏览器：真实打开 Agent 并检查最新构建；现有 session 中只保留一个有内容的工作流块，不再出现孤立“正在处理”块，工具组默认折叠，输入框保持可用。
- 当前浏览器模型调用未使用真实 API key，因此本轮浏览器没有宣称“真实模型成功执行”通过；暂停、测量、自动 continuation、完整工具链由后端集成测试覆盖。
- 开发期旧 session 已按授权清空，仅保留工作区源文件、模板、渲染产物和日志；本轮浏览器回归产生的当前开发 session 属于临时验收数据。

### 18.4 本轮针对截图问题的修正

- `renderRunGroup()` 不再把空的 `assistant_message_started/finished` 当作工具阶段边界；只有实际可见的 Agent 文本才会切断连续工具组。
- `eventGroups()` 不再为“只有空 assistant 生命周期、没有工具、没有 delta”的普通对话创建 workflow group，因此不会再渲染孤立的“正在处理”。
- 工具块垂直留白从大段卡片间距收敛为轻量状态行；滚动条继续采用接近不可见的默认样式，运行中的状态只保留低对比度渐变提示。
- 新增两个前端回归用例：空 assistant 生命周期不拆分工具组；assistant-only 空生命周期不进入可见聊天时间线。

本轮通过浏览器 DOM 和截图复核得到的结构是：用户消息 → 一个连续工具过程（默认收起）→ Agent 正文；没有无内容的“正在处理”占位。若后端后续真的产生阶段性 Agent 文本，允许按真实 `sequence` 分出多个工具组；这不是固定数量规则。

### 18.5 仍未关闭的验收项

- 需要在配置有效模型凭据的环境再次完成一次浏览器真实成功链路：用户消息 → 多个工具 → 暂停测量 → 自动 continuation → 最终 assistant 回复 → 刷新恢复。
- 需要单独模拟浏览器断网/重连，检查 `Last-Event-ID` 在真实 Chromium EventSource 行为下没有重复或缺口。
- 当前全局 CSS 仍保留少量历史样式覆盖，未影响本轮数据流，但应在下一次 UI 迭代中做删除式清理，避免继续叠加覆盖规则。

本轮浏览器验收还暴露了一个开发环境约束：不能同时启动多个指向同一 `.cvagent` 数据目录的后端实例。旧实例会持有自己的 session 内存快照，同时把事件写回共享文件，新实例再读取时就可能出现“页面显示了另一条会话的工具轨迹”。验收时已停掉旧的 3180/3192 服务，仅保留 3181/3193 单实例组合，并重新清理临时 session。后续应在启动脚本或服务启动检查中增加“数据目录锁/端口-实例绑定”，避免开发环境再次串线。

在上述三项完成前，本 spec 不标记为“最终完成”；当前状态是“数据流主链已收口，生产级浏览器全链路仍待带凭据验收”。
