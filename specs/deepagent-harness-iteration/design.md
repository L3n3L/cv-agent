# DSH → DeepAgent 原生对接设计

更新时间：2026-09-19

## 分层原则

```text
稳定原则                 → systemPrompt
DSH 简历领域流程          → native resume-production Skill
读写/渲染/测量/验收动作   → domain tools
工具权限与状态门禁        → middleware + server workflow
跨轮状态与外部测量恢复    → session state / future checkpointer interrupt
```

模型负责判断内容、选择工具和组织修改；Harness 负责工具面、权限、状态一致性、测量闭环、预算和用户确认。这样既保留 DeepAgent 的 ReAct 工具循环，也保留 DSH 的确定性业务契约。

## Skill 接入

- canonical 文件：`backend/skills/resume-production/SKILL.md`
- 格式：Agent Skills YAML frontmatter + Markdown 正文。
- 来源标记：`dsh-resume`、`1.9.0`，用于后续与 DSH 复盘版本对照。
- 生产模式通过 `createDeepAgent({ skills: ['/skills/'] })` 启用。
- 当前 Agent 未使用外部文件系统 backend，因此由 `resumeProductionSkillFiles()` 把 Skill 文件以 DeepAgent StateBackend 的 `files` 输入提供给本轮 Agent；这不会给模型开放宿主仓库。
- DeepAgent 启动时只注入 Skill 元数据，模型需要时通过原生文件工具读取完整 `SKILL.md`，符合 progressive disclosure。

## 提示词边界

`CVAGENT_SYSTEM_PROMPT` 只保留身份、语言、证据安全和“生产规则来自 Skill”的稳定原则。执行模式提示只说明当前权限和推进意图，不重复 DSH 全部业务规则。`resume_production_contract.js` 暂时保留给 MCP 兼容工具和老调用方，后续以 Skill 为规范源逐步收敛，避免一次性破坏协议。

## 工具与门禁

- 工具描述继续定义输入、输出和副作用；工具不依赖模型理解来保护写入、当前草稿、`renderId` 和正式保存。
- `execution-mode-middleware` 过滤 chat/read-only 的工具面；生产模式启用官方 `todoListMiddleware`。
- `resume_finalize` 继续作为完成门；真实浏览器测量继续通过当前 `renderId` 回写。
- 普通对话和只读检查不加载生产 Skill，避免无关上下文和规划卡片污染用户聊天。

## 兼容性与取舍

### 为什么不是把 DSH 文本全部拼到 system prompt

字符串拼接能工作，但会让每个模式都携带完整领域规则，导致 token 浪费、规则重复和修改难以追踪。Skill 的元数据常驻、正文按需读取，正好适合 DSH 这种可复用长流程。

### 为什么不把所有规则写成 Middleware

Middleware 适合工具权限、状态校验和事件拦截，不适合承载“如何选择项目、如何压缩 STAR、如何解释取舍”这类需要模型判断的内容。把这些硬编码会把 Agent 变成固定脚本。

### 为什么不只依赖 Skill

Skill 是模型指导，不是安全边界。真实测量、旧 render 拒绝、保存确认、写入路径限制必须由业务工具和服务端工作流确定性执行。

## 测试策略

1. 静态契约：Skill frontmatter、DSH 来源版本、关键流程词和文件状态。
2. Agent 配置：生产模式含 native skill source；chat/read-only 不含。
3. 服务器输入：生产调用带 StateBackend skill file；其他模式不带。
4. 回归：后端全量测试、前端构建、真实浏览器生产链路和截图验收。
5. 观察：现有日志记录 executionMode、toolName、renderId；Skill source/version 先由静态元数据和自动化测试校验，后续再纳入日志，不记录用户简历正文和模型私有推理。
