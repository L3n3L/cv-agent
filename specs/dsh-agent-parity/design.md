# DSH 简历 Agent 能力对齐：设计

## 架构决定

不直接 import DSH 插件代码。CVAgent 在 `backend/src/agent/` 维护自己的 `RESUME_PRODUCTION_CONTRACT`，以 DSH `RESUME_AGENT_CONTRACT` 为业务基准、以 CVAgent 工具和隔离草稿为执行边界。

```text
用户材料 / JD
  → CVAgent 内容生产契约
  → resume_prepare/read/check
  → 内容、模板或 presentation 变更
  → renderId
  → 浏览器唯一 A4 iframe 回传 metrics
  → resume_finalize
  → 用户确认 + 保存岗位化版本元数据
```

## 工具映射

| DSH MCP 语义 | CVAgent 对齐工具 | 说明 |
| --- | --- | --- |
| `resume_guide` / Agent contract | `RESUME_PRODUCTION_CONTRACT` | 本地静态业务契约，不传输 DSH 实现 |
| `icon_list` | `icon_list(query, limit)` | 从已迁移 icon registry 查询 |
| `layout_validate` | `layout_validate(layout)` | 复用迁移后的 layout schema |
| `template_autotune` proposal | `presentation_suggest(round)` | 只接受当前真实 metrics，默认不写入 |
| `presentation_save` | `presentation_update` | 现有工具继续作为唯一持久化入口 |
| `resume_save_version` | `/api/agent/save` | 扩展版本元数据，不改变验收门 |

## 受限调优

`presentation_suggest` 只在任务为 `measured`、`needs_revision` 或 `accepted` 且 metrics 与当前 renderId 一致时可用。它不看完整 HTML、不写磁盘，只依页数、occupancy、overflow、当前 presentation 和 targetPages 给出一个 bounded patch：字号、行距、页边距、sectionGap。round 限制在 1–3。

用户确认后，Agent 才调用已有 `presentation_update`。因此“自动调优”不能绕过模板修订、浏览器测量、`resume_finalize` 或正式保存确认。

## 版本元数据

正式版本记录新增可选 `targetRole`、`company`、`jobDescriptionPath`。字段只作为投递索引和审计信息；实际 Markdown、模板快照与 presentation snapshot 仍保存在既有 `.cvagent/versions`，不会创建或覆写 DSH 路径。

## 测试策略

- 单元：图标查询限额、布局规范化/拒绝、调优边界与 round 限制；
- 工具集成：新工具注册、真实 metrics 上的建议、无 metrics 时拒绝；
- HTTP：保存版本元数据向下兼容；
- 浏览器：工作台触发测量后，Agent 提出建议但不自动应用；用户确认后才重新渲染验收。
