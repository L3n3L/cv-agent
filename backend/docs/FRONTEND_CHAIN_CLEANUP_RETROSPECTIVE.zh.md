# 前端链路冗余与阻塞清理复盘

更新时间：2026-09-17

## 1. 本轮目标

当前项目以 `frontend/` 的 demo v2 作为唯一用户界面、以 `backend/` 的 CVAgent 能力作为唯一业务服务。本轮先清除会让链路失真、难以维护或无法定位问题的旧路径，不继续堆叠 UI 功能。

验收标准：

1. 前端不再依赖插件目录或本地插件预览路由。
2. 预览来源只有后端 session；未建立 session 时给出明确空态。
3. 前端、代理、后端的边界和失败行为可观察，不能用假 iframe 掩盖未接通。
4. 不在真实前端链路验证前删除后端旧静态入口，保留可回退性。

## 2. 已确认的问题

### P0：预览依赖已移除的插件路由

demo v2 原先在多个页面硬编码 `./real-template?...`。新仓库不包含插件，因此该路径会产生空白预览，既不能代表真实模板，也不能帮助定位后端是否工作。

处理方式：增加统一的预览同步边界。只有拿到 `sessionId` 后，预览才指向 `/api/agent/preview?sessionId=...`；没有 session 时渲染明确空态。

### P1：前端仍有静态业务夹具

会话、模板、检查项和版本列表仍有 demo 数据。它们暂时保留用于 UI 验收，但不得继续扩展为业务逻辑。下一步应由 `/api/workspaces`、`/api/sessions`、`/api/templates`、`/api/versions` 提供数据。

### P1：后端保留重复静态前端

`backend/public/` 是历史静态副本。它不能在真实前端 API 链路跑通前直接删除；完成前端切换后，应删除该副本和后端静态托管分支，避免双前端漂移。

### P2：Agent 交互仍是本地假响应

当前聊天发送和“应用并重新渲染”仍主要是 demo 行为。下一阶段接入 `/api/agent/run`、`/api/agent/save`、`/api/agent/render`，并把请求状态、失败状态和 requestId 贯穿到 UI。

## 3. 执行顺序

1. 预览边界收敛：本轮执行。
2. 建立前端 API client 和 session bootstrap。
3. 将工作区导入、简历源文件、模板、版本、检查项逐步替换为后端数据。
4. 接通 Agent 执行与保存/渲染链路。
5. 真实链路通过浏览器验收后，删除 `backend/public/` 和旧静态托管代码。
6. 增加前端 lint/unit/e2e，以及后端 API contract smoke test。

## 4. 日志与维护要求

- 前端代理输出 NDJSON，必须带 `requestId`、route、status、durationMs。
- 后端请求日志使用同一个 requestId；业务事件记录 sessionId、workspaceId 和动作名，不记录简历正文、token 或本地绝对路径。
- 客户端错误只走 `/api/client-events`，字段严格白名单并脱敏；上线前补充鉴权、限流和采样策略。
- 前端每次 API 调用应保留可关联的 requestId/错误码，用户提示和日志内容分离。

## 5. 本轮结果与未完成项

本轮消除插件预览路由造成的空白假象，并保留旧后端静态入口作为临时回退。当前尚未宣称“前后端已完全打通”；完成该结论必须满足真实 workspace 导入、session bootstrap、source 加载、agent 修改、save/render 和 preview 的端到端验收。

## 6. 对接执行记录（2026-09-17）

已完成：

- 前端统一 API client，错误中保留后端 errorCode 和 requestId。
- 目录文件导入到 `/api/workspaces/import`，前端只使用返回的 workspaceId。
- workspace bootstrap、源简历加载和真实 session 预览。
- 编辑器内容写入隔离 draft，并调用真实 render。
- Agent 对话调用 `/api/agent/run`，请求失败时展示失败状态，不保留假成功响应。
- iframe 加载后读取真实 A4 页面并调用 `/api/agent/measure`。

浏览器冒烟已经验证导入、bootstrap、源文件显示、真实 A4、draft/render、Agent 失败态与成功态。开发机通过 `backend/.env` 配置 `DEEPSEEK_API_KEY` 后，最小真实请求已成功返回；该文件已被 Git 忽略，不进入提交。
