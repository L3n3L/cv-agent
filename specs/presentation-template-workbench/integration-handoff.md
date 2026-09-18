# Presentation 与模板工作台：后续对接复盘

## 已确认事实

- DSH 的领域契约位于 `1-插件源码/dsh-campus-job/index.js` 与 `lib/presentation.js`；手动调整的实际 UI 位于 `client/client.js` 的 `tuningPanel`（约 3832 行），视觉 Token 位于同文件的 Template Workshop（约 3700 行）。不要复制 `ctx.tools`、宿主 UI 或全局工作区逻辑。
- CVAgent 已有 `presentation_update`、`presentation_suggest`、`template_generate`、`template_save`、`template_copy`、`template_versions`、`template_restore`、`layout_validate` 和真实 A4 验收门。
- DSH 的手动调整限定为字体/布局滑杆和真实 A4 图标的逐项微调；强调色、分隔线、圆角等 visual Token 在 Template Workshop，不属于该弹层。滑杆先只更新本地 presentation draft 和 iframe，撤销栈最大 20；保存简历版本时才绑定参数。CVAgent 的 A4Pane 保持这个 draft 行为，额外的“应用到当前草稿”只为生成可追溯的 `renderId` 和真实测量，不能等同于保存模板或正式版本。
- 模板 API 已可列出、生成候选、保存、复制、列版本、恢复；模板库已显示来源、修订、派生关系、候选和历史入口。当前尚未迁入 DSH Template Workshop 的 visual Token/CSS 编辑器。

## 不可破坏的约束

1. 微调先只作用于当前页面的 presentation draft；“应用到当前草稿”才写入当前 resume 的 presentation override。两者都不能改正文、模板 CSS 或模板 revision。
2. 模板候选在明确保存前不得写盘；保存、恢复不会静默选择模板。
3. 内容、模板或 presentation 改动会使旧 renderId/metrics 失效；只有当前 A4 iframe 的浏览器回传可以重新解锁 finalize。
4. 恢复历史模板必须形成新 revision；内置模板永远不可写。

## 当前实施顺序

1. 补一页/两页样本的完整验收矩阵（含 template copy/save/restore 的可写闭环）；
2. 只有用户确认要迁入时，再实现 Template Workshop 的 visual Token、候选 A4 对比与受控 CSS 草稿；它不是手动调整的扩展。

## 排查入口

- 微调草稿：`frontend/react/src/features/preview/A4Pane.tsx` → `frontend/app.js:stagePresentationDraft`；提交/重新测量：`frontend/app.js:applyPresentationTuning` → `/api/agent/presentation`。
- 模板库：`frontend/app.js:templateCard/renderTemplates/applyTemplate`。
- 模板 API：`backend/src/server.js:handleTemplates/handleTemplateMutation`。
- 领域工具：`backend/src/agent/resume-tools.js`。
- 数据位置：会话内当前简历的 presentation override，以及 `<workspace>/.cvagent/templates/<id>/revisions/`。
