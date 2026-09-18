# Agent 聊天链路与功能联调测试设计

## 分层

```text
脚本化 Agent 回放
  → API / Session / SSE 断言
  → 浏览器工作台交互
  → A4 iframe 真实测量
  → 截图、控制台、日志证据包
```

### 1. 确定性 Agent

测试在进程内向 `createServer({ agentFactory })` 注入脚本化 Agent。该 Agent 只调用现有 canonical tools，不新增生产工具、不访问模型网络。这样能稳定构造成功、阻塞与过期 render 三种状态。

### 2. API 与事件断言

Node `--test` 负责断言 HTTP 状态、session task、SSE 事件顺序、版本保存门与日志关联字段。它是最快定位业务工序错误的层。

### 3. 浏览器验收

浏览器使用独立的临时 backend registry 和新 profile，从 `/` 进入无历史状态。先创建一个空工作区并确认进入前没有 `resume.md` 或会话；用户选择该工作区时，系统自动建立第一份隔离草稿和 A4，随后才操作 Agent 面板与工具组。每一步先等待可操作状态，避免固定 sleep；这符合 Playwright 的自动等待和可操作性检查原则。[官方文档](https://playwright.dev/docs/actionability)

首次先使用现有浏览器自动化完成真实截图验收；若项目加入 Playwright，则将高价值场景固化为其 trace、控制台和截图产物。视觉基线固定浏览器、字体、DPR 与视口，以避免跨环境像素噪音。[官方视觉比较文档](https://playwright.dev/docs/next/test-snapshots)

需要手动重放浏览器链路时，使用 `backend/scripts/agent-chat-browser-server.mjs` 启动独立的、脚本化 Agent 后端，并让前端代理指向该端口。该脚本只服务本地测试，不属于生产 API，也不调用模型服务。

### 4. 证据包

临时测试产物写入系统临时目录或被忽略的 `test-artifacts/`；不提交简历正文、模型提示词或日志原文。失败报告只保留脱敏摘要与关联 ID。

## 首批场景

| 场景 | 主要风险 | 必须观察 |
| --- | --- | --- |
| 新用户入门 | 历史 Session 或预置文件掩盖首次初始化错误 | 空状态、空工作区、进入前无 `resume.md` / 无会话、自动初始化、隔离草稿、A4 初始预览 |
| 成功闭环 | 工具顺序、测量和 finalize 脱节 | 时间线顺序、当前 renderId、保存启用前用户确认 |
| 测量阻塞 | A4 溢出后状态假通过 | blocker、继续处理、旧保存禁用 |
| 过期测量 | iframe/事件竞态覆盖新 render | `MEASUREMENT_STALE`、状态不倒退 |
| 刷新恢复 | 工具过程在会话结束后丢失 | 事件仍可展开、排序不变 |
| 三栏压力 | Agent 与 A4 重叠或裁切 | 两种宽屏截图、无重叠的 bounding box |

## 调试顺序

先比 `sessionId + runId + renderId`，再读 SSE 和服务端日志，最后看聊天 DOM 与截图。不要先改 CSS 或吞掉异常；例如“页面已有 A4 但测量提示没有当前 render”必须先复现并定位渲染/测量身份是否错位。

## 本轮联调复盘（2026-09-18）

- 空文件夹现在是合法工作区；用户进入工作区时，系统才创建初始 `resume.md`、隔离草稿和 A4 render。
- 首次空白草稿被标记为“尚未完成首次信息收集”。即使浏览器已测得一页，也只能进入 `needs_revision`，不能保存，也不能自动调用 Agent 续跑。
- React A4 pane 在异步挂载完成后会通知旧业务桥接绑定 iframe，避免出现编辑区已加载、A4 iframe 仍是 `about:blank` 的竞态。
- `measurement_received`、`verification_passed`、`verification_blocked` 等业务事件已和工具事件一样进入 SSE 与持久化会话记录；刷新后工具组仍可展开。
- 浏览器验收使用脚本化 Agent 与匿名初始化内容：不调用模型，不发送用户简历。已验证 1280×800 和 1440×900 的三栏边界无重叠，浏览器控制台无 warning/error。
