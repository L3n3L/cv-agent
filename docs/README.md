# CVAgent 文档入口

这里只保留会影响当前实现与后续改动的文档。开始开发前按下面顺序阅读；不要把归档中的阶段性结论当作现行契约。

## 当前契约

- [MCP 简历工序对接](../backend/docs/CVAGENT_MCP_ALIGNMENT.zh.md)：Agent 必须遵守的 `prepare → read → check → mutate → render → measure → finalize → confirm → save` 工序、状态与完成门。
- [生产日志升级复盘](../backend/docs/LOGGING_UPGRADE_RETROSPECTIVE.zh.md)：结构化日志、关联字段、脱敏和检查方法。
- [运行项目日志](../backend/docs/PROJECT_LOG.md)：已落地变更与回归记录。
- [工作区选择复盘](../backend/docs/WORKSPACE_SELECTION_RETROSPECTIVE.zh.md)：用户选择目录、受管工作区与 `workspaceId` 边界。
- [Agent 产品复盘](../backend/docs/agent-product-retrospective.zh.md)：Deep Agents Harness 与简历领域内核的职责边界。
- [React/Vite 布局复盘](../frontend/UI_LAYOUT_REACT_VITE_RECAP.zh.md)：当前工作台的组件、布局、视觉 token 与截图验收要求。

## 当前执行中的测试规格

- [Agent 聊天链路与功能联调](../specs/agent-chat-integration-testing/requirements.md)：从需求、设计到任务清单的可重复 Agent 回放、浏览器与截图验收计划。

## 归档规则

- 已完成的实施规格、旧 UI 研究、阶段验收和已废弃的 DSH 像素对照统一放在 [archive/2026-09-completed-work](archive/2026-09-completed-work/README.md)。
- 归档是可追溯记录，不删除；它不再是 README 或后续实施的默认入口。
- 新任务先新建独立的 `requirements`、`design`、`tasks`，完成并被当前契约吸收后再移入归档，并更新归档映射表。
