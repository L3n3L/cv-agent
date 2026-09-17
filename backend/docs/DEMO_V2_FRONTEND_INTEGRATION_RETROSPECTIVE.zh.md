# demo v2 → CVAgent 前后端分离与冗余清理复盘

## 1. 目标与验收口径

本次对接的目标不是“做一个类似 demo 的页面”，而是让用户打开 CVAgent 后感觉 demo 已经接入真实后端：页面结构、信息密度、颜色、字体、分栏、侧栏收缩、Agent 抽屉和聊天体验保持同一套产品语言；工作区、会话、简历内容、模板、A4 预览、排版测量和正式版本则全部来自 CVAgent 的真实业务。

允许存在的差异只有真实数据带来的差异，例如当前工作区名称、会话数量、模板数量、排版状态和版本记录。不得保留 demo 的固定会话、假状态或假预览结果。

## 2. 现状判断（2026-09-17 复核）

### CVAgent

CVAgent 已经具备可直接承载 demo UI 的后端边界：

- `src/server.js` 提供工作区、会话、模板、源文件、预览、Agent 执行、测量、保存和领域操作接口；
- `src/core/session.js`、`src/core/session-store.js` 负责会话范围、恢复和并发锁；
- `src/agent/resume-tools.js` 负责简历制作工具和工作流约束；
- `src/migrated/resume-engine/` 负责真实模板与 A4 渲染；
- `src/agent/deep-agent.js` 已接入 `deepagents` Harness，真实模型调用和工具循环可运行；
- 当前真实前端在同仓库 `frontend/`，已经连接工作区导入、bootstrap、源文件、Agent、draft/render 和 A4 iframe 测量；
- 当前主要问题不再是“前端完全没有接线”，而是正式保存、测量后的 Agent 续跑、模板/检查/版本页面仍未完全接入。

### demo v2

demo v2 是视觉与交互样本，不是生产后端：

- `app.js` 中的会话、标题、状态和聊天初始内容是静态 fixture；
- `server.mjs` 只提供静态资源和演示模板渲染；
- 没有真实 Agent 调用、会话持久化、工作区导入、测量回传和正式版本保存。

因此不能把 demo 的 `app.js` 直接覆盖到 CVAgent，也不能把 demo 的 `server.mjs` 当作业务后端。当前正确关系是：`frontend/` 负责视觉和交互编排，CVAgent backend 负责业务真相；此前“前端仍是纯静态 demo”的审计结论已经过时。

## 3. 对接原则

1. demo v2 作为唯一正式前端，CVAgent 作为业务后端，逻辑上前后端分离。
2. 不迁移或重写 Agent、模板、渲染和工作区核心，只整理后端分层与稳定 API DTO。
3. 所有 demo fixture 都替换为真实 API 数据，前端只负责状态展示和交互编排。
4. A4 iframe 必须使用 `/api/agent/preview?sessionId=...`，不能使用 demo 的 `real-template` 路由。
5. 聊天输入调用 `/api/agent/run`；Markdown 修改调用草稿接口；模板、排版、测量和保存继续走现有 domain API。
6. 侧栏、编辑区、预览区和 Agent 抽屉的状态必须互相独立，收起 Agent 不得销毁当前会话或预览。
7. 清理旧前端壳、demo 假状态、重复状态表达和不可执行动作；可能被外部调用的后端接口先标记弃用，不直接删除。
8. 不用大色块、头像、冗余状态卡或“采纳建议/打开预览”类伪动作占据聊天空间；真实动作只在确实可执行时出现。

## 4. 页面与 API 映射

| demo v2 区域 | CVAgent 真实来源 |
| --- | --- |
| 工作区切换 | `GET /api/workspaces`、`POST /api/workspaces/import` |
| 会话列表 | `GET /api/sessions`、`GET /api/session` |
| Markdown 编辑 | `GET /api/source`、`POST /api/agent/draft` |
| A4 预览 | `POST /api/agent/bootstrap`、`POST /api/agent/render`、`GET /api/agent/preview` |
| Agent 对话 | `POST /api/agent/run` |
| 模板库 | `GET /api/templates`、`GET /api/template`、模板复制/保存接口；当前页面仍有硬编码卡片 |
| 排版检查 | `POST /api/agent/quality`、`POST /api/agent/measure` |
| 投递版本 | `GET /api/versions`、`GET /api/version`、版本改名/归档/保存接口；当前页面仍有静态版本行 |

当前第一阶段采用请求完成后更新 UI 的方式。工作区、bootstrap、源文件、Agent、draft/render 和预览测量已进入真实请求链；测量回传目前仍需要修正状态一致性，并在测量完成后触发 Agent 续跑。若需要像 Codex 一样在 Agent 执行过程中实时显示工具步骤，再新增按 `sessionId` 订阅的事件流；这属于 CVAgent 后端的增量能力，不需要迁移后端。

## 5. Git 仓库决策

当前保留两个 Git 仓库：

- `cvagent-ui-demo-v2`：唯一前端，维护页面、交互、API Client 和浏览器测试；
- `CVAgent`：业务后端，维护 API、Agent、工作区、模板和渲染。

不把两个已有仓库强行合并。现在合并会带来历史迁移、路径变化和提交边界噪音，不能解决真正的维护问题。两个仓库用版本化 API 契约协同，开发期由 demo server 通过 `CVAGENT_API_ORIGIN` 代理 `/api/*`；生产期再由反向代理统一为同源地址。

如果未来需要原子发布，在父目录增加启动脚本或 CI 编排即可，不需要合并 Git 历史。

## 6. 冗余清理清单

### 立即清理

- CVAgent 旧前端页面壳和与 demo v2 重复的导航、聊天布局；
- demo 中固定 sessions、假排版状态、假页数和假模板选择结果；
- 没有真实处理逻辑的“采纳建议”“打开预览”等按钮；
- 同一状态在标题、卡片、消息和侧栏中的重复表达；
- 只为演示服务、不会进入真实业务链路的 `real-template` 数据依赖。

### 延后清理

- 可能被 dsh 插件或脚本调用的后端旧接口；
- 真实模板、手动排版微调、版本保存和会话恢复能力；
- 尚未完成替代验证的 MCP 工具入口。

清理规则是“先确认无调用，再删除；无法确认时先标记 deprecated 并记录日志”，不通过大范围删除制造隐性回归。

## 7. 本次 UI 设计规格

- 方向：`Luxury / refined`，白底、低对比边界、深色正文、单一蓝色操作色；
- 字体：正文 `IBM Plex Sans` / `Microsoft YaHei`，文件名和工具状态 `IBM Plex Mono`；
- 布局：左侧会话导航，中部 Markdown/A4 非对称分栏，右侧 Agent 可收纳抽屉；
- 侧栏：拖拽到阈值后收起为单按钮，不能保留浪费空间的窄栏；
- 编辑/预览：边界可拖拽，预览宽度变化不能破坏编辑区最小可用宽度；
- 聊天：消息流滚动，输入区固定底部；用户消息仅保留轻量灰色气泡，Agent 和工具过程回到连续正文；
- 滚动条：低对比、仅在交互时提供可感知反馈；
- 动效：只用于 Agent 工具执行中的轻量状态变化，不使用装饰性渐变和大面积动画。

## 8. 实施顺序

### 第一阶段：前后端边界与真实 API 接通（已完成最小闭环）

- 保持 demo v2 的 HTML/CSS/交互作为视觉基线，不再继续扩展 CVAgent 旧前端；
- demo server 已增加 `/api/*` 到 CVAgent 的开发期代理；
- 增加统一 API Client，集中处理工作区、会话、源文件、模板、预览、Agent、检查和版本接口；
- 清理前端核心工作台的假响应，接入真实 API；
- 已完成工作区导入、session bootstrap、源文件加载、真实 Agent 对话、draft/render 和真实 A4 iframe；
- 模板库、排版检查、投递版本和正式保存仍需逐项接通，不能以静态卡片代替真实业务。

### 第二阶段：交付闭环补齐（当前执行）

- 修复 iframe 测量回传的 `sessionId/renderId/contentVersion/templateRevision` 一致性；
- 增加测量完成后的 Agent 续跑或可恢复 continuation，完成 `render → measure → finalize`；
- 正式版本保存必须绑定 `accepted` 状态和用户确认，并在前端提供真实入口；
- 当前会话标题、工作区、模板和状态继续以 session/context 为唯一来源。

### 第三阶段：真实资源页

- 模板库改为读取 `/api/templates`，选择模板后调用真实 template API 并重新渲染；
- 排版检查页读取当前 session 的 quality/measurement/verification，不再展示固定阻断项；
- 投递版本页读取 `/api/versions`，接通打开、改名、归档和创建正式版本；
- 清理仅为演示保留的静态会话、模板、检查和版本数据。

### 第四阶段：实时工具过程

- 从现有 workflow event catalog 提供轻量事件订阅；
- 前端按 started/completed/failed 更新工具行；
- 保留断线恢复和最终状态重新读取。

## 9. 生产级日志要求

调试期即按生产口径记录：

- 使用 NDJSON/JSON，包含 `timestamp`、`level`、`event`、`component`、`requestId`、`sessionId`、`workspaceId`、`durationMs`；
- 记录请求方法、路由、状态码、耗时和错误码，不记录简历正文、提示词、完整消息和密钥；
- Agent 记录 run、工具名、工具状态、耗时和失败原因；渲染记录模板 ID、内容 hash、页数和测量摘要；
- 错误日志保留服务端堆栈，前端只显示可理解的失败提示和 requestId；
- 日志按天滚动、大小切分、保留期可配置，日志写入失败不能拖垮业务请求；
- demo 代理和 CVAgent 后端使用同一个 requestId 串起一次调用。

前端 `client-events.js` 自动捕获 JS 异常、未处理 Promise 异常和资源加载失败，通过 `POST /api/client-events` 上报；后端只接受白名单字段，使用 `client_event_received` 写入现有 logger。日志上报失败不能反向影响页面和业务请求。

CVAgent 现有日志模块已经具备脱敏、滚动和保留能力，前端代理也已加入结构化请求日志；后续新增接口沿用同一事件命名。

## 10. 当前验收清单

- [x] CVAgent 首页视觉上与 demo v2 同一套壳层；
- [x] 选择工作区后真实读取 `resume.md` 并生成 A4 预览；
- [x] Agent 输入真实调用 CVAgent，并在同一会话中返回结果；
- [x] Markdown 草稿修改会重新渲染真实预览；
- [ ] iframe 测量结果稳定写入当前 session，并能驱动 Agent 继续 finalize；
- [ ] 用户确认后可以从当前 accepted session 保存正式版本；
- [ ] 模板库显示真实模板并可应用；
- [ ] 预览、编辑区、侧栏和 Agent 抽屉可收放/拖拽；
- [x] 会话刷新后可以恢复；
- [ ] 验收通过后才能保存正式版本；
- [ ] 旧的手动排版微调能力没有被视觉重构隐藏或删除；
- [ ] 浏览器控制台没有新增错误，现有单元测试通过。

## 11. 不在本次范围内

- 不迁移 CVAgent Agent、渲染引擎或工作区存储；
- 不让浏览器直接调用 MCP；
- 不把 dsh-resume 的 MCP Server 当作 CVAgent 的 UI 后端；
- 不在 UI 重构阶段引入 React/Vite 或重新搭建工程；
- 不为了视觉相似而伪造页数、测量结果、会话状态或版本状态。

## 12. 本轮结论

此前“后端基本都有、前端只接了空态和错误上报”的判断只适用于接线前快照，当前已被 `8e7d772` 的真实前端接线提交修正。现在的准确定位是：CVAgent 已具备可用的工作台最小链路，剩余工作集中在交付闭环、真实资源页和 Agent 续跑，而不是重新迁移后端。

本轮开发原则：`deepagents` 负责规划和工具循环，Skill 负责可变的简历业务判断，工具和后端状态机负责不可绕过的事实与完成门。不要把 DSH 的全部 MCP 指南机械复制进每轮 Prompt，也不能因为使用成熟 Harness 就省略 `resume_metrics`、用户确认和正式保存等真实业务节点。
