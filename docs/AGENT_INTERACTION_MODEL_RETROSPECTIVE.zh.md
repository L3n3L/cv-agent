# CVAgent Agent 交互模型调研与对接复盘

日期：2026-09-17  
适用项目：`cv-agent`  
文档状态：交互重构基线（已按当前代码核对修订），尚未进入实现阶段

## 1. 结论先行

CVAgent 当前最需要升级的不是“聊天框皮肤”，而是 Agent 任务的可见性、可恢复性和状态表达。

推荐的目标形态是：

> 当前先在现有原生前端上完成事件、消息、fixture 和浏览器验收闭环；后续再用 React/Vite 把已经验证过的交互组件化。后端负责生成、持久化和逐步支持重放 Agent 事件；简历业务状态始终由 CVAgent 现有工序和状态机作为唯一真值。

这不是当前仓库已经具备的全部能力，而是分阶段目标。当前仓库已经前后端分离，但还没有 React/Vite、完整事件回放、浏览器 fixture 或 Markdown 消息渲染。

本次不应直接复制 Codex Desktop，也不应把 UI 改造成普通的“用户气泡 + AI 气泡”聊天应用。应借鉴 Codex 的事件分层和 LangGraph 的流式/检查点能力，形成适合简历制作的任务时间线。

## 2. 调研范围与判断依据

### 2.1 CVAgent 当前实现

已阅读当前项目的主要实现：

- `frontend/index.html`：页面包含导航、Markdown 编辑器、A4 iframe 预览、模板、排版调整、版本和 Agent 区域。
- `frontend/app.js`：当前仍是命令式前端状态和 DOM 交互的主要承载文件，负责 API 请求、Session 恢复、预览测量和交互事件。
- `frontend/styles.css`：正式前端的主要样式文件；`backend/public/` 是历史静态副本，不是新前端的运行时依赖。
- `frontend/server.mjs`：前端静态服务和同源 `/api/*` 代理，默认监听 3191。
- `backend/src/server.js`：后端 API 和 Agent 服务，默认监听 3180；`/api/agent/run` 仍主要是一次性 POST 返回，同时已有 `/api/agent/events` 实时 SSE 通道。
- `backend/src/core/session-store.js`：已经持久化 `session.json`、`messages.ndjson` 和 `events.ndjson`。
- `backend/src/core/event-catalog.js`：已经定义 Agent、工具调用、渲染、测量、验收、保存和恢复等业务事件。
- `backend/src/core/workflow.js`：已经定义简历制作状态转移。
- `backend/src/agent/resume-tools.js`：已经把 `resume_prepare`、`resume_read`、`resume_check`、`resume_write`、`resume_render`、`resume_metrics`、`resume_finalize` 等工具对齐到简历工序。
- `specs/frontend-backend-integration/`：当前仓库已有的前后端真实链路规格，优先作为现状接口基线。

### 2.2 Codex 官方开源客户端事件模型

OpenAI 开源的 Codex SDK 没有提供 Desktop UI 源码，但其公开的 TypeScript 事件类型很适合参考。它将一次执行拆成：

```text
thread.started
→ turn.started
→ item.started / item.updated / item.completed
→ turn.completed 或 turn.failed
```

其中 item 可以表示 Agent 消息、命令执行、文件变更、MCP 工具调用等不同类型，而不是把所有过程压成一段文本。这说明高质量 Agent UI 的核心不是装饰性聊天气泡，而是“运行单元 + 生命周期 + 可更新结果”。

Codex 的 app-server 客户端还体现了另一个重要原则：同步请求响应和异步事件通知是两个层次。启动线程可以先得到一个立即响应，后续再通过事件补充会话元数据，客户端需要在启动阶段进行状态合并，而不能只相信一个同步返回值。

参考：

- [Codex TypeScript events.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts)
- [Codex TypeScript items.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts)
- [Codex app-server client README](https://github.com/openai/codex/blob/main/codex-rs/app-server-client/README.md)

### 2.3 LangGraph 官方流式与恢复模型

LangGraph 的官方文档把图执行拆成多种流：

- `messages`：模型消息或 token 流；
- `updates`：节点产生的状态更新；
- `tools`：工具开始、过程、完成和错误事件；
- `custom`：业务自定义事件；
- `checkpoints`：可恢复的状态快照。

LangGraph 的 checkpoint 会保存线程状态、消息、待执行任务和下一节点，因而可以把 Agent 执行展示成时间线，也可以从某个状态恢复或分支。`interrupt` 则提供了暂停执行、等待用户输入、使用相同 thread id 恢复的标准方式。

参考：

- [LangGraph JavaScript streaming](https://langchain-ai.github.io/langgraphjs/how-tos/stream-values/)
- [LangGraph time travel and checkpoints](https://docs.langchain.com/oss/javascript/langchain/frontend/time-travel)
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph memory and thread-scoped state](https://docs.langchain.com/oss/javascript/concepts/memory)

## 3. 当前问题复盘

### 3.1 当前前端是“可用工作台”，不是“可观察 Agent”

当前页面已经能表达简历编辑和 A4 预览，但 Agent 区域的核心流程仍然是：

```text
输入一句话
→ POST /api/agent/run
→ 等待 agent.invoke 完成
→ 一次性追加 assistantText
```

这会导致用户无法在执行期间知道：

- Agent 是否已经读取简历；
- 当前是在做内容检查还是改写；
- 草稿是否已经写入；
- 当前预览是不是最新版本；
- 当前是否正在等待浏览器测量；
- 为什么尚未通过验收；
- 服务中断后能否继续。

### 3.2 后端已有业务事件，但还没有前端事件通道

当前的 `event-catalog.js` 和 `session-store.js` 已经具备不错的业务基础，但 `events.ndjson` 目前主要承担审计和日志作用：

- 没有面向浏览器的 SSE/WebSocket 推送接口；
- 没有稳定的事件序号，浏览器重连时难以从指定位置补发；
- 没有统一的 `runId` 作为一次用户请求的边界；
- 前端无法将“一个工具调用开始”和“同一个工具调用完成”关联起来；
- Session snapshot、messages、workflow event 在 UI 侧还没有统一的 reducer 投影。

因此，不能只在现有 `addMessage()` 外面加一个 loading 动画。必须先建立事件契约。

### 3.3 “AI 味重”的真实来源

当前的廉价 Agent 感主要来自以下问题，而不是因为用了 HTML：

1. 工具调用、内容修改、渲染和验收都被压成一条助手文本。
2. 用户看不到明确的任务阶段和下一步动作。
3. Assistant 文本没有形成真实的 Markdown/结构化内容渲染。
4. Agent 面板与预览、草稿、排版验收之间缺少稳定的联动。
5. 状态颜色、按钮和图标多，但没有一个统一的状态语义。
6. 一次性请求造成“按下发送后页面冻结”的感受。
7. 会话恢复只能恢复最终消息，不能恢复一次运行中间发生了什么。

## 4. 目标交互模型

### 4.1 用户看到的是“简历生产任务”，不是聊天记录

建议将每次用户提交定义为一个 `turn`，每个 turn 由多个可更新的 `item` 组成：

```text
用户需求
  └─ Agent 计划摘要
      ├─ 读取当前简历
      ├─ 检查内容结构
      ├─ 改写隔离草稿
      ├─ 选择或调整模板
      ├─ 渲染 A4 预览
      ├─ 接收浏览器测量
      ├─ 执行最终验收
      └─ 给出结果与下一步
```

用户只需要看到对完成任务有帮助的信息；详细工具参数、原始输出和调试信息默认折叠。

### 4.2 Agent 时间线的五类可见 item

| item 类型 | 用户看到的内容 | 是否默认展开 |
| --- | --- | --- |
| `user_request` | 用户本次目标和目标页数/岗位方向 | 是 |
| `plan` | Agent 对本轮要做什么的短摘要 | 是 |
| `workflow_step` | 读取、检查、写稿、渲染、测量、验收的状态 | 是，当前步骤展开 |
| `artifact` | 草稿、模板、预览、测量结果或版本发生了什么变化 | 是 |
| `result` | 通过、阻塞、需要用户确认和下一步动作 | 是 |

工具原始输入、原始输出、耗时和错误堆栈属于 `debug_detail`，默认折叠，并且不把模型内部推理过程直接展示给用户。

### 4.3 简历工序与 UI 映射

CVAgent 的业务工序保持 MCP 对齐，UI 只负责展示真实状态：

| 简历工序 | 时间线展示 | 右侧上下文展示 |
| --- | --- | --- |
| `resume_prepare` | 已绑定工作区、源文件和目标页数 | 来源文件、源 hash |
| `resume_read` | 已读取当前简历/材料 | 内容版本 |
| `resume_check` | 内容检查通过或列出问题 | 内容问题清单 |
| `resume_write` | 已生成隔离草稿 | 草稿路径、contentVersion |
| `template_select` / `presentation_update` | 模板或排版参数已变化 | 模板修订、presentation 修订 |
| `resume_render` | 已生成新的不可变预览 | renderId、预览入口 |
| `resume_metrics` | 已收到浏览器真实测量 | 页数、逐页占用率、溢出 |
| `resume_finalize` | 验收通过或阻塞 | blocker、completionAllowed |
| 用户确认 / 保存 | 已保存正式版本 | versionId、导出动作 |

核心原则：UI 不自行推断“完成”。`resume_finalize` 的结构化结果和用户确认仍然是唯一完成门。

## 5. 建议的事件契约

### 5.1 事件信封

建议在现有 `events.ndjson` 基础上增加面向前端的稳定事件信封：

```json
{
  "schemaVersion": 1,
  "seq": 42,
  "eventId": "evt_01J...",
  "type": "workflow.step.completed",
  "timestamp": "2026-09-17T10:00:00.000Z",
  "sessionId": "session_...",
  "runId": "run_...",
  "taskId": "task_...",
  "itemId": "item_...",
  "step": "resume_render",
  "status": "completed",
  "payload": {
    "renderId": "render_...",
    "templateRevision": "campus-standard@1",
    "nextAction": "等待浏览器测量"
  }
}
```

字段职责：

- `seq`：同一 Session 内单调递增，用于重连和补发；
- `runId`：一次用户提交的边界；
- `itemId`：同一时间线 item 的稳定身份，允许 started/updated/completed 合并；
- `type`：前端可判别的事件类别，不直接暴露框架内部事件名；
- `step`：对齐简历业务工序；
- `payload`：结构化结果，不能只塞一段自然语言；
- `status`：`running`、`completed`、`blocked`、`failed`、`cancelled` 等有限集合。

### 5.2 建议的事件集合

```text
session.ready
session.restored
session.interrupted

turn.started
turn.completed
turn.failed
turn.cancelled

item.started
item.updated
item.completed

workflow.step.started
workflow.step.updated
workflow.step.completed
workflow.step.blocked
workflow.step.failed

assistant.delta
artifact.updated
render.started
render.completed
measurement.received
verification.updated
user.confirmation_required
```

不建议把 `assistant.delta` 作为唯一体验。它只负责自然语言逐字输出；工具和简历工序必须使用结构化事件，避免前端通过猜文本判断 Agent 是否已经渲染或验收。

### 5.3 与现有事件目录的映射

现有业务事件可以继续保留，新增一个适配层将其映射成 UI 事件：

```text
AGENT_RUN_STARTED       → turn.started + item.started
TOOL_CALL_STARTED       → workflow.step.started
TOOL_CALL_SUCCEEDED     → workflow.step.completed
TOOL_CALL_FAILED        → workflow.step.failed
ARTIFACT_WRITTEN        → artifact.updated
RENDER_STARTED          → render.started
RENDER_SUCCEEDED        → render.completed
MEASUREMENT_RECEIVED    → measurement.received
VERIFICATION_PASSED     → verification.updated(status=accepted)
VERIFICATION_BLOCKED    → verification.updated(status=blocked)
SAVE_CONFIRMED          → artifact.updated(type=version)
SESSION_RESTORED        → session.restored
SESSION_INTERRUPTED     → session.interrupted
```

这意味着不需要重新发明简历状态机，也不需要让 React 直接依赖 `WORKFLOW_EVENTS` 的内部实现。

## 6. 推荐的后端对接方式

### 6.1 不建议继续把长任务绑定在一次性 POST 响应上

建议逐步增加如下接口，保留现有 `/api/agent/run` 作为兼容入口：

```text
POST /api/agent/runs
→ { runId, sessionId, streamUrl }

GET /api/agent/runs/:runId/events?afterSeq=0
→ text/event-stream

POST /api/agent/runs/:runId/cancel
→ { accepted: true }

POST /api/agent/runs/:runId/resume
→ { runId, streamUrl }
```

对于当前单用户本地产品，SSE 已经足够：

- 浏览器到服务端的命令仍然使用普通 POST；
- 服务端到浏览器的 Agent 进度使用 SSE；
- `events.ndjson` 作为断线后的事件重放来源；
- 浏览器重新打开时先获取 Session snapshot，再从最后一个 `seq` 继续订阅。

暂时不需要为了 UI 引入 WebSocket。只有在需要双向实时协作、远程控制或多端同步时，WebSocket 才值得承担额外复杂度。

### 6.2 Agent 框架必须被隔离在事件适配器后面

建议新增一个后端运行协调层，例如：

```text
backend/src/agent/run-coordinator.js
backend/src/agent/agent-events.js
backend/src/core/event-stream.js
```

职责分别是：

- `run-coordinator`：创建 run、锁定 Session、调用 Agent、处理取消和错误；
- `agent-events`：将 LangGraph/deepagents 的 stream 输出转换成 CVAgent 事件；
- `event-stream`：写入事件、分配 seq、支持 SSE 订阅和历史补发。

React 不应该直接知道 `agent.invoke()`、LangGraph node、tool call 的内部对象形状。未来即使替换 Agent 框架，前端仍然只消费 CVAgent 事件协议。

### 6.3 LangGraph 对接建议

如果当前 deepagents 暴露的 Agent 支持 LangGraph stream，应优先使用：

```text
updates   → workflow.step.updated
messages  → assistant.delta
tools     → workflow.step.started / updated / completed / failed
custom    → CVAgent 业务事件
checkpoints → session checkpoint / 可恢复元数据
```

但要避免“双重真源”：

- CVAgent 的 `SessionStore` 继续作为产品层 Session、简历工序和版本状态真源；
- LangGraph checkpointer 负责 Agent 图执行的恢复细节；
- 前端只从 CVAgent 事件和 Session snapshot 恢复；
- 不要让前端同时拼接 LangGraph 消息、Session messages 和本地 UI 草稿。

## 7. 推荐的 React/Vite 前端结构

React/Vite 的价值主要是状态边界、组件复用和长期维护，不是自动提高浏览器的 A4 渲染速度。

建议只迁移前端，不重写后端：

```text
frontend/
  src/
    app/
      App.tsx
      app-state.ts
      event-reducer.ts
    api/
      client.ts
      event-stream.ts
      types.ts
    features/
      session/
      timeline/
      resume-editor/
      preview/
      quality-gate/
      versions/
    components/
      TimelineItem.tsx
      WorkflowStep.tsx
      StatusBadge.tsx
      Composer.tsx
      PreviewFrame.tsx
    styles/
      tokens.css
      workbench.css
```

推荐的 UI 状态分层：

```text
Server snapshot / event stream
        ↓
event-reducer
        ↓
Product state projection
        ↓
React components
```

组件只接收结构化状态，不在 JSX 里根据字符串猜测“正在渲染”或“验收失败”。

### 7.1 推荐布局

桌面宽屏：

```text
左：Session / 当前任务 / 时间线摘要
中：当前 Agent 任务与 Composer
右：A4 预览 / 排版指标 / 阻断项 / 保存门
```

内容编辑器不再和 Agent 聊天平行争夺主视线。建议通过顶部模式切换或中间区域内的工作区切换表达：

```text
Agent 任务 | 内容草稿 | A4 预览
```

右侧预览可以收纳，但收纳后必须保留明确入口，不能销毁当前 render、metrics 和验收上下文。

### 7.2 Agent 时间线视觉规则

- 当前正在执行的步骤只允许一个强强调状态；
- 已完成步骤使用低饱和成功状态，不做大面积绿色装饰；
- 阻塞项必须同时显示“原因”和“推荐动作”；
- 工具详情默认折叠，用户点击后才看参数、耗时和摘要；
- 草稿、预览和正式版本使用不同标签；
- 不用 emoji 充当图标，不使用大量“AI 魔法”式发光、渐变或漂浮卡片；
- Assistant 最终回复应总结结果和下一步，而不是重复工具日志。

## 8. UI 设计规格基线

这份复盘只定义交互模型，不立即实现 CSS；但后续实现应遵守以下设计规格。

### Purpose Statement

CVAgent 面向需要制作一页或两页投递简历的用户，把自然语言需求、简历内容、模板排版和真实 A4 验收合并到一个可恢复的 Agent 工作台中。用户应始终知道当前简历身份、Agent 正在做什么、结果是否可保存以及下一步该做什么。

### Aesthetic Direction

采用“industrial/utilitarian（工业化、工具化）”方向：信息密度高、层级克制、面向重复生产任务；重点是状态和结果，不使用泛化的 AI 聊天装饰。

### Color Palette

严格沿用当前 `frontend/styles.css` 已使用的浅色工作台基础，不切换到深色主题：

- 画布：`#F6F7F9`（`--canvas`）
- 内容面板：`#FFFFFF`（`--surface`）
- 主文字：`#17202A`（`--ink`）
- 正文：`#667281`（`--body`）
- 辅助文字：`#98A2AE`（`--muted`）
- 既有工作台强调：`#2F6FED`（`--blue`），仅保留给原有导航/按钮等必要交互；Agent 聊天正文和步骤标题不使用蓝色文字
- 分割线：`#DDE2E8`（`--line`）
- 错误：`#C74634`（`--red`）
- 当前项目的绿色语义 token 暂按 `--green:#657384` 保留，不新增高饱和色

### Typography

对齐 Codex Web UI 参考实现，固定使用中文系统字体栈，不再在每轮改造中更换字体：

- 界面正文：`"Microsoft YaHei", "微软雅黑", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", system-ui, sans-serif`
- 工具名、renderId 和指标：`"JetBrains Mono", "Cascadia Code", "Consolas", "SF Mono", ui-monospace, monospace`

这是对 UI 设计技能中“避免默认字体”的明确项目级覆盖，原因是 CVAgent 要对齐已选定的 Codex 开源参考实现和本机中文显示效果。后续不再随意更换字体。

### Layout Strategy

采用“稳定中轴 + 可收纳侧栏”：中间任务区保持最小可用宽度，左右两侧负责上下文和结果；窄屏时侧栏变为抽屉或覆盖层，不能靠页面级 `min-width` 把内容撑出视口。

## 9. 分阶段实施计划

### P0：建立事件与状态契约

- 定义 `runId`、`itemId`、`seq` 和事件信封；
- 为 Session 事件增加单调序号；
- 将现有 `WORKFLOW_EVENTS` 映射到 CVAgent UI 事件；
- 保留 `/api/agent/run`，新增运行协调层；
- 增加事件 reducer 单元测试。

### P1：建立 SSE 与断线恢复

- 新增创建 run 和订阅事件接口；
- 订阅前先返回 Session snapshot；
- 支持 `afterSeq` 补发；
- 服务重启后将运行中的 Session 标记为 interrupted；
- 浏览器刷新后可以恢复最近一次任务时间线。

### P2：前端迁移到 React/Vite

- 保留 Node server、API、渲染器、SessionStore 和简历工具；
- 将 `frontend/app.js` 拆成 API、状态 reducer、features 和组件；
- 先迁移 Agent 时间线，再迁移编辑器、预览、版本和模板；
- 用真实 Markdown renderer 替代当前纯文本助手输出；
- 不在这一阶段改变简历工序或保存门。

### P3：Agent 工作台体验

- 显示实时工具状态、耗时和摘要；
- 显示当前工序和下一步动作；
- 支持停止、继续、重试和恢复 Session；
- 支持 `user.confirmation_required`，将保存正式版本变成明确的人机协作动作；
- 让 render、metrics、finalize 结果直接驱动右侧状态面板。

### P4：视觉和性能验收

- 检查 1024×768、1280×800、1440×900；
- 检查长会话时间线滚动和增量更新；
- 检查 Agent 首个事件时间、预览刷新时间和 A4 iframe 测量时间；
- 检查没有重复渲染整个时间线或重复刷新 iframe；
- 做浏览器级截图与交互回归。

## 10. 不能做的事情

- 不直接复制 Codex Desktop 未公开的 UI 源码；
- 不把第三方 AGPL 项目的组件直接拷入本项目；
- 不让 React 通过自然语言猜测业务状态；
- 不把 LangGraph 的内部事件对象直接暴露为前端长期契约；
- 不把模型内部推理过程当作用户可见的“思考内容”；
- 不让 UI 绕过 `resume_finalize` 直接显示完成或允许保存；
- 不因为做流式 UI 而复制一份新的简历状态机；
- 不为了视觉效果修改 CVAgent 当前渲染出来的 A4 成品基准；
- 不为了“像 Codex”增加没有业务意义的终端、文件树或命令执行面板。

## 11. 验收标准

### 交互验收

- 用户发送请求后 1 个事件周期内能看到任务已开始，而不是页面无反馈；
- 用户能看到当前工序、当前状态和下一步动作；
- 工具失败时能看到失败步骤、原因和重试/继续入口；
- 页面刷新后能恢复 Session、最近事件和当前简历状态；
- 事件重复或乱序不会重复生成时间线 item；
- 断线重连后不会丢失已经持久化的事件；
- 用户确认前不能保存正式版本。

### 简历工序验收

- 时间线顺序与 `resume_prepare → resume_read → resume_check → resume_write → resume_render → resume_metrics → resume_finalize` 一致；
- 内容、模板或 presentation 变化后，旧 render 和 metrics 明确失效；
- `resume_metrics` 始终绑定当前 `renderId`；
- `resume_finalize` 未通过时显示阻断原因，不显示“完成”；
- 正式版本保存后可以在版本页面恢复和导出。

### 工程验收

- `npm test` 全部通过；
- 前端构建、类型检查和 lint 通过；
- 浏览器无新增 Console error；
- 关键事件有事件契约测试、SSE 重连测试和 Session 恢复测试；
- 前端不依赖 插件运行时、不读取 宿主全局对象。

## 12. 最终决策

这次重构的优先级应当是：

```text
事件契约
→ 流式运行与持久化重放
→ 时间线 reducer
→ React/Vite 组件拆分
→ Agent 工作台布局
→ 视觉细节和性能优化
```

不要反过来先重做一套漂亮聊天 UI，再想办法把 Agent 工序塞进去。

CVAgent 最终应该像一个“可以观察、可以恢复、可以验收的简历生产系统”，而不是一个套着简历预览的聊天窗口。

## 13. 开源参考复盘：优先复用可许可实现，再做 CVAgent 适配

### 13.1 推荐参考样本

本轮不是只做抽象分析，而是明确采用“固定开源样本 → 本地阅读/运行 → 选择性移植组件 → 接入 CVAgent”的实现策略。

优先级如下：

| 来源 | 许可/用途 | 对 CVAgent 的取法 |
| --- | --- | --- |
| `assistant-ui/assistant-ui` | MIT；React/TypeScript Agent UI 组件库 | 优先作为消息、Composer、ToolCall、Markdown、流式状态的实现骨架；可以安装包，也可以在保留许可证的前提下移植明确需要的组件源码 |
| `openai/codex` | Apache-2.0；Codex CLI/TUI，不是 Desktop UI | 参考事件生命周期、transcript、Markdown 渲染和工具 item 的组织方式；不把它描述成 Codex Desktop 源码 |
| `LuSeptem/codex-webui` | MIT；独立社区 Web UI | 参考完整网页布局、Session 列表、流式对话、回放、fixture/showcase 和视觉验收方式；必须保留其许可证和第三方声明 |

`assistant-ui` 的价值不在于它的默认皮肤，而在于它把 Agent UI 拆成可组合的 `Thread`、`Message`、`Composer`、`ThreadList` 和 Action Bar，并且支持流式输出、自动滚动、重试、附件、Markdown、代码高亮、工具调用组件和人工确认。它还提供 LangGraph、自定义 data stream 等 runtime 适配边界。仓库声明为 MIT，但如果复制源码或使用其包，仍然要保留对应许可证和版权声明。

参考：

- [assistant-ui 官方仓库](https://github.com/assistant-ui/assistant-ui)
- [assistant-ui MIT 许可证](https://github.com/assistant-ui/assistant-ui/blob/main/LICENSE)
- [Vercel AI SDK UI chatbot 文档](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/02-chatbot.mdx)
- [Vercel AI SDK UI message parts 类型](https://github.com/vercel/ai/blob/main/packages/ai/src/ui/ui-messages.ts)

### 13.2 对 CVAgent 的正确取法

这里的“扒代码”应理解为合法的源码复用/移植，不是抓取 Codex Desktop 闭源实现，也不是把第三方项目整个复制进来。具体执行采用“开源骨架 + CVAgent 业务适配层”：

```text
固定版本的 assistant-ui / codex-webui 源码
        ↓
本地许可证、依赖和组件边界审查
        ↓
选择性移植 Thread / Message / Composer / ToolCall / Markdown / Fixture
        ↓
CVAgent 自己的事件适配器、简历工序、A4 预览和验收面板
```

正式实现前必须：

1. 固定参考仓库的 commit/tag，不跟随浮动分支直接复制；
2. 在临时目录 clone 并运行 showcase，先确认实际交互，而不是凭截图猜；
3. 记录每个被移植文件、来源 commit、许可证和修改内容；
4. 把复用代码放进独立的 `frontend/src/ui-reference/` 或第三方依赖边界，不混入简历业务逻辑；
5. 增加 `THIRD_PARTY_NOTICES` 或在项目许可证说明中保留必要声明；
6. 用 CVAgent 固定 fixture 替换参考项目的假数据，不能把参考项目的后端协议直接带进来。

可以借鉴：

- message parts 而不是单一字符串；
- 一个 item 的 streaming / done / error 生命周期；
- 工具调用的专用组件；
- 失败后的重试和停止执行；
- 自动滚动与用户手动滚动之间的边界；
- 可组合组件，而不是一个 1000 行聊天组件；
- 强类型的工具输入和输出。

不应直接搬入：

- 与 CVAgent 无关的通用聊天主题和页面布局；
- 依赖特定 AI SDK 的后端协议；
- 把普通聊天消息作为 CVAgent 简历状态的唯一数据源；
- 隐藏在组件库里的默认保存、线程和权限逻辑；
- 第三方项目的整套 CSS、品牌和交互行为；除非明确决定以该项目为 UI 基础，并完成许可证、依赖和视觉覆盖审查。

本次正式实现应优先以 `assistant-ui` 作为 React 组件骨架，以 `codex-webui` 作为完整工作台和 fixture 参考，以 `openai/codex` 作为事件/transcript/Markdown 行为参考。当前 `cv-agent` 还不是 React/Vite 工程，因此先建立参考实现分支或隔离前端原型，再把经过验证的组件迁移进正式前端；不能直接对现有 `app.js` 继续堆叠仿制 CSS。

## 14. AI 输出到底要不要渲染

结论：必须渲染，而且要按内容类型分层渲染。

当前 `frontend/app.js` 的助手消息如果使用 `textContent`，虽然安全、不会执行 HTML，但会把 Markdown 标记、列表、代码、链接和层级全部显示成普通文本。这会让 Agent 看起来像“接口返回了一段字符串”，无法承载任务总结和结构化结果。

### 14.1 输出渲染矩阵

| 输出内容 | 推荐渲染方式 | 不能做什么 |
| --- | --- | --- |
| Agent 最终说明 | Markdown renderer | 不能把整段 HTML 直接 `innerHTML` 写入页面 |
| 流式文本 | 同一个 message part 增量更新 Markdown | 不能每个 token 新建一个气泡 |
| 工具调用状态 | 专用 `ToolCallCard` / `WorkflowStep` | 不能让前端解析自然语言判断工具是否成功 |
| 工具结构化结果 | 专用结果卡片、表格、状态列表 | 不能把原始 JSON 全部铺开在主时间线 |
| 草稿变化 | Artifact 卡片 + 查看/打开按钮 | 不能假装正文已经成为正式版本 |
| A4 渲染结果 | 预览卡片 + renderId + 页数 | 不能只显示“已生成”而不显示当前版本身份 |
| 测量结果 | 指标卡片 + 阻断原因 | 不能接受模型臆造页数和占用率 |
| 错误 | 普通文本 + 错误码 + 重试动作 | 不能吞掉错误或只显示“失败” |
| 用户输入 | 默认纯文本 | 不需要把用户消息当作可信 HTML |

### 14.2 推荐的前端消息形状

不要继续让 UI 只接受：

```ts
{ role: 'assistant', content: string }
```

建议至少使用如下结构：

```ts
type CvAgentItem =
  | {
      type: 'text'
      id: string
      text: string
      state: 'streaming' | 'done'
    }
  | {
      type: 'workflow-step'
      id: string
      step: 'resume_read' | 'resume_check' | 'resume_write' | 'resume_render' | 'resume_metrics' | 'resume_finalize'
      status: 'running' | 'completed' | 'blocked' | 'failed'
      summary: string
      detail?: unknown
    }
  | {
      type: 'artifact'
      id: string
      artifactType: 'draft' | 'render' | 'measurement' | 'version'
      status: 'created' | 'stale' | 'accepted'
      payload: Record<string, unknown>
    }
  | {
      type: 'confirmation'
      id: string
      action: 'save-version'
      status: 'required' | 'confirmed' | 'rejected'
    }
```

这里的 `detail` 和 `payload` 只允许进入对应的专用组件；不能让任意对象自动变成可执行 HTML。

### 14.3 Markdown 渲染的实施边界

CVAgent 已经有 `markdown-it` 依赖，可以复用它作为文本渲染基础，但要明确边界：

- 开启 Markdown 的标题、列表、强调、链接、代码块和表格能力；
- 默认关闭原始 HTML；
- 链接使用安全的协议白名单；
- 如果将来允许 HTML，需要增加明确的 sanitizer 和 allowlist；
- Markdown renderer 只用于 Agent 文本，不用于工具结果和简历 A4 HTML；
- 流式阶段可以先显示纯文本增量，段落稳定后再做 Markdown 更新，避免未闭合代码块造成页面跳动；
- 代码块提供复制动作，但不把简历正文和工具参数混在同一个代码块里；
- 不把模型所谓“思考过程”直接展示为内部推理文本，只展示面向用户的计划摘要和步骤状态。

### 14.4 工具输出不要统一 Markdown 化

例如 `resume_render` 不应该让模型输出：

```markdown
✅ 已完成渲染，renderId 是 render_xxx
```

再由前端猜测它代表什么。正确方式是后端发送结构化事件：

```json
{
  "type": "artifact.updated",
  "artifactType": "render",
  "status": "created",
  "payload": {
    "renderId": "render_xxx",
    "pageCount": null,
    "measurementStatus": "pending"
  }
}
```

前端再把它渲染成“预览已生成 / 等待浏览器测量”的结果卡片。这样 UI 不依赖模型措辞，业务状态也不会被漂亮文案掩盖。

## 15. 本轮补充的遗漏清单

在原有复盘之外，开源参考暴露出以下必须加入实现计划的事项：

1. **Markdown 和 message parts**：助手文本、工具状态、草稿、测量结果必须分开渲染。
2. **流式增量合并**：同一个 item 必须通过稳定 ID 更新，不能不断追加气泡。
3. **自动滚动策略**：用户已经向上查看历史时，不能强制跳回底部；只有用户接近底部时才自动跟随。
4. **停止执行**：执行中的 turn 必须有停止入口，停止后显示 `cancelled`，不能伪装成正常完成。
5. **失败重试**：重试必须明确是重试当前步骤、从最近 checkpoint 继续，还是重新跑整个 turn。
6. **结构化工具结果**：模板、草稿、render、metrics、finalize 应有自己的结果组件。
7. **空状态和恢复态**：Session 被中断、源文件变化、render 过期、等待测量都要有不同文案和动作。
8. **长会话性能**：消息时间线需要稳定 key，必要时做分页或虚拟列表；不能每个事件都重绘整个页面。
9. **可访问性**：时间线状态需要可读的 aria-label，停止、重试、确认保存等动作要支持键盘。
10. **协议版本**：事件信封、message parts 和 API 响应需要 `schemaVersion`，避免前后端迭代互相猜字段。
11. **许可证边界**：参考仓库和实际引入的 npm 包要逐个记录许可证、版权声明和版本；不能只看主仓库许可证就忽略依赖。

## 16. 更新后的建议

现在最合理的下一步不是马上把 `assistant-ui` 整套装进来，而是：

```text
先定义 CvAgentItem / 事件协议
→ 在现有前端用一个最小时间线原型验证渲染方式
→ 让 /api/agent/run 能产生结构化步骤事件
→ 再迁移 React/Vite
→ 最后决定是自建轻量组件，还是引入 assistant-ui 的部分 primitives
```

如果后续确认要快速获得成熟的聊天基础设施，可以评估 `assistant-ui` 的 runtime 适配；但 CVAgent 的右侧 A4 预览、排版验收、renderId 和正式保存门仍应由 CVAgent 自己实现。

## 17. 当前仓库的前后端分离决策

### 17.1 当前真实形态

当前 `cv-agent` 已经是同仓库、前后端分目录、前后端分进程的 Web 项目，但还不是 React/Vite 工程：

```text
cv-agent/
├─ frontend/
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  ├─ api-client.js
│  └─ server.mjs       # 静态服务 + /api 代理，默认 3191
├─ backend/
│  ├─ src/             # Agent、Session、工作流、渲染和 API，默认 3180
│  ├─ public/          # 历史静态副本，迁移期间只作回退参考
│  └─ specs/docs/
└─ specs/
```

开发链路：

```text
浏览器
  ↓
frontend/server.mjs :3191
  ↓ /api/*
backend/src/server.js :3180
  ↓
Agent / Session / resume engine
```

当前已经具备前后端分离的有利条件：

- 前端只通过 `/api/*` 访问后端；
- `frontend/api-client.js` 已集中处理请求和错误；
- Agent、简历工具、Session、渲染器和工作流都在 `backend/src/` 下；
- 前端不读取后端本地绝对路径，不直接调用插件宿主运行时；
- 工作区、草稿、渲染、测量和版本由后端管理。

因此，下一步不是再做一次“前后端分离”，而是把现有正式前端从命令式 JavaScript 逐步工程化为 React/Vite 或等价的组件化前端。

### 17.2 推荐目标形态

保持同一 Git 仓库和两个运行时：

```text
cv-agent/
├─ frontend/
│  ├─ package.json
│  ├─ index.html
│  ├─ vite.config.ts
│  └─ src/
│     ├─ app/
│     ├─ api/
│     ├─ domain/
│     ├─ features/
│     ├─ components/
│     └─ styles/
├─ backend/
│  ├─ src/
│  ├─ public/          # 旧入口回退
│  └─ package.json
└─ specs/
```

迁移后开发环境：

```text
Vite frontend :5173
       │ /api/* proxy
       ▼
backend server :3180
```

生产环境：

```text
静态服务器 / Nginx → frontend/dist
Node 服务           → Agent、Session、渲染、事件和版本 API
```

不拆成两个仓库、不拆微服务、不重写后端 Agent。React/Vite 只负责组件化、状态投影和前端构建，不负责替代 CVAgent 的简历工序。

### 17.3 迁移顺序

```text
当前 frontend/app.js 基线
→ 事件 / item 协议
→ API client 与类型
→ React/Vite 外壳
→ Markdown 与结构化输出
→ Agent 时间线
→ A4 预览、测量、验收和保存门
→ 浏览器回归
→ 默认入口切换
```

迁移期间保留当前 `frontend/server.mjs` 和 `backend/public/` 的回退能力。只有新前端通过完整浏览器验收后，才切换默认入口并清理重复实现。

### 17.4 当前项目的难度判断

| 工作项 | 难度 | 说明 |
| --- | --- | --- |
| 建立 React/Vite 前端 | 低到中 | 当前前后端边界已经存在，不需要搬迁后端 |
| 抽取 API client 和类型 | 中 | 需要把现有响应和事件统一成可维护契约 |
| 拆分 `frontend/app.js` | 中 | 需要避免重复维护 Session、renderId 和测量状态 |
| 接入 Markdown / message parts | 中 | 需要区分 Agent 文本、工具、产物和指标 |
| 接入事件流和重放 | 中高 | 需要 runId、itemId、seq、断线补偿和取消语义 |
| 独立构建和部署 | 中 | 需要代理、静态资源和环境变量约定 |
| 重写 Agent、渲染器和 SessionStore | 不需要 | 当前领域内核继续复用 |
## 18. Codex UI 调研：为什么素，但不难看

### 18.1 先限定参考对象

Codex Desktop 的完整 UI 源码并未公开，因此不能把 Desktop 当作可以直接复制的网页模板。本次参考的是：

- OpenAI 对 Codex App 产品目标和交互方向的官方说明；
- OpenAI 开源 Codex CLI/TUI 的 `ChatWidget`、transcript、Markdown renderer 和 stream collector；
- Codex App Server 对线程、事件、持久化和客户端协作的设计说明。

参考：

- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
- [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)
- [Codex TUI ChatWidget](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget.rs)
- [Codex TUI Markdown renderer](https://github.com/openai/codex/blob/main/codex-rs/tui/src/markdown_render.rs)
- [Codex TUI Markdown stream collector](https://github.com/openai/codex/blob/main/codex-rs/tui/src/markdown_stream.rs)

### 18.2 Codex 的“素”不是缺少设计

Codex 的视觉克制来自明确的产品取舍：它是长时间运行的 Agent 工作台，用户需要监督、切换、审阅和继续任务，而不是被装饰吸引注意力。OpenAI 对 Codex App 的描述也把重点放在多任务、线程、变更审阅、长期运行和实时跟进上，而不是聊天气泡本身。

它看起来不难看的原因主要有六个：

1. **层级明确**：主任务、当前状态、工具过程、最终结果的权重不同，不是所有内容都做成同样醒目的卡片。
2. **中性色承载信息**：大部分界面使用低饱和中性色，把强调色留给状态、链接、焦点和真正需要行动的地方。
3. **节奏稳定**：间距、行高、标题层级和内容宽度统一，界面即使很素也不会松散或拥挤。
4. **内容本身被认真排版**：Markdown、表格、代码、链接、diff 和工具输出都有专门的呈现方式，不靠渐变和插画制造“高级感”。
5. **过程被组织而不是堆砌**：工具调用会聚合为可理解的执行单元，用户看到的是“正在探索 / 已完成探索”或一个可展开的步骤，而不是几十个低级日志气泡。
6. **动效服务于状态**：运行中的步骤、流式文本和短暂状态有反馈，但没有持续的炫光、漂浮和无业务意义的动画。

因此，Codex 的观感可以概括为：

> 不是靠装饰让界面好看，而是靠信息结构、排版质量和状态可信让界面显得专业。

### 18.3 代码层面最值得借鉴的地方

Codex TUI 的 `ChatWidget` 明确区分了：

- 已提交的 transcript cells；
- 当前正在流式变化的 active cell；
- 对多个探索型工具调用进行聚合的执行单元；
- 当前活动内容的缓存尾部，让执行中的工具过程立即可见。

这对 CVAgent 有直接启发：

```text
已完成的简历工序 item
        +
当前正在执行的 item（原地更新）
        +
被聚合的低级工具调用
```

不要每次收到一个工具事件就新增一条消息。应该用 `itemId` 在原来的步骤上更新状态，完成后再固定成历史项。

Codex 还专门实现了 Markdown renderer，而不是把模型输出当纯文本。它支持宽度感知的换行、表格、代码和链接处理；流式 Markdown 则通过累积源文本，在稳定边界后重新渲染，避免半截代码块和未闭合表格造成页面抖动。

这验证了 CVAgent 的判断：

> Agent 输出必须渲染；但文本、工具结果、简历草稿、A4 测量和验收结果必须使用不同的渲染组件。

### 18.4 Codex 风格对 CVAgent 的适配

CVAgent 不应该照搬 Codex 的黑色终端、文件 diff 或命令行语义，而应该抽取它的设计原则：

| Codex 原则 | CVAgent 对应实现 |
| --- | --- |
| 线程是任务容器 | Session 是一份简历制作任务容器 |
| turn 是一次用户请求 | 一次简历修改/排版目标 |
| active cell 就地更新 | 当前 `resume_render` / `resume_metrics` item 实时更新 |
| 工具调用聚合 | 将材料读取、内容检查、草稿写入聚合成业务步骤 |
| Markdown transcript | Agent 计划、结果说明和阻断解释使用 Markdown |
| diff / artifact 审阅 | 草稿变更、模板变化、A4 预览和正式版本卡片 |
| 线程持久化与重连 | `.cvagent/sessions/` + 事件序号重放 |
| 用户实时跟进和 steering | 继续、停止、重试、确认保存 |

### 18.5 CVAgent 的视觉决策应当收敛

前面提出的三栏结构可以保留，但应该降级“装饰”，强化工作关系：

```text
左侧：Session 和任务导航，稳定、窄、低对比度
中间：Agent 时间线和 Composer，承担主要交互
右侧：A4 预览、排版指标和保存门，承担结果审阅
```

需要主动避免：

- 每个步骤都做成大圆角白色卡片；
- 大量彩色状态胶囊和图标；
- 让“AI 助手”成为一个悬浮外挂窗口；
- 用渐变、发光、星星或魔法文案制造 AI 氛围；
- 把调试日志全部暴露在主时间线上；
- 为了仿 Codex 加入终端、文件树或代码 diff 等与简历生产无关的模块。

应该保留：

- 清晰的内容宽度和留白；
- 单一主强调色；
- 稳定的标题、正文、辅助信息三级层级；
- 当前步骤的轻量状态指示；
- 重要阻断项的高可见度说明；
- A4 预览和实际结果的优先级高于装饰性 Agent 文案。

### 18.6 调研后对前后端分离方案的修正

前后端分离仍然是正确方向，但执行顺序应调整为：

```text
产品交互基线
→ 事件 / item 协议
→ Markdown 与结构化输出渲染
→ SSE / 事件重放
→ React/Vite 迁移
→ 视觉细化和性能优化
```

不能把 React/Vite 当成“自动获得 Codex 观感”的工具。Codex 的质感主要来自后端事件模型、稳定的 transcript 投影、专业的内容渲染和克制的视觉系统；框架只是帮助我们把这些东西维护好。

### 18.7 调研后的最终判断

当前的前后端分离方案可以继续，但必须增加三个硬要求：

1. **Agent 文本必须 Markdown 渲染**，不再只使用纯文本 `textContent` 展示助手回答。
2. **执行过程必须是 item 时间线**，同一个工具/工序在生命周期内原地更新，不重复刷屏。
3. **视觉设计必须走 Codex 式克制路线**：少装饰、强层级、重内容、重状态、重结果。

所以最终不是“做一个更花哨的 AI 页面”，而是：

> 用 React/Vite 做一个结构清楚的简历生产工作台，用事件流和结构化渲染把 Agent 的真实工作过程呈现出来，再用克制的视觉系统把复杂性压下去。

在完成上述交互基线之前，不开始大规模改写 `frontend/app.js` 或新增大量 CSS。

## 19. 代表性开源 UI 参考筛选

### 19.1 不再寻找“唯一完美底座”

调研后发现，没有一个开源项目同时满足以下全部条件：

- 视觉足够克制；
- React/Vite 结构适合迁移；
- 支持 Markdown 和流式消息；
- 支持 Agent 工具时间线；
- 支持自定义工作区和 A4 预览；
- 许可证适合直接做公司内部产品。

因此，正确做法是建立“参考组合”，而不是盲目找一个项目整仓复制：

```text
组件和消息渲染参考
        +
完整 AI 产品视觉参考
        +
Agent / 工具 / 会话能力参考
        ↓
CVAgent 自己的简历工作台
```

### 19.2 候选项目比较

| 项目 | 适合观察什么 | 不适合直接做什么 | 许可证判断 | 对 CVAgent 的取法 |
| --- | --- | --- | --- | --- |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | React 组件、message parts、Markdown、流式、工具调用、人工确认 | 它是通用聊天组件，不包含简历编辑和 A4 验收工作台 | MIT | 首选组件和消息渲染参考 |
| [LibreChat](https://github.com/danny-avila/LibreChat) | Agent、MCP、工具活动、会话恢复、附件、搜索、长对话 | 体量很大，产品范围远超 CVAgent，直接移植会带入大量后端和配置 | MIT | 做功能审计和 Agent 状态参考 |
| [Vercel Chatbot](https://github.com/vercel/chatbot) | 轻量聊天布局、Composer、建议动作、Artifacts、流式交互 | 强绑定 Next.js、AI SDK、数据库和 Vercel 生态 | Apache-2.0 | 看布局和交互细节，不作为后端底座 |
| [Chatbot UI](https://github.com/mckaywrigley/chatbot-ui) | ChatGPT 类布局、侧栏、模型选择、会话列表和视觉密度 | 它的核心仍是通用聊天，不含 CVAgent 的生产工序 | MIT | 看视觉和侧栏组织方式 |
| [LobeChat](https://github.com/lobehub/lobehub) | 视觉完成度、助手列表、插件和推荐入口 | 当前 LobeHub Community License 对衍生作品商业分发有额外条件 | Apache 2.0 基础 + 额外条件 | 只看视觉，不复制源码或品牌 |
| [Open WebUI](https://github.com/open-webui/open-webui) | 完整产品、模型管理、工具、知识库和部署经验 | 新版许可证包含品牌约束和历史多许可证，白牌改造不合适 | 不作为 CVAgent 底座 | 只作产品功能清单参考 |

许可证判断依据：`assistant-ui` 仓库声明 MIT；LibreChat 当前 LICENSE 为 MIT；Vercel Chatbot 当前 LICENSE 为 Apache-2.0；LobeChat 当前许可证在 Apache-2.0 基础上附加衍生作品商业许可条件；Open WebUI 当前有按提交历史划分的多许可证和品牌限制。[assistant-ui](https://github.com/assistant-ui/assistant-ui)、[LibreChat LICENSE](https://github.com/danny-avila/LibreChat/blob/main/LICENSE)、[Vercel Chatbot LICENSE](https://github.com/vercel/chatbot/blob/main/LICENSE)、[LobeChat LICENSE](https://github.com/lobehub/lobehub/blob/main/LICENSE)、[Open WebUI LICENSE](https://github.com/open-webui/open-webui/blob/main/LICENSE)

### 19.3 代表性参考结论

#### A. 组件基线：assistant-ui

它最值得看的不是默认主题，而是以下工程组织：

- Thread、Message、Composer、ThreadList 是独立组件；
- 一个消息由多个 parts 组成，而不是只有一段 content；
- 文本、工具、文件、数据和人工确认可以各自渲染；
- runtime 与 UI 分离，可以接自定义后端；
- 可替换 LangGraph、自定义 data stream 或其他 runtime。

CVAgent 可以参考它的组件和数据边界，但不应把它的 Thread 当作整个简历工作台。

#### B. 视觉基线：Chatbot UI + Vercel Chatbot

这两类项目适合观察：

- 空状态如何引导用户开始；
- Composer 如何保持在底部且不抢视觉；
- 侧栏如何承载会话和模型上下文；
- 建议动作如何帮助用户快速进入任务；
- 消息宽度、代码块、附件和操作按钮如何保持密度。

但 CVAgent 不能照搬它们的“通用聊天首页”，因为用户打开 CVAgent 后最重要的不是问问题，而是知道当前简历处于什么制作阶段。

#### C. Agent 基线：LibreChat

LibreChat 当前已经将 Agent、工具、MCP、附件、搜索、代码执行和会话恢复放到一个完整产品中，并在版本说明中持续增强工具活动、实时阶段和消息复制等交互。它适合用来检查我们是否遗漏了：

- 工具是否可以取消；
- 失败是否可以继续；
- 会话是否能恢复；
- 多种工具结果是否有不同展示；
- 长对话是否有搜索、固定或归档能力。

但它不适合作为 CVAgent 的直接代码底座，因为它包含完整的多用户、模型、认证、数据库和部署体系。

### 19.4 CVAgent 的最终参考组合

正式执行时采用以下组合：

```text
assistant-ui       → 消息 parts、Markdown、工具调用、Composer 组件边界
Chatbot UI         → 视觉密度、侧栏、空状态、会话列表
Vercel Chatbot     → Artifacts、建议动作、流式交互细节
LibreChat          → Agent 工具、恢复、取消、长会话功能清单
Codex TUI          → 活动 item、工具聚合、Markdown 流式更新
CVAgent            → 简历工序、A4 预览、排版测量、验收和版本保存
```

### 19.5 是否要真的把仓库拉下来

要，但用途是“本地参考和拆解”，不是“复制一份改名”：

1. 固定具体 commit 或 release，不跟随不稳定的 `main`；
2. 只拉取首选项目及其必要依赖，避免把多个完整产品混到 CVAgent；
3. 记录仓库许可证、第三方依赖许可证和需要保留的 NOTICE；
4. 为每个参考项目记录具体观察文件，例如 Message、Composer、ToolCall、ThreadList、Markdown renderer；
5. 只提炼交互和组件边界，重新实现 CVAgent 的产品外壳；
6. 任何准备复制的源码先做逐文件许可证审查，并保留版权声明。

本机当前尝试直接通过 Git 克隆 `assistant-ui` 时受到 GitHub 连接失败影响，但官方仓库、README、许可证和类型定义已经完成在线核对。正式执行时，优先固定 `assistant-ui` 和 `LibreChat` 的参考版本；如果网络仍不可用，先用官方页面和源码文件完成组件清单，不阻塞 CVAgent 自己的实现。

### 19.6 本轮决策

不再执行“找一个 UI 整仓扒下来再改”的方案。

采用：

> 以 assistant-ui 作为消息渲染和组件边界参考，以 Chatbot UI/Vercel Chatbot 作为视觉参考，以 LibreChat 作为 Agent 产品能力清单，以 Codex TUI 作为事件和执行过程参考，CVAgent 自己实现简历生产工作台。

这样既能真正看到成熟 UI 的代码和视觉细节，又不会把一个通用聊天产品的历史包袱、许可证条件和后端体系带进 CVAgent。



## 20. 本仓库迁移后的执行落点

本复盘已经从历史目录迁移到当前 `cv-agent` 仓库。它是跨前后端的设计和研究基线，不替代可执行规格。

实施时按以下文件关系读取：

- 现状链路与已完成工作：`specs/frontend-backend-integration/`；
- 简历 Agent/MCP 工序：`backend/docs/CVAGENT_MCP_ALIGNMENT.zh.md`；
- 日志和事件审计：`backend/docs/LOGGING_UPGRADE_RETROSPECTIVE.zh.md`；
- 工作区选择与 Session：`backend/docs/WORKSPACE_SELECTION_RETROSPECTIVE.zh.md`；
- Agent 对话视觉：`frontend/AGENT_CHAT_CODEX_ALIGNMENT_RESEARCH.zh.md`；
- 当前前端视觉基线：`frontend/UI_VISUAL_POLISH_RESEARCH.zh.md`；
- 本文：完整的 Agent 交互模型、事件、输出渲染、前后端迁移、Codex UI 调研、开源参考和 UI 验收策略。

以下内容属于当前仓库的明确决策：

1. CVAgent 不依赖任何插件宿主运行时或全局对象。
2. 旧插件只作为历史来源，不作为运行时依赖、产品名称、视觉真值或验收基准。
3. 简历工序、Session、renderId、metrics、finalize 和正式保存由 `backend/` 负责。
4. 前端只能消费 API、Session snapshot 和事件，不得自行维护第二套简历业务状态。
5. UI 改造采用状态 fixture、before/after 截图、DOM/几何/行为断言和小步提交。
6. 没有浏览器证据时，不宣称 UI 改造完成。

## 21. Codex UI 改造执行策略

### 21.1 固定上下文，而不是只写“做得好看”

交给 Codex 的每个 UI 任务必须说明：

- 当前真实入口和启动命令；
- 要修改的文件范围；
- 本轮唯一要解决的问题；
- 必须保留的控件和业务行为；
- 固定的 Session、简历、模板和 Agent 状态；
- viewport、浏览器缩放、字体加载和滚动位置；
- 完成所需的测试、截图和浏览器证据。

不使用“做得像 Codex”“高级一点”“去掉 AI 味”等不可验收的任务描述作为唯一要求。

### 21.2 修改前必须截图复现

Codex 在写代码前必须先启动当前项目并记录：

1. 修改前截图；
2. Console 错误和警告；
3. `document.documentElement.scrollWidth/clientWidth`；
4. Agent、编辑器、A4 预览和质量面板的 bounding box；
5. 最短复现操作路径；
6. 实际结果和预期结果。

修改后必须执行同一条路径，生成 before/after 对照。没有修改前证据，不允许直接宣称“修复完成”。

### 21.3 使用固定 UI fixture

截图和视觉回归不能依赖真实模型的随机输出。测试环境提供固定 fixture，至少覆盖：

```text
empty       空 Session
running     Agent 执行中
blocked     排版或内容阻断
accepted    验收通过等待确认
interrupted 服务中断后恢复
error       工具失败可重试
```

fixture 只能固定展示输入，不能绕过真实组件、事件 reducer、预览和保存门；生产构建不得暴露 fixture 入口。

### 21.4 截图不是唯一验收依据

每个 UI 任务至少做四层检查：

| 层级 | 检查内容 |
| --- | --- |
| 视觉 | 截图、文字裁切、重叠、留白、层级、A4 预览可见性 |
| 结构 | 关键元素数量、语义标签、可见性、按钮 disabled 状态、稳定测试钩子 |
| 几何 | 页面滚动宽度、编辑器/Agent/A4/质量区尺寸和抽屉边界 |
| 行为 | 输入、发送、重试、折叠、刷新、重连、确认保存和失败态 |

如果截图好看但保存门被绕过、Session 状态错误或按钮不可用，仍然验收失败。

### 21.5 稳定定位和可访问性

关键控件使用语义定位或稳定 `data-testid`，例如：

```text
session-rail
agent-timeline
agent-composer
workflow-step-render
preview-panel
metrics-panel
blocker-panel
save-version-button
connection-status
```

浏览器自动化优先使用 `getByRole`、`getByLabel`、稳定 test id、CSS/几何断言和 ARIA snapshot，不依赖中文文案、CSS 层级或元素序号。

### 21.6 单问题、小提交、双角色审查

一次 Codex 任务只解决一个主要问题，例如“修复页面级横向裁切”或“修复运行中 item 重复刷屏”。不要在同一提交里同时改布局、事件协议、视觉颜色和简历业务逻辑。

重要 UI 阶段采用两个角色：

1. 实现者：修改代码并提供 before/after、测试和浏览器结果；
2. 审查者：只根据规格、diff、截图和浏览器证据判定通过或失败，先不改代码。

审查失败时只修复明确失败项，不重新打开全量设计。

### 21.7 基线更新必须人工确认

截图基线只能在以下条件同时满足时更新：

- 变化属于本轮明确目标；
- 业务控件没有被删除或隐藏；
- Session、renderId、metrics、finalize 和 save 语义没有回归；
- Console 没有新增错误；
- 差异不是由字体、时间戳、随机 ID 或模型输出造成。

不允许用扩大像素差阈值、遮罩主要布局区域、`overflow: hidden` 或删除断言来让截图通过。

### 21.8 参考依据

该执行策略参考：

- [OpenAI Codex 介绍](https://openai.com/index/introducing-codex/)：通过 `AGENTS.md` 持续提供项目约束，并执行其中的测试；
- [OpenAI 如何使用 Codex](https://cdn.openai.com/pdf/6a2631dc-783e-479b-b1a4-af0cfbd38630/how-openai-uses-codex.pdf)：用 `AGENTS.md` 提供上下文，用 Best-of-N 做有限方案探索；
- [Playwright Locator Assertions](https://playwright.dev/docs/api/class-locatorassertions)：截图、定位器、CSS 和可访问性断言；
- [Playwright Visual Comparisons](https://playwright.dev/docs/next/test-snapshots)：固定动态区域并审查视觉基线变化；
- [Playwright ARIA Snapshots](https://playwright.dev/docs/aria-snapshots)：验证截图不能证明的可访问结构。

## 22. 2026-09-17 Agent 对话流实施记录

本轮只改 Agent 对话抽屉，不重写工作台，不引入 React/Vite，也不改变简历编辑、模板、渲染、真实 A4 测量和正式版本保存门。

### 已落地

- `frontend/agent-chat.js`：独立负责 Agent Markdown 渲染、用户消息、工具组、工具行、下一步提示和错误节点；不把不可信 Agent 文本直接作为 HTML 注入。
- 时间线采用“用户消息 → Agent 说明 → 本轮工具组 → Agent 结果”的真实插入顺序；工具组不再统一追加到所有消息末尾，多轮会话按用户轮次分别插入。
- `frontend/app.js`：保留现有会话和 SSE 接入，但把事件接入统一时间线；输入、发送、重渲染不会丢失输入内容和滚动位置。
- `frontend/styles.css`：删除旧的 `run-card`、`turn-progress` 和扫描渐变规则；Agent 抽屉改成白底、浅灰分隔、深灰正文的文档流。工具组外层可折叠，单个工具行仍可独立展开。
- `backend/src/core/session-store.js`：会话快照持久化最多 240 条经过白名单裁剪的 workflow event；旧 session 没有该字段时按空数组兼容。
- `backend/src/server.js`：SSE workflow event 在发送给浏览器前同步写入当前 session，并通过 `/api/session` 返回；bootstrap 也返回初始工具记录。
- `frontend/fixtures/agent-chat-states.json`：固定 empty/running/blocked/accepted 状态，供后续视觉回归使用。

### 验收证据

- 后端 `npm test`：31/31 通过。
- `node --check`：前后端改动文件通过；`git diff --check` 通过。
- 浏览器路径：打开 `.test-import` → 打开 Agent → 发送只读检查 → 等待 Agent 完成 → 截图 → 展开/收起“本轮简历制作” → 刷新页面 → 恢复同一会话。
- 恢复后的 ARIA 快照仍显示用户消息、Agent Markdown 消息和“本轮简历制作 · 已执行 4 项工具 · 完成”折叠节点；展开后显示准备任务、读取简历、检查内容、读取工作区材料四个工具行。
- 浏览器控制台 error/warning：空。

### 当前边界

- 事件快照用于会话 UI 恢复，不替代后端 `events.ndjson` 审计日志；审计日志仍由 session store 维护。
- 当前只恢复 workflow event，不恢复当时工具输出的完整原始 payload；工具行展示状态、工具名、耗时和错误码，详细正文仍由 Agent Markdown 消息承担。
- 固定 fixture 当前是数据文件，还没有暴露生产入口；后续视觉回归应通过测试 harness 注入到真实时间线组件，而不是新增生产路由。
