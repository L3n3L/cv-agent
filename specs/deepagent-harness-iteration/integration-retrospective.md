# DeepAgents Harness 对接复盘

更新时间：2026-09-19

## 结论

> 当前执行策略已在 2026-09-19 修订：普通对话不再清空 DeepAgent 工具或设置 `toolChoice: none`。最新边界和验收以 [open-tool-surface-retrospective.md](./open-tool-surface-retrospective.md) 为准；本文其余内容保留为上一阶段的对接记录。

本轮不把所有用户消息硬编码成多轮生产任务。DeepAgents 负责提供可组合的 Agent harness：工具循环、middleware、规划、状态和流式事件；CVAgent 负责把简历领域的执行模式、真实浏览器测量和正式保存授权接到这个 harness 上。

需要明确区分：

- 模型决定内容判断、工具选择和具体修改方式。
- 确定性 harness 只决定工具权限、外部事件如何恢复、重复循环如何停止，以及哪些动作必须确认。
- 用户可见聊天只保留真实 Agent 回复和真实工具事件，不伪造“已执行”或“下一步”文案。

本轮继续把 DSH 对接从“提示词契约移植”推进到 DeepAgent 原生 Harness 分层：DSH 的长领域规则进入 `backend/skills/resume-production/SKILL.md`，系统提示词只保留稳定原则，工具和服务端继续承担确定性门禁。这样对齐的是 DSH 的业务能力和决策边界，不是把 DSH 文本无差别复制进每一轮上下文。

## 对照结果

### DeepAgents 能力

官方 DeepAgents 是基于 LangGraph 的可编译 Agent 图，支持自定义 middleware、checkpointer、streaming 和工具/子 Agent。规划工具 `write_todos` 是复杂任务的可选能力，不应对普通问候或只读请求强行启用。

参考：

- https://docs.langchain.com/oss/javascript/deepagents/overview
- https://github.com/langchain-ai/deepagentsjs

### DSH 可借鉴的领域契约

DSH 的成熟点不是“任何消息都循环”，而是：先识别用户动作；没有岗位或 JD 时制作通用投递版；进入简历生产后持续执行检查、渲染、真实测量和完成验收；只有正式保存才要求授权。

对应本地实现：[resume-guide.js](<E:/vsws/deepseek-harness-plugins/1-插件源码/dsh-campus-job/lib/resume-guide.js:9>)。

### CVAgent 原缺口

1. 仅调用 `createDeepAgent({ model, tools, systemPrompt })`，没有按任务模式接入 DeepAgents middleware。
2. A4 测量失败后前端只提示“请确认后继续”，没有恢复已有的 `/api/agent/continue` 链路。
3. 普通聊天、只读检查、简历生产共用同一工具面，容易导致无关工具调用和伪流程文案。
4. DSH 的业务契约尚未使用 DeepAgent 原生 Skill 生态，完整规则容易和系统提示词、MCP guide 发生重复。

## 本轮设计

### DSH 规则的原生落点

| DSH 能力 | DeepAgent/CVAgent 落点 | 说明 |
| --- | --- | --- |
| 任务识别、证据账本、STAR 压缩 | `resume-production` Skill | 需要模型判断，采用渐进式读取，不硬编码成循环 |
| 读取、写入、渲染、测量、验收 | CVAgent domain tools | 有明确输入输出和副作用，服务端可确定性校验 |
| chat/read-only/production 权限 | execution middleware | 只过滤工具面，不代替模型做内容决策 |
| 一页、逐页密度、当前 renderId | workflow state + `resume_finalize` | 不能只靠提示词声明通过 |
| 复杂任务的进度清单 | 官方 `todoListMiddleware` | 只在生产模式启用，普通聊天不显示规划状态 |

Skill 文件来源标记为 DSH `1.9.0`，以便以后 DSH 规则升级时做版本对照。当前使用 StateBackend 输入提供 Skill 文件，避免为了读取 Skill 把宿主仓库暴露给 Agent。

### 三种执行模式

| 模式 | 触发 | 工具权限 | 是否自动续跑 |
| --- | --- | --- | --- |
| `chat` | 问候、普通问答 | 无简历工具 | 否 |
| `read_only` | 查看、只读、检查且明确不修改 | 读取、检查和布局查询 | 否 |
| `production` | 制作、修改、优化、排版、一页投递等 | 简历生产工具 + DeepAgents 规划 | 是，直到通过或触发边界 |

模式识别只负责执行边界，不负责替模型决定简历内容。明确只读优先级高于生产关键词，避免用户说“只读检查”时发生写入。

### 外部测量恢复

```text
用户消息
  -> executionMode
  -> DeepAgents 单轮工具循环
  -> render
  -> 浏览器真实测量
  -> production 且无首轮信息阻断：自动恢复
  -> accepted / 硬阻断 / 自动预算耗尽
```

自动恢复具有三个边界：

- 只对当前生产会话生效，聊天和只读会话不自动修改。
- 当前测量必须对应当前 `renderId`，旧测量不能恢复。
- 每个用户生产请求有有限的自动续跑预算；预算耗尽后保留阻断状态并提示用户，不无限循环。

正式版本保存、模板覆盖和模板修订恢复仍然必须经过明确用户确认。

### 当前实现的机制归属

这套实现需要按三层理解，不能把三者混称为“DeepAgent 自己会循环”：

1. **DeepAgents 原生层**：`createDeepAgent` 内部使用 LangChain 的工具调用 Agent，并运行在 LangGraph 的图执行基础上；生产模式额外挂载官方 `todoListMiddleware`。这部分是 ReAct 风格的模型—工具循环，不是 React UI，也不是本项目手写的循环。
2. **官方扩展层**：执行模式通过 LangChain `createMiddleware` 过滤工具面，属于 DeepAgents 暴露的 middleware 扩展点；`todoListMiddleware` 是官方可选规划能力，只有生产任务启用。
3. **CVAgent 业务层**：`execution-policy.js` 的意图分流、简历完成门、真实 A4 测量校验和续跑预算属于产品契约，不属于 DeepAgents。浏览器测量发生在 Agent 图外，目前由测量接口触发一次新的 `runAgentTurn`，并用持久化的 `renderId`/预算防止旧测量和无限循环。

因此当前兼容性是“工具、middleware、流式事件兼容；外部测量恢复仍是业务适配器”。它还没有把测量等待建模成 LangGraph 原生 `interrupt()`/checkpointer resume：进程在测量返回后、定时续跑启动前崩溃时，当前会话状态会保留，但这一次自动续跑不会自动恢复。若要达到完整的 DeepAgents/LangGraph durable workflow，应把该桥迁移为持久化恢复队列或 `interrupt` + `Command.resume`，而不是继续增加更多定时器。

## 已执行改造

- [x] 新增执行模式识别和生产续跑预算。
- [x] 生产模式接入 DeepAgents `todoListMiddleware`，普通/只读模式不启用规划工具。
- [x] 新增执行模式 middleware，过滤聊天和只读模式的工具面。
- [x] 将执行模式和续跑状态写入会话快照及工作流事件。
- [x] A4 测量失败后，生产模式自动排队当前会话续跑；首轮信息收集阻断不自动续跑。
- [x] 保留显式 `/api/agent/continue` 作为人工恢复入口。
- [x] 补充自动续跑集成测试；浏览器截图验收仍是发布前最后一步。
- [x] 将 DSH 简历生产规则迁移到 DeepAgent 原生 `resume-production` Skill。
- [x] 生产模式启用 `skills: ['/skills/']`，并通过 StateBackend input files 提供 Skill 内容。
- [x] 收缩系统提示词，避免把 DSH 长契约重复注入每轮上下文。
- [x] 补充 Skill source/files 隔离的自动化测试。

## 验收标准

1. 发送“你好”时不调用简历工具，回复仍通过真实 Agent 流式返回。
2. 发送“只读检查当前简历，不要修改”时不出现写入、渲染、模板修改工具。
3. 发送“帮我制作一页简历，不要保存正式版”后，真实测量不通过时无需用户再次确认即可继续修订。
4. 测量使用旧 `renderId` 时仍被拒绝，不会触发续跑。
5. 首次空工作区缺少信息时仍停在 intake，不冒充完成，也不自动编造内容。
6. 生产模式最终仍必须经过真实测量和 `resume_finalize`；保存正式版本仍需要显式确认。

## 复盘

之前的问题不是缺少更多提示词，而是把领域完成循环停在了前端 toast。修复重点应放在 LangGraph/DeepAgents 的 middleware 与外部事件恢复边界上；UI 只呈现实际状态，不能用固定文案代替 Agent 行为。

本次进一步确认：提示词拼接只是 DeepAgent 接收 `systemPrompt` 的普通配置方式，不是 DeepAgent 的业务编排机制。DSH 能力应拆成 Skill（可复用领域知识）+ 工具（动作）+ Middleware（权限和拦截）+ workflow state（确定性完成门）。当前 Skill 已接入，后续重点是补自动测试和把测量续跑迁移为 durable interrupt/checkpointer，而不是继续堆叠系统提示词。
