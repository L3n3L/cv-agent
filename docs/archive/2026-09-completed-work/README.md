# 2026-09 已完成工作归档

这些文件保留设计背景、验证证据和历史决策，但其任务已经完成、被后续实现取代，或包含已废弃的 DSH 运行时/像素对照。后续实现以 [文档入口](../../README.md) 列出的当前契约为准。

| 归档范围 | 原文件前缀 | 当前替代入口 |
| --- | --- | --- |
| 日志升级的需求、设计、任务清单 | `backend__specs__logging-upgrade__*` | `backend/docs/LOGGING_UPGRADE_RETROSPECTIVE.zh.md`、`backend/docs/PROJECT_LOG.md` |
| 工作区选择的需求、设计、任务清单 | `backend__specs__workspace-selection__*` | `backend/docs/WORKSPACE_SELECTION_RETROSPECTIVE.zh.md` |
| 首轮代码优化与质量验收 | `backend__docs__CODE_*` | 当前测试、`backend/docs/PROJECT_LOG.md`、MCP 工序契约 |
| 迁移矩阵、旧最终执行与前端链路清理 | `backend__docs__MIGRATION_MATRIX*`、`CVAGENT_FINAL_EXECUTION*`、`FRONTEND_CHAIN_CLEANUP*`、`DEMO_V2_FRONTEND_*` | `backend/docs/CVAGENT_MCP_ALIGNMENT.zh.md`、`frontend/UI_LAYOUT_REACT_VITE_RECAP.zh.md` |
| 旧 UI 需求、交接、研究与视觉微调 | `backend__docs__UI_*`、`frontend__UI_*`、`frontend__AGENT_CHAT_*`、`docs__AGENT_INTERACTION_*` | `frontend/UI_LAYOUT_REACT_VITE_RECAP.zh.md` |

归档文件名用原仓库相对路径中的 `/` 替换为 `__`，因此可在 Git 历史和此映射表中无歧义定位原始来源。

工作区选择任务清单中曾留下一个 CUA 环境不可用的浏览器验收项。后续已通过真实本地浏览器多次完成工作区、Markdown、A4 与 Agent 面板的截图验收；该旧条目不再代表当前阻断项。
