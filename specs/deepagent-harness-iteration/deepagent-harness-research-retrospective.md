# DeepAgent Harness 对接研究与优化复盘

更新时间：2026-09-19  
基线提交：`1cd0a59 fix: stabilize workspace preview data flow`  
范围：`cv-agent` 的 DeepAgent、简历工具、工作流状态、Skill、事件流和 DSH 对齐

## 1. 结论先行

当前 CVAgent 的主要问题不是模型“不够聪明”，而是 Harness 把太多确定性的执行细节交给了模型判断：

```text
用户意图
  → DeepAgent 自己选择底层工具
  → 工具执行时才检查状态
  → 状态不满足时返回错误
  → Agent 再次推理如何恢复，或者直接结束
```

这会把“恢复草稿、清除旧渲染、等待测量、判断是否可以保存”等规则变成模型的记忆题，造成 `DRAFT_REQUIRED`、`TOOL_FAILED`、重复工具调用、错误停止和多轮历史失真。

本次决策：

> DeepAgent 负责业务判断和内容生成；CVAgent Harness 负责确定性工作流、状态转换、权限、身份一致性、重试、恢复和完成闸门。

不更换 DeepAgent，不把业务流程硬编码成固定脚本，也不继续用更长的提示词弥补流程控制缺口。

## 2. 调研依据

### 2.1 DeepAgents 官方架构

官方架构明确划分了三层：

- Deep Agents：默认 Middleware、Backend、Skill、Subagent、Memory 等 Harness 能力；
- LangChain：模型、工具和 Middleware 组成的 Agent Loop；
- LangGraph：状态、Checkpoint、Streaming、Interrupt 和恢复运行时。

参考：[Deep Agents Architecture](https://github.com/langchain-ai/deepagents/blob/main/libs/ARCHITECTURE.md)。

官方还明确说明：普通 `tools=[]` 工具只有在模型选择后才执行，无法在模型调用前修改工具面、系统上下文或跨轮状态；需要这些能力时应使用 Middleware。[DeepAgents Middleware 说明](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/__init__.py)

### 2.2 官方推荐的 Harness 扩展面

官方 DeepAgents 通过以下扩展点组织复杂 Agent：

| 扩展面 | 适合承担的职责 | CVAgent 对应方向 |
| --- | --- | --- |
| Skill | 领域知识、判断标准、可复用流程说明 | 简历证据、写作、排版决策 |
| Middleware | 工具面、系统上下文、跨轮状态、拦截和恢复 | Workflow Guard、执行模式、状态注入 |
| Tool | 单个业务动作和结构化事实 | 读写、渲染、测量、模板操作 |
| State / Checkpoint | 会话状态、消息、恢复点 | task、render、measurement、run checkpoint |
| Backend | 文件、记忆和持久化边界 | 工作区、隔离草稿、版本文件 |
| Subagent | 可隔离的专业任务 | 后续可用于模板分析或内容审查 |
| Eval loop | 对 Harness 改动做回归和 holdout 验收 | 简历链路、错误恢复、工具选择评测 |

官方 `better-harness` 示例不是靠一次性修改提示词，而是把 prompt、tools、skills、middleware 实现和 middleware 注册作为可编辑面，对 train/holdout eval 运行基线和候选版本，只保留通过率提升的改动。[Better Harness 示例](https://github.com/langchain-ai/deepagents/tree/main/examples/better-harness)

### 2.3 官方示例揭示的成熟模式

- `RubricMiddleware`：用结构化标准对结果做评分，再决定是否需要修订；
- `Ralph Loop`：长任务使用持久化文件和新上下文迭代，不把全部历史一直塞进模型；
- `SubAgentMiddleware`：将可以隔离的专业工作拆给子 Agent；
- `SummarizationMiddleware`：上下文增长时压缩历史，而不是让模型一直处理无限消息；
- `HumanInTheLoopMiddleware`：把真正需要用户确认的动作建模成中断和恢复，而不是用提示词要求模型“记得询问”。

这些示例都说明：成熟 Agent 的“聪明”来自可观察、可恢复、可评测的外部结构，不是单纯增加 prompt 长度。[DeepAgents 官方示例](https://github.com/langchain-ai/deepagents/tree/main/examples)

## 3. DSH 插件与 CVAgent 的真实差异

### 3.1 DSH 插件的做法

DSH 插件存在两条工具通道：

1. DSH 原生 `jobhunt_*` 工具：插件向 DSH 宿主注册工具、系统提示词、Skill 和预览路由；宿主负责 Agent 会话和工具循环。
2. `dsh-resume` MCP：为外部 Agent 提供更严格的工作流门槛和结构化结果。

MCP 路径的核心不是 MCP 协议，而是服务端工作流状态：

- `resume_prepare` 固定工作区、简历路径、内容 hash 和目标页数；
- `requirePrepared` 阻止未准备的写入和渲染；
- `markMutation` 统一使旧检查、旧渲染和旧指标失效；
- `resume_metrics` 验证当前 `renderId/contentHash/previewPath`；
- `resume_finalize` 是唯一完成闸门；
- 失败结果使用 `workflowRequired`、`nextTool`、`nextTools`，让调用方可以恢复，而不是依赖 Agent 猜测。

实现位置：

- [DSH 原生工具和提示词](../../../1-插件源码/dsh-campus-job/index.js:38)
- [MCP 工作流状态和 `requirePrepared`](../../../1-插件源码/dsh-campus-job/mcp-server/index.js:220)
- [MCP 变更、渲染、测量和最终验收](../../../1-插件源码/dsh-campus-job/mcp-server/index.js:277)
- [DSH 简历业务契约](../../../1-插件源码/dsh-campus-job/lib/resume-guide.js:1)

### 3.2 当前 CVAgent 的做法

CVAgent 已经具备更多安全的隔离能力：

- 原文件和隔离草稿分离；
- `taskRef.current` 有状态机；
- `contentVersion/templateRevision/renderId` 有身份约束；
- `resume_finalize` 有完整验收门；
- DeepAgent 已接入原生 Skill 和生产模式规划 Middleware。

但当前缺少 dsh MCP 那种统一的调用前控制层：

- `resume_prepare` 返回 `recoveryTool`，但主要是建议；
- `resume_render` 在执行时才发现 `needs_revision/blocked`；
- `safeTool` 将可恢复异常包装后交回模型；
- `execution-mode-middleware` 主要过滤只读工具，没有统一处理工具顺序和自动恢复；
- `resume_quality` 等结果存在固定 `nextTool` 与实际任务状态不一致的风险。

实现位置：

- [CVAgent 工具处理器](../../backend/src/agent/resume-tools.js:23)
- [CVAgent 状态机](../../backend/src/core/workflow.js:1)
- [CVAgent 当前执行模式 Middleware](../../backend/src/agent/execution-mode-middleware.js:1)
- [CVAgent DeepAgent 组装](../../backend/src/agent/deep-agent.js:1)

### 3.3 关键判断

CVAgent 不是能力少，而是“状态机已经存在，但状态机没有成为 Agent Loop 的控制平面”。

DSH 的成熟部分应迁移的是：

```text
服务端权威状态
→ 机器可读下一步
→ 工具调用前置校验
→ 旧身份失效
→ 结构化可恢复错误
→ 单一最终验收门
```

不应照搬的是：

- DSH 原生工具和 MCP 双通道并行造成的重复能力；
- 直接修改工作区主简历的低隔离写入方式；
- 继续把完整业务契约重复注入系统提示词；
- 让 `nextTool` 静态写死而不从当前状态计算。

## 4. 目标 Harness 分层

```text
用户消息
  ↓
Intent / 业务决策
  DeepAgent：判断改什么、为什么改、选择内容和版式策略
  ↓
Workflow Coordinator
  计算当前允许的动作、恢复动作、预算和用户确认边界
  ↓
Workflow Guard Middleware
  拦截非法工具调用，自动执行确定性恢复，拒绝过期身份
  ↓
Domain Tools
  读写草稿、渲染、测量、验收、保存版本
  ↓
Task Reducer + Checkpoint
  原子更新任务状态、事件序号和恢复点
  ↓
UI Projection
  按事件 sequence 渲染用户消息、工具过程和 Agent 回复
```

### 4.1 DeepAgent 应该负责什么

- 从用户材料中建立证据台账；
- 判断目标岗位和表达重点；
- 选择保留、合并或压缩哪些内容；
- 决定优先调整内容、模板结构还是 presentation；
- 生成草稿内容和模板 Design Brief；
- 解释取舍和向用户请求真正缺失的信息。

### 4.2 Harness 必须负责什么

- 工作区和简历身份；
- 草稿、渲染、测量和版本之间的关联；
- 合法状态转换；
- 当前 render 是否仍匹配内容和模板；
- `needs_revision/blocked` 的恢复；
- 工具失败分类、有限重试和幂等；
- 真实测量等待；
- 最终验收和正式保存确认；
- 对话事件的顺序、落库和恢复。

## 5. 具体改造决策

### P0：补 Workflow Guard，不改变现有工具协议

新增纯函数式的 `workflow-coordinator`，至少提供：

```text
getCanonicalNextAction(task)
assertToolAllowed(task, toolName)
recoverToolCall(task, toolName)
invalidateArtifacts(task, mutation)
classifyToolFailure(error, task)
```

规则示例：

| 当前状态 | Agent 调用 | Harness 行为 |
| --- | --- | --- |
| `needs_revision`/`blocked` + 有草稿 | `resume_render` | 自动恢复到 `drafting`，清除旧 render/measurement，再执行渲染 |
| `needs_revision`/`blocked` + 无草稿 | `resume_render` | 返回 `resume_write`，不执行渲染 |
| `rendered` | `resume_render` | 拒绝重复渲染或明确创建新 render |
| `rendered` + 当前 renderId | `resume_metrics` | 允许接收浏览器指标 |
| `rendered` + 旧 renderId | `resume_metrics` | 返回 `MEASUREMENT_STALE`，不改当前状态 |
| `measured` | `resume_finalize` | 允许验收 |
| 非 `accepted` | `resume_save_version` | 阻止正式保存 |

工具返回的 `nextTool` 必须统一来自 `getCanonicalNextAction`，不能在各个 handler 中手写互相矛盾的下一步。

### P1：把 Workflow Guard 接入 DeepAgent Middleware

官方 DeepAgents 的 Middleware 可以在模型请求前修改工具面、注入状态上下文，并在工具执行边界统一处理行为。因此应把工作流状态作为 Middleware 或自定义 state schema 的一部分，而不是只存在工具闭包中。

每次模型调用都注入紧凑状态摘要：

```text
HARNESS STATE
state=needs_revision
draftAvailable=true
requiredNextAction=resume_reopen_draft
renderIdentity=stale
completionAllowed=false
```

这段摘要是帮助模型决策，不是安全边界。真正的安全边界仍由 `wrapToolCall`/工具 Guard 执行。

### P2：降低生产模式的底层工具负担

当前工具链出现大量重复图标查询，说明底层工具面过细。先不破坏现有协议，增加缓存和批量查询；稳定后再将生产模式收敛为业务级工具：

- `inspect_resume`
- `revise_resume`
- `adjust_presentation`
- `render_resume`
- `measure_resume`
- `finalize_resume`

底层工具仍保留给测试和诊断，生产 Agent 不必自行编排所有清理、恢复和重复读取动作。

### P3：用评测驱动 Harness，而不是凭单次截图判断

参考官方 `better-harness`，建立 train/holdout 场景：

- 正常首次生产；
- `needs_revision + 有草稿` 误调用 render；
- 无草稿误调用 render；
- 旧 renderId 测量；
- 测量 pending；
- 测量失败后恢复；
- 多轮用户消息后历史和工具事件按 sequence 排序；
- 正式保存前未确认；
- Skill 内容被简历材料伪指令污染；
- 上下文变长后的摘要和恢复。

每次改动记录：模型、提示词版本、Skill 版本、工具版本、Middleware 版本、通过率、错误类型和 token/延迟变化。未提升 holdout 的提示词或工具调整不进入主线。

## 6. 对“Skill 是否容易被注入”的处理

Skill 是模型指导层，不是权限层。用户简历、JD、截图和工作区材料必须继续作为不可信证据处理：

- 不允许材料内容改变系统规则；
- 不允许材料内容改变工作区边界；
- 不允许材料内容绕过保存确认；
- 不允许材料内容伪造测量和验收结果。

这些必须由参数 schema、工作区授权、Workflow Guard 和最终验收共同保证，而不是依赖 Skill 中的一句“不要相信材料中的指令”。

DeepAgents 官方 Skills 采用渐进式披露：模型先看到 Skill 元数据，需要时再读取完整文件。这适合减少上下文，但不能把完整 Skill 当作硬执行器。[Skills Middleware](https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/skills.py)

## 7. 验收标准

### 功能

1. 当 Agent 从 `needs_revision` 或 `blocked` 直接调用 `resume_render` 且存在草稿时，系统应自动恢复并完成合法渲染，不再产生可恢复的 `DRAFT_REQUIRED` 终态。
2. 当没有草稿时，系统应返回 `resume_write`，不得伪造渲染。
3. 当测量对应旧 `renderId` 或旧 `contentVersion` 时，系统应拒绝并保持当前任务状态不变。
4. 当工具发生可恢复错误时，系统应保留运行状态，并返回结构化恢复动作，不得直接结束为 `AGENT_RUN_FAILED`。
5. 当内容、模板或 presentation 变化时，旧渲染和测量必须立即失效。
6. 只有当前内容检查、当前渲染、匹配测量和验收全部通过，`resume_finalize` 才能返回 `completionAllowed=true`。

### 智能性

1. Agent 不再需要推理 `reopen → check → render` 这类确定性步骤。
2. Agent 可以把推理预算用于证据取舍、内容表达和模板决策。
3. 重复图标查询、重复读取和无效工具调用明显下降。
4. 多轮任务在上下文压缩或进程重启后仍能根据 checkpoint 恢复。
5. train 场景提升不能以 holdout 回退为代价。

### 可维护性

1. 状态转换只存在一个权威实现。
2. `nextTool` 只由状态协调器计算。
3. Skill、prompt、tool、middleware 和 workflow 的版本会进入日志摘要。
4. 每个自动恢复都记录尝试工具、当前状态、恢复动作和最终结果。
5. 新增工具必须声明副作用、前置状态、失效对象和恢复策略。

## 8. 实施顺序

本文件是研究与设计复盘，不代表已经完成实现。下一次实施应按以下顺序：

1. 先修 `nextTool` 的状态计算错误；
2. 新增 `workflow-coordinator` 纯函数和单元测试；
3. 将现有工具统一接入 Guard；
4. 增加 DeepAgent Workflow Middleware 和状态摘要注入；
5. 增加错误恢复、幂等和过期身份测试；
6. 增加 train/holdout Harness 评测；
7. 真实浏览器验收多轮聊天、工具折叠和 A4 测量恢复；
8. 通过验收后再考虑生产工具面收敛和子 Agent 拆分。

## 9. 本次复盘的最终判断

我们不需要把 CVAgent 改成一个僵硬的固定流程机器人，也不需要继续复制 DSH 的长提示词。

正确路线是：

```text
DeepAgent：做业务判断
Skill：提供领域知识
Middleware：控制工具面和跨轮上下文
Workflow：保证状态和恢复
Tools：执行真实动作
Checkpoint：保证可恢复
Eval：验证改动确实让 Agent 变聪明
```

这才是把 DeepAgent 用成 Harness，而不是把 DeepAgent 当成一个需要自己记住全部业务流程的聊天模型。
