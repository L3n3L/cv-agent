# CVAgent Agent 聊天流式链路对接复盘

更新：2026-09-19  
状态：第一阶段已接入后端 Agent v3 流式回答、异步启动、可回放思路摘要、工具调用唯一身份和前端时间线；已用本地真实浏览器完成链路截图验收。

## 1. 本次目标

用户要求：

- Agent 最终回答不再等整轮执行完才出现，而是按增量文本流式显示；
- 工具调用仍然按真实执行顺序进入时间线，每一项默认一行，展开查看详情；
- 思考内容有一行摘要，展开后可持续追加，并在会话结束后可回看；
- 保留当前 CVAgent 的 A4 / Markdown / Agent 三列工作台，不把聊天 UI 变成悬浮气泡；
- 参考成熟开源 Agent UI 的交互模型，避免重新发明工具组、Markdown 和流式状态的行为。

## 2. 调研结论和取舍

### 2.1 可以借鉴的开源实现

- `assistant-ui` 是公开源码，提供消息流、Markdown、工具调用渲染器、运行中/完成状态、审批和 `ToolGroup` 连续工具折叠；
- `assistant-ui` 的 custom transport 允许后端发送自定义 Agent 状态快照，再转换为 UI message parts；
- Vercel AI SDK 已将 text、reasoning、tool-call 作为可分别消费的流式 part；
- `agenttrace-ui` 和 `agent-ui` 展示了 Agent 时间线、工具参数/结果、耗时、计划和阶段摘要的组织方式。

本轮不直接复制整个 `assistant-ui`：CVAgent 现有会话持久化、MCP 对齐工具和工作台 DOM 契约已经稳定；整套替换会把视觉布局、路由和会话状态一起重写，风险大于收益。实现只吸收它的协议和交互原则，保留 CVAgent 自己的 HTTP/SSE、session 文件和三列布局。

### 2.2 关于 DeepSeek reasoning

DeepSeek API 的 `reasoning_content` 确实是可流式返回的字符串，但官方把它定义为模型的 chain-of-thought。CVAgent 不把未过滤的私有链式推理定义为 UI 或持久化协议。

当前实现：

- drain provider reasoning stream，避免阻塞 Agent；
- 不把 reasoning token 原样推送给浏览器；
- 用工具阶段、验证结果和当前动作生成可解释的 `reasoningSummary`；
- 浏览器将摘要显示为可折叠的「思路摘要」，内容按 SSE 事件实时替换；
- 运行完成后，摘要继续从持久化 workflow event 回放。

如果以后产品要展示模型厂商明确提供的“安全 reasoning summary”而非 chain-of-thought，可以在同一事件契约中增加 provider adapter，不改变前端布局。

## 3. 事件契约

现有 `GET /api/agent/events?sessionId=...` 继续作为单一工作流 SSE 通道。前端 Agent 提交使用 `POST /api/agent/run?stream=1`：接口只负责确认排队并立即返回 `202`，执行过程和最终结果由同一会话的 SSE 推送；不带参数的旧 `/api/agent/run` 仍保留同步 JSON 兼容行为。新增/扩展字段：

| 事件/字段 | 用途 |
| --- | --- |
| `assistant_message_started` | 标记一段 Agent 回答开始 |
| `assistant_delta` + `messageId` + `delta` | 增量传输可展示的 Agent Markdown 文本 |
| `assistant_message_finished` | 标记回答段结束 |
| `toolCallId` | 将同名工具的多次调用分别配对，禁止合并成一行 |
| `phase` | 当前生产阶段，如读取、检查、渲染、验收 |
| `reasoningSummary` | 可回放的安全思路摘要，不是私有推理原文 |

后端优先调用 `deepagents` v3 `streamEvents(..., { version: "v3" })`；没有该能力的测试 Agent 继续走 `invoke` 兼容路径。工具生命周期仍由 `runResumeTool` 发出，避免框架工具事件和 CVAgent canonical event 重复。`assistant_delta` 只走实时 SSE，不逐 token 写磁盘；最终 assistant message、工具事件和阶段摘要仍会持久化，避免长回答造成大量文件写入并挤掉审计时间线。

## 4. 前端交互契约

Agent 时间线顺序固定为：

```text
用户消息
→ 本轮简历制作
  → 思路摘要（一行，可展开）
  → 工具调用（一行一个，可展开）
→ Agent Markdown 回答（增量渲染）
→ 下一步
```

规则：

1. 工具调用默认收起，只显示状态、名称和耗时；失败项默认展开；
2. 同一工具重复调用按 `toolCallId` 拆成独立行，保持真实顺序；
3. Agent 回答用现有安全 Markdown renderer 增量渲染；
4. 思路摘要使用弱化的左边线，不使用蓝色正文或大卡片；
5. 会话恢复只回放最终消息和已持久化的 workflow 摘要/工具事件，不伪造仍在运行的流；
6. 流断开时，最终 session 状态和已写入事件仍可恢复，下一轮继续走现有锁和状态机；前端收到 `agent_run_finished` 后重新读取 session 快照，补齐最终回答和上下文。

## 5. 已实现文件

- `backend/src/agent/streaming.js`：封装 deepagents v3 message/tool stream，并 drain provider reasoning；
- `backend/src/server.js`：把增量回答、阶段摘要和工具身份加入 SSE/持久化事件；
- `backend/src/core/tool-runner.js`：为每次工具调用生成 `toolCallId`；
- `backend/src/core/session-store.js`：允许安全持久化增量字段和思路摘要；
- `frontend/agent-chat.js`：线性时间线、独立工具行、可折叠思路摘要和 Markdown 增量回答；
- `frontend/app.js`：订阅并消费 SSE 增量状态；
- `frontend/styles.css`：保持 Codex 风格的黑灰、细边线和低装饰呈现。

## 6. 验证结果

- 后端全量测试：56/56 通过；
- 流式单元测试：验证 assistant delta 顺序、invoke 兼容和 reasoning 不外泄；
- HTTP/SSE 集成测试：验证 `202` 异步确认不等待 Agent、增量回答顺序、run correlation、思路摘要和持久化事件；
- React/Vite 构建：通过；
- 本地真实浏览器：已提交两轮 Agent 请求并截图确认摘要、工具行和完成回答；工具组可以展开回看。
- 仍需在真实模型环境补做：Markdown 表格、代码块和列表的长文本增量渲染，以及网络断开后的恢复演练。

## 7. 后续边界

第一阶段不引入 `@assistant-ui/react` 依赖。原因是当前产品需要保留既有工作台布局和会话数据契约；如真实浏览器验收后仍需要更复杂的 tool renderer、审批卡片或多 Agent 子流，再评估把 `assistant-ui` 的 React runtime 接到本 SSE 协议，而不是先替换整个页面。
