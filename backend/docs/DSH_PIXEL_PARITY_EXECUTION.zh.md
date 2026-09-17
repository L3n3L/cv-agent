# CVAgent × DSH 像素级体验复刻执行文档

## 最终标准

CVAgent 不是重新设计一个“像 DSH 的页面”，而是把 DSH 求职简历工作台迁移成独立产品。相同 Edge、viewport、缩放、字体加载、工作区、简历内容、模板、排版参数和页面状态下，工作台的可见结果必须与 DSH 一致。唯一允许的产品差异是：CVAgent 增加独立 Agent 模块；DSH 宿主的会话列表、模型选择器和宿主外壳不迁移。

## 执行工序

### 1. 先固定基准

用实际运行中的 DSH 插件页采集基准，不使用口头描述或手工重画。记录 DOM 层级、关键 class、元素 bounding box、computed style、字体、颜色、viewport、DPR、滚动位置和数据状态。

### 2. 迁移可见结构

优先复用 DSH 的 `cj-workbench`、`cj-workbenchBody`、`cj-nav`、`cj-main`、`cj-mainBar`、`cj-previewWorkspace`、`cj-editorPane`、`cj-editorPaneHead`、`cj-editorText`、`cj-editorStatus` 和 `cj-editorPreviewFrame`。工作区路径输入只在工作区页面出现，不能污染预览页。

### 3. 收敛样式来源

`workbench.css` 是 DSH 工作台视觉基线；`styles.css` 只负责独立产品外壳和 Agent 模块。所有同名选择器都要消除或明确优先级，禁止再出现“旧 CSS 覆盖新结构”的隐式来源。每次视图切换都必须有统一的 `[hidden]` 规则。

### 4. 连接真实后端

每个按钮都要有明确动作：读取源文件、选模板、应用模板、修改排版、渲染、读取预览、运行检查、保存草稿、保存版本、另存为、改名、归档和模板修订。响应必须包含实际状态或实体版本；前端不根据点击本身宣布成功。

### 5. 统一数据流

工作区、当前简历、当前模板、当前版本、排版参数和当前渲染产物只能各有一个来源。导航切换只切视图，不生成新任务；模板/版本加载后更新统一任务快照；渲染只保留一个有效 iframe；旧响应不能覆盖新响应。读取成功后必须自动进入预览工作台，不能出现“后端已建立会话、界面仍停在工作区”的假失败。

### 6. 加入 Agent

Agent 通过现有领域工具推动同一任务状态，不复制一套简历逻辑。它必须能读取用户指定的工作区、生成隔离草稿、渲染、等待测量、执行验收，并在通过后保存；失败时展示阻塞原因和下一步，不能只输出“已完成”。

### 7. 浏览器验收

至少验收以下状态：空预览、读取简历、切模板、打开手动调整、修改字号/行距/页边距/图标、保存草稿、渲染、测量、验收通过、保存版本、另存为、版本打开/改名/归档、模板复制/修订、Agent 打开和错误恢复。每项同时检查截图、AX 树、网络请求、控制台和后端日志。

## 交付门槛

- 自动测试、语法检查和接口检查全部通过。
- DSH/CVAgent 核心状态截图差异只剩抗锯齿或允许的产品名称差异。
- 不出现视图叠加、导航抖动、重复 iframe、页数递增、模板回退、旧版本覆盖新版本或按钮假成功。
- 未达到像素标准时，不得以“结构接近”交付，必须列明剩余差异和阻塞原因。

## 当前实现映射（2026-09-11）

| 用户动作 | CVAgent 入口 | 后端/产物 | 防回退措施 |
| --- | --- | --- | --- |
| 读取简历 | 工作区页“读取” | `/api/source` | 工作区与 `resumePath` 绑定，源文件只读 |
| 选择模板 | 顶部模板弹层、模板库 | `/api/agent/template` | 写入当前任务快照，旧 `renderId` 失效 |
| 调整排版 | 顶部“手动调整”弹层 | `/api/agent/presentation` | 字号、行距、模块间距、页边距、图标缩放持久化到任务 |
| 编辑 Markdown | 左侧编辑器 | `/api/agent/draft` → `/api/agent/render` | 650ms 防抖、单写入队列、隔离草稿、不覆盖源文件 |
| 查看 A4 | 中间预览 | `/api/agent/preview` | 以 `sessionId:renderId` 去重，旧测量丢弃 |
| 排版验收 | 排版检查/测量回传 | `/api/agent/measure` → `resume_verify` | 没有当前测量或指标不合格时阻塞保存 |
| 保存/另存为 | 顶部保存按钮、版本页 | `/api/agent/save` | 只允许 `accepted`，固化内容、模板修订和呈现参数 |
| 模板复制与修订 | 模板工坊 | `/api/templates/copy`、`/api/templates/save` | 内置模板只读，副本独立，CSS 选择器按副本 ID 校验 |
| Agent | 独立 Agent 模块 | `/api/agent/run` + 同一领域工具 | 与预览任务共享同一 `taskRef`，不维护第二套简历逻辑 |

## 已完成的来源冲突修复

- 可见 DSH 工作台只由 `public/workbench.css` 提供 `cj-*` 布局；旧版 `.workbench-grid`、`#markdownContent`、`.preview-stage` 和 `#previewFrame` 已命名空间隔离。
- 页面隐藏统一由 `:where(.cj-workbench) [hidden] { display: none !important; }` 控制，视图切换不会叠加旧视图。
- 预览 iframe、模板选择、当前状态和测量回传均有唯一键；重复事件只消费一次。
- 渲染产物标记 `data-product="CVAgent"` 后，不再错误 POST 到 DSH 的 `/dsh-resume/api/metrics`，避免独立产品控制台持续刷错。
- 已移除外部 Google Fonts 依赖，使用稳定系统字体栈，避免字体异步加载造成换行和页数变化。
- `.cj-workbench` 已固定为 DSH 实际使用的字体栈与 14px 基准字号；模板按钮、预览下拉框、刷新按钮等控件的宽度由当前任务统一同步，模板快速切换不会留下旧标签。

## 自动验收证据

执行 `npm.cmd test`：15 项通过，包含任务状态机、模板/版本持久化、测量闭环、Agent 注入、预览文件列表隔离、唯一 DOM ID 和旧 CSS 选择器隔离检查；`node --check public/app.js`、`node --check src/server.js`、`node --check src/core/workspace.js`、`node --check src/migrated/resume-engine/renderer.js` 通过；`GET http://127.0.0.1:3180/health` 返回 `{"ok":true,"product":"CVAgent"}`。

浏览器验收（Edge，1258×622）：CVAgent 的 `.cj-mainBar` 为 `x=136,y=16,w=1106,h=49`，`.cj-previewWorkspace` 为 `x=136,y=75,w=1106,h=531`，与 DSH 实测基线一致；预览下拉框能列出当前工作区的 6 份 `preview.html`，快速连续切换后最终路径、Markdown 路径和当前渲染会话保持一致。对应截图：`logs/cvagent-parity-final-race-guard.png`。

读取链路补丁验收：从入口进入“工作区 → 读取当前文件”后自动进入预览，当前 iframe 与状态可见；后端 bootstrap 预览返回 200，过期 renderId 的测量返回 400，源 `resume.md` SHA-256 前后一致。仍需保留的事实边界：控件文字长度不同会改变 DSH 的弹性布局分配；在选择相同模板、相同预览文件和相同内容后再做最终截图差异判定，不能用不同模板名称的截图宣称像素差异为零。
