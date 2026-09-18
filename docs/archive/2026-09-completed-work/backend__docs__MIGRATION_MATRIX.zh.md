# CVAgent 能力迁移矩阵

CVAgent 不是重新实现一个聊天壳，而是把原插件中与简历业务直接相关的能力迁移到独立产品目录。迁移后的代码由 CVAgent 自己维护；DSH、Cordis 和 MCP 只作为原始来源，不进入运行时依赖。

| 能力 | 原插件来源 | CVAgent 落点 | 状态 |
| --- | --- | --- | --- |
| Markdown 安全渲染、语义模块、图标 token | `lib/renderer.js`、`lib/icons/*` | `src/migrated/resume-engine/` | 已迁移 |
| A4 composition 布局与模块排序 | `lib/renderers/registry.js`、`lib/layout-schema.js` | `src/migrated/resume-engine/` | 已迁移 |
| 模板规范、校验、内置模板描述 | `lib/template-schema.js`、`lib/template-presets.js` | `src/migrated/resume-engine/` | 已迁移 |
| 模板 CSS 主题 | `lib/templates/*.css` | `src/migrated/resume-engine/templates/` | 已迁移 |
| 内容预检、占位符和图标 token 检查 | `lib/quality.js`、`lib/icons/registry.js` | `src/migrated/resume-engine/quality.js` + canonical `resume_check` | 已迁移 |
| 展示参数、模板副本/修订基础能力 | `lib/presentation.js`、`lib/resume-versions.js` | `src/migrated/resume-engine/presentation.js`、`template-presets.js` | 已接入 CVAgent 服务；正式简历版本由 `src/core/workspace.js` 管理 |
| 自动排版调优基础能力 | `lib/autotune.js` | — | 未进入当前运行时，避免保留未接入的重复实现 |
| 工作区写入与会话串行化 | `lib/workspace-lock.js` | `src/core/workspace.js`、`src/core/session.js` | CVAgent 原生；旧锁模块已删除 |
| 简历任务状态、草稿隔离、测量验收 | 无对应单一旧模块，CVAgent 新增 | `src/core/*` | CVAgent 原生 |
| 独立 Agent 与会话 | DSH/MCP 不迁移 | `src/agent/*`、`src/server.js`、`src/core/session-store.js` | CVAgent 原生；单用户本地 Session 已持久化 |

## 来源唯一性约束

- 内容来源：用户授权工作区中的源 Markdown；Agent 只写 `.cvagent/drafts/<taskId>/`，正式保存才写 `.cvagent/versions/`。
- 模板来源：内置模板从 `src/migrated/resume-engine/templates/` 加载；用户模板进入工作区模板目录并以模板 ID + 修订号识别。
- 任务呈现：预览只接受当前 `contentVersion + templateRevision + renderId`，旧渲染不能回写当前任务。
- 旧插件元数据：仅允许通过兼容适配器进入 `.cvagent/legacy`，不参与 CVAgent 的工作区、任务或预览选择。
