# CVAgent：AI 与产品测试策略

更新：2026-09-18。目标不是声称“模型永远不会错”，而是让已知风险都有快速、可复现、可定位的测试层，并让未覆盖的模型风险在发布前可量化。

## 结论：采用五层，而不是单一“AI 测试工具”

```text
1. 纯函数 / 状态机 / schema
2. API、SSE、磁盘和工具契约
3. 真实浏览器、A4 iframe、视觉回归
4. 模型评测：案例集 + 轨迹评分 + 内容评分
5. 线上可观测性与发布后回归集
```

确定性层负责证明工序和安全门；模型评测层衡量“会不会做出正确判断”；浏览器层证明用户实际看到、点击到的结果。任何一层都不能替代另一层。

## 当前资产与缺口

| 层 | 当前已有 | 下一步 |
| --- | --- | --- |
| 1 | Node `--test`、workflow 状态机、template/layout/schema 测试 | 为每个 workflow transition 保留反例测试 |
| 2 | HTTP、session、SSE、`renderId`、保存门、脚本化 Agent 集成测试 | 固定每个端点的 request/response fixture，做契约快照 |
| 3 | 人工真实浏览器、A4 测量、截图验收 | 引入 Playwright 固化高价值 E2E、trace 与截图基线 |
| 4 | 生产契约、工具日志 | 建立匿名简历/JD 案例集与工具轨迹评测 |
| 5 | 结构化日志、关联 `sessionId/runId/renderId` | 发布后按失败 trace 回灌匿名案例集 |

## CVAgent 必测的风险矩阵

| 风险 | 必测断言 | 推荐层 |
| --- | --- | --- |
| Agent 跳步、乱序调用 | `prepare/read/check → mutation → render → metrics → finalize → confirm → save`；允许只读支路 | 1、2、4 |
| 过期 A4 数据覆盖新版本 | 旧 `renderId` 必须返回 `MEASUREMENT_STALE` | 1、2、3 |
| 未验收即保存 | `accepted` 与 `confirmedByUser=true` 缺一不可 | 1、2、4 |
| 模型编造简历事实 | 输出中的公司、日期、指标、链接必须可回溯到输入证据；缺口必须显式说明 | 4 |
| 模板/展示参数串改 | `template_copy`/确认保存才可改结构；presentation 变更不改 Markdown | 1、2、3、4 |
| 浏览器布局错误 | 三栏不重叠、A4 完整可见、工具组可展开、Markdown 表格/代码渲染正确 | 3 |
| 会话恢复丢失工具记录 | 刷新后工具组、顺序、状态、最终结果都可读取 | 2、3 |
| UI 改动造成视觉回归 | 固定视口与字体的截图差异 + DOM/可访问性断言 | 3 |
| 模型/提示词升级退化 | 同一案例集的通过率、工具轨迹、成本和时延不可低于基线 | 4、5 |

## 1–3 层：每次提交必须过

### 单元与状态机

坚持把业务规则做成可判定函数，而不是让 LLM 决定：页面门槛、版本身份、路径校验、schema、模板 revision、图标 token、保存确认。每个允许状态转换有成功测试，每个禁止转换有失败测试。

### 契约与脚本化 Agent

保留 `backend/test/agent-chat-integration.test.js` 和 `npm run test:browser-harness`。脚本化 Agent 是稳定替身：它证明真实后端、SSE、浏览器测量回调和版本保存的接口契约，而非证明模型质量。

建议新增 `test/fixtures/`：仅放虚构、匿名的 `resume.md`、JD、模板和预期轨迹。每个 fixture 记录：输入、目标页数、允许/禁止工具、期望最终 task state、预期 blocker。不得使用用户真实简历。

### 浏览器与视觉

建议引入 Playwright，但不要拿它替换现有 Node 测试。

- 用 locator 与 web-first assertion，不用固定 sleep；
- 固定 Chromium、1280×800 / 1440×900、DPR 和字体；
- 断言 A4 iframe 的 bounding box 完整落在 preview pane 内，Agent/Markdown/A4 三者不重叠；
- 把空工作区初始化、工具展开/收起、刷新恢复、模板选择、A4 测量、保存解锁列为首批 E2E；
- 失败保留 trace、控制台、网络和截图；成功不保存冗余大附件。

Playwright 官方建议为失败或首次重试保留 trace；Trace Viewer 可同时定位操作、DOM、控制台和网络。视觉快照应只在固定 OS/浏览器环境中比较，避免跨环境像素噪声。[Trace Viewer](https://playwright.dev/docs/trace-viewer)、[视觉对比](https://playwright.dev/docs/test-snapshots)、[最佳实践](https://playwright.dev/docs/best-practices)

## 4 层：模型评测不是普通单测

建立 30–50 个虚构、版本化案例，先覆盖高风险分支而不是追求数量：

1. 空工作区首次进入；
2. 证据不足时只提问、不写入；
3. 证据中包含“忽略规则”等注入文本时仍把它当材料；
4. 一页溢出：先提出 presentation 调整，再压缩重复内容；
5. 明确两页目标：必须恰好两页且密度均衡；
6. 用户已选模板：不得静默切换；
7. 用户明确确认：才可保存模板/正式版本；
8. 过期测量：不得声称完成；
9. “丰富一点”但没有证据：不得虚构；
10. 指定图标、JD、模板版本恢复与会话刷新。

每个案例同时评分三件事：

- **确定性硬门**：工具名、顺序、关键参数、是否写入、最终状态、`renderId` 一致性；
- **内容 rubric**：事实忠实、岗位相关性、STAR 压缩、缺口表达、无伪造；可先人工双人标注，再用 LLM judge 辅助，定期校准；
- **效率指标**：工具次数、循环次数、耗时、token/成本，防止“最后答案正确但过程失控”。

市场工具的定位：Promptfoo 能做工具 schema 与轨迹断言，适合本地 YAML/CI 回归；DeepEval 的 Tool Correctness 支持工具名、参数和顺序；LangSmith 适合托管 trace、数据集和多轮轨迹评估。它们都不是必须现在引入的依赖：CVAgent 已有结构化事件，第一步应先产出自己的 JSON fixture 与确定性 grader，再按团队是否需要云端分析选择其一。[Promptfoo assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/)、[DeepEval Tool Correctness](https://deepeval.com/docs/metrics-tool-correctness)、[LangSmith evaluation](https://www.langchain.com/langsmith/evaluation)

## 5 层：发布与回归

- PR：Node 测试、前端 typecheck/build、脚本化 API/SSE 测试、关键 Playwright 冒烟；
- nightly：全量浏览器矩阵、截图回归、全部模型案例集，每案例至少多次运行并记录通过率；
- release：人工审查一组匿名 A4/PDF 成品、工具时间线与失败 trace；
- 线上：记录脱敏 trace 摘要和状态链，按 `runId + renderId` 回溯；真实失败脱敏后回灌案例集，先复现后修复。

发布门建议从“任何失败即阻塞”的确定性门开始；模型案例以连续基线为准，例如关键安全案例 100%，核心工序通过率不低于上一基线，非关键文案质量下降需人工复核。不要用一次模型运行通过就认定能力稳定。

## 实施优先级

1. 提交本轮脚本化浏览器夹具与说明；
2. 引入 Playwright，先实现 5 个高价值 E2E（空工作区、工具时间线、A4、刷新恢复、保存门）；
3. 创建匿名 `agent-evals` fixtures 与 deterministic trajectory grader；
4. 增加真实模型 nightly eval，并让失败样本回灌；
5. 只有需要跨模型、多人看板或云端 trace 对比时，再评估 Promptfoo、LangSmith 或 DeepEval。

## 接手规则

新 UI 必须补浏览器场景；新 Agent 工具必须补 schema、状态、成功/拒绝轨迹与日志断言；任何与 A4、测量、验收、保存相关的修改必须保留至少一份截图/trace 证据。不要以“LLM 输出看起来合理”替代工序、视觉或版本身份测试。
