# DSH 简历 Agent 能力对齐：对接复盘

更新：2026-09-18。此文档是后续 Agent/开发者的接手入口；实现事实以代码和测试为准。

## 已实现的决定

CVAgent 对齐 DSH `dsh-resume` MCP 的**简历生产业务契约**，不复用 DSH 宿主运行时。不得 import DSH 的 `ctx.tools`、全局工作区、侧栏状态或 `companies/` 文件结构。

CVAgent 的独立边界保持不变：源文件只读、草稿位于 `.cvagent/drafts`、工作区模板位于 `templates/` 与 `.cvagent/templates` 修订目录、正式投递版本位于 `.cvagent/versions`。

## 代码落点

| 能力 | CVAgent 实现 | 对齐含义 |
| --- | --- | --- |
| 生产规则 | `backend/src/agent/resume-production-contract.js` | 证据账本、压缩 STAR、内容优先级、一/两页策略、模板/图标/验收门 |
| Agent 提示 | `backend/src/agent/system-prompt.js` | 撰写/改写/诊断时必须先读生产规则；禁止伪造指标 |
| 图标目录 | `icon_list(query, limit)` | 复用已迁移 registry；只返回受限条目，未知 token 不得猜测 |
| 布局校验 | `layout_validate(layout)` | 复用已迁移 layout schema；仅校验/规范化，不写模板 |
| 版式建议 | `presentation_suggest(round)` | 仅用当前 `renderId` 真实 metrics 提案；永不自行持久化 |
| 版式写入 | `presentation_update` | 仍是唯一 presentation 持久化入口；变更后强制新渲染/测量 |
| 正式版本 | `resume_save_version` 与 `/api/agent/save` | 仅验收通过 + 明确确认后保存；记录 `targetRole`、`company`、`jobDescriptionPath` |

## 不能破坏的工序

```text
prepare → read → check → mutate
→ check → render
→ 浏览器回传当前 renderId 的 metrics
→ finalize → 用户明确确认 → save
```

- 内容、模板、presentation 任一变更，都会作废旧测量。
- `resume_metrics` 只提供给产品测量回调，模型不得调用或虚构。
- `presentation_suggest` 只能建议；用户确认后才可由 Agent 调用 `presentation_update`。
- 页数相等不代表合格：仍需逐页 occupancy、无 overflow，且多页 spread 合格。
- 结构/CSS 改动先复制模板或经用户确认保存模板；字号、行距、边距、颜色、图标偏移不改正文。
- 正式版本必须保留模板快照和展示参数快照；岗位、公司、JD 路径仅是索引元数据。

## 实测证据

1. `backend`: `npm.cmd test`，45/45 通过。覆盖工具注册、真实 metrics 门、建议不自动写入、显式保存与岗位化版本元数据。
2. `frontend/react`: `npm.cmd run build` 通过（TypeScript 与 Vite 生产构建）。
3. 真实浏览器：以新后端启动的本地页面执行只读 Agent 指令。Agent 依次实际调用：
   `resume_production_guide` → `icon_list(query=github, limit=3)` → `layout_validate(single-column education)`。
   UI 时间线和 Markdown 表格均渲染了调用结果；响应明确显示未修改简历、模板、presentation 或正式版本。

## 后续工作守则

新增任何简历工具时，先判断它属于：内容、模板结构、presentation、浏览器测量、验收还是正式版本。不能绕过上述工序，也不能把 DSH 宿主代码直接粘入 CVAgent。

若要继续增强，应优先做“JD/证据账本的产品化表单或可视化状态”，而不是增加会绕开验收门的快捷写入接口。每次涉及渲染、测量或 Agent 工具的变更，至少运行后端测试、前端构建，并截图验证实际浏览器结果。
