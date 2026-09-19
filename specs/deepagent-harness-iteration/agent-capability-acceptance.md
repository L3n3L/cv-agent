# CVAgent Agent 能力验收与 DSH 对齐复盘

更新时间：2026-09-20  
验收输入：用户提供的林能隆简历正文，无额外 JD  
参考基线：E:/vsws/deepseek-harness-plugins/1-插件源码/dsh-campus-job

## 结论

这次验收证明，Agent 的主要短板不在“不会写简历”，而在 Harness 没有把确定性的生产规则放到模型循环之外。原链路能读材料、写隔离草稿、渲染和接收 A4 测量，但会出现大量重复 icon_list、测量未完成时继续请求版式建议、最终语义结构没有进入硬验收门等问题。本轮在余额恢复后又用真实 DeepAgent 重跑了用户简历，链路最终成功。

本轮采用 DSH 的关键做法修正：

~~~
模型：判断内容、证据取舍和版式策略
Harness：控制状态、身份、工具预算、恢复动作和最终验收
UI：只投影持久化事件，不重新拼装一套聊天事实
~~~

## 真实验收证据

使用本轮真实简历内容时，旧链路出现过以下可复现现象：

- 多次生产回合累计调用 icon_list 57 次，说明模型被迫承担了“查一次并复用”的确定性工作；
- 自动续跑达到 4 轮后仍停在 needs_revision，最终一页占用率约 0.864；
- 工具过程中出现重复读、MEASUREMENT_REQUIRED/TOOL_FAILED 类阻断，模型需要猜下一步；
- 旧质量门只看排版指标，没有同时检查标题语义、标准顺序和语义图标，因此“教育/实习/项目/技能/荣誉”结构错误可能进入最终渲染；
- 历史聊天曾出现用户消息、工具过程和 Agent 回复脱离事件顺序，说明 UI 读模型不能以“最后一次回复”或多个数组拼装事实。
- 一次自动调参回合曾记录 `pageCount=1 / occupancy=0.929`，但浏览器 iframe 实际存在 2 个 A4 页面，说明前端测量 payload 与 DOM 发生了竞态；该结果不能作为有效验收证据。

这不是闭门造车判断。DSH 的 dsh-campus-job/docs/mcp-integration-retrospective.zh.md、mcp-server/index.js 和 lib/resume-guide.js 都采用了服务端状态、结构化 nextTool、当前 render 身份校验和确定性最终验收；该插件的模板/图标/排版能力作为业务基线，而不是把 DSH 的宿主实现原样搬过来。

## 本轮落地

### 1. 统一简历语义源

新增 backend/src/migrated/resume-engine/semantics.js，由渲染器和质量门共同使用：

- 教育、经历、项目、技能、荣誉等标题只在一个映射表里定义；
- 渲染器不再把“荣誉奖项”当成普通自定义模块；
- 质量门检查标准顺序和语义图标是否匹配；
- 语义错误在 resume_verify 阶段阻断完成，不再等到截图后才发现。

### 2. 把重复工具调用变成 Harness 问题

workflow-guard-middleware 增加：

- 只读工具同参数结果缓存与回放；
- 单工具调用上限和整轮总调用上限；
- 超限返回 TOOL_BUDGET_EXCEEDED、nextTool、nextAction 和当前状态；
- 记录 read_result_replayed、tool_budget_exceeded 等干预事件。

这对应 DSH 的“结构化恢复结果”原则：工具失败不是让模型重新猜流程的异常字符串，而是机器可读的状态转移。

### 3. 收紧测量前置门

workflow-coordinator 现在会在 rendered 之外拒绝 presentation_suggest 和 template_autotune；渲染完成后必须先接收当前 renderId 的真实测量。这样 MEASUREMENT_REQUIRED 是明确的过渡状态，不会继续执行盲调。

### 4. 把最终验收变成内容与版式双门

resume_verify 在原有 DSH 对齐检查、渲染和 A4 指标之外，重新读取当前隔离草稿并执行语义质量检查。内容结构不合法时返回 needs_revision 和明确修复方向；不能用排版调参掩盖内容结构错误。

### 5. 把真实测量做成 DOM 一致性事务

- 前端只接受同时满足 `renderId`、iframe 根节点 `data-render-id`、DOM 实际页数、测量 payload 页数四项一致的结果；不一致时丢弃并等待下一次稳定测量。
- 后端要求 `occupancy.length === pageCount`；若提供 `pages`，还要求 `pages.length === pageCount`，否则返回结构化 `MEASUREMENT_INVALID`，不能把部分页数据推进验收。
- 逐页 `moduleDetails` 和 `visualAudit` 会随测量持久化，孤立模块、页数不一致和溢出都进入最终验收门。

## 目标链路

~~~
用户消息
  → DeepAgent 选择业务动作
  → Harness 注入当前状态与 canonical nextTool
  → Workflow Guard 检查权限、身份、预算和重复调用
  → Domain Tool 执行真实读写/渲染/测量
  → Session Store 以 sequence 持久化事件
  → React reducer 按 arrival sequence 投影用户消息、工具过程、Agent 回复
  → resume_verify 同时检查语义结构和真实 A4 指标
~~~

每个用户回合的工具过程应是该回合中按时间抵达的工具事件集合，可折叠/展开；它不应被移动到下一条消息之后，也不应从多个历史数组按时间戳二次拼接。

## 验收标准

### Agent/Harness

1. 给定本轮简历，能够生成标准顺序：教育经历 → 实习经历 → 项目经历 → 技能 → 荣誉；缺失模块可以跳过。
2. 同一回合内 icon_list 不得因同参数重复执行；达到上限时必须停止并返回结构化下一步。
3. rendered 状态只能接收当前 renderId 的 A4 测量；版式建议和自动调参不能越过测量。
4. 结构错误、图标语义错误、溢出或密度不足都不能被 resume_finalize 宣布完成。
5. DRAFT_REQUIRED、MEASUREMENT_REQUIRED、TOOL_BUDGET_EXCEEDED 必须保留当前任务状态、恢复工具和原因，不应退化成无上下文的 TOOL_FAILED。
6. 对同一用户回合的流式文本、持久化最终回复和工具事件只能产生一个稳定 UI 事实源。

### 成品

1. 简历内容来自用户提供事实，不添加未证实的雇主、日期、指标或技术。
2. 默认目标是一页可读 A4；若真实测量未通过，界面显示未通过原因，不宣称已经完成。
3. 真实截图需检查标题顺序、页面密度、预览内容和聊天顺序；自动化通过不替代截图验收。

## 本轮代码验收

- 真实 DeepAgent：余额恢复后重新发送用户任务，9 项工具完成；保留用户消息、工具过程和 Agent 回复；完成草稿写入、语义检查、重新渲染、真实测量和最终验收。
- 真实后端状态：`accepted`、`runState=idle`、`pageCount=1`、`occupancy=0.948`、无 blocker、无 `lastError`。
- 真实浏览器截图：iframe 实际 `.cvagent-resume-page` 数量为 1；预览中教育、实习、项目、技能、荣誉均存在，和后端测量一致。
- 后端全量测试：92/92 通过。
- 前端构建：`tsc --noEmit && vite build` 通过。
- 代码检查：`git diff --check` 通过（仅有 Windows 文本换行提示）。
- 新增覆盖：简历语义顺序/图标门、只读结果回放、工具调用预算、测量前置门、DOM/测量页数一致性、真实多轮用户消息保留。

## 后续不做的事

- 不继续无限增加系统提示词来替代状态机；
- 不把 DSH 的双工具通道原样复制到 CVAgent；
- 不删除语义和真实测量门来“让演示看起来成功”；
- 不用历史会话的兼容补丁掩盖新数据流问题，开发阶段允许清理旧 session 后按新 schema 回归。
