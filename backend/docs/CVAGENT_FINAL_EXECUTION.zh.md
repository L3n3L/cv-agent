# CVAgent 最终交付执行文档

## 1. 交付目标

CVAgent 是独立运行的简历 Agent 产品。用户从 DSH 切换到 CVAgent 后，除新增一个独立的 Agent 聊天模块外，预览工作台的视觉、布局、控件顺序、交互语义和最终产物都应保持一致，不能让用户重新学习一套工具。

“一致”以同一 Edge、viewport、DPR、字体、工作区、简历内容、模板、排版参数和页面状态下的可见结果为准；不能用“结构类似”代替实际验收。

## 2. 不迁移的内容

- DSH 宿主外壳、模型选择器和宿主级状态不进入 CVAgent；CVAgent 可以拥有自己的本地历史 Session 列表。
- DSH 的工作区和 MCP 服务不作为 CVAgent 的隐式依赖。
- CVAgent 不读取 DSH 的运行时状态，也不向 DSH 的 `/dsh-resume/api/metrics` 回传数据。

## 3. 唯一数据来源

| 对象 | 唯一来源 | 约束 |
| --- | --- | --- |
| 工作区 | 用户明确选择的 `workspaceRoot` + `.cvagent/workspace.json` | 素材路径不能改变工作区；不允许静默切换 |
| 简历源文件 | 当前 `resumePath` | 只读；Agent 不覆盖源文件 |
| 当前草稿 | `.cvagent/drafts/<taskId>/resume.md` | 每个任务独立；内容写入后旧渲染和旧测量失效；草稿存在时 Agent 检查优先读草稿 |
| 模板 | 当前任务 `templateId + templateRevision` | 内置模板只读；模板复制生成独立副本 |
| 呈现参数 | 当前任务 `presentation` | 字号、行距、间距、页边距、颜色和图标一起绑定 |
| 当前渲染 | 当前任务 `renderId` | 只有最新 `sessionId:renderId` 可以进入 iframe 和测量 |
| 验收结果 | 当前任务 measurement | 只接受浏览器对当前 renderId 的回传；没有测量不能保存 |
| 日志 | `logs/*.ndjson` | 只用于回放诊断，不作为业务状态来源 |

## 4. 页面与功能矩阵

| 页面 / 功能 | 用户动作 | 前端入口 | 后端接口或产物 | 必须验收 |
| --- | --- | --- | --- | --- |
| 开始 | 读取当前简历 | 开始页按钮 | 跳转工作区并调用 `/api/source` | 不创建重复任务，不丢已有工作区 |
| 工作区 | 填写或切换工作区、简历路径、目标页数 | 工作区页 | `/api/source`、`/api/agent/bootstrap` | 源文件不被改写；工作区和简历路径始终成对显示 |
| 预览文件 | 选择当前工作区的预览文件 | 顶部预览下拉框 | `GET /api/previews` | 列出所有工作区 `preview.html`；排除 `.cvagent`；快速切换不回跳 |
| 模板快速选择 | 选择已有模板 | 顶部模板弹层 | `GET /api/templates`、`POST /api/agent/template` | 保留用户选定模板；切换后旧 renderId 失效并重新渲染 |
| 模板库 | 浏览、选择模板 | 模板库页 | `/api/templates`、`/api/agent/template` | 选择后回到当前预览；不覆盖源模板 |
| 模板工坊 | 复制、编辑、保存模板 | 模板工坊页 | `/api/templates/copy`、`/api/template`、`/api/templates/save` | CSS 选择器和打印规则同步副本 ID；源模板不变 |
| 手动排版 | 调整字号、行距、模块间距、页边距、图标大小 | 顶部手动调整弹层 | `POST /api/agent/presentation` | 参数实时作用于当前草稿；重新渲染并等待新测量；弹层可滚动 |
| Markdown | 修改内容 | 左侧 textarea | `POST /api/agent/draft` → `POST /api/agent/render` | 650ms 防抖、单写入队列、源文件不变、旧测量失效 |
| A4 预览 | 查看当前结果 | 中间 iframe | `GET /api/agent/preview` | 单 iframe；只显示当前 renderId；页面和指标不反复横跳 |
| 排版检查 | 运行内容预检和视觉验收 | 排版检查页 / iframe 回传 | `/api/agent/quality`、`/api/agent/measure`、`resume_check`、`resume_finalize` | 页数、占用率、溢出、页面平衡全部有当前数据 |
| 保存版本 | 保存当前已验收版本 | 顶部保存版本 | `POST /api/agent/save` | 只有 accepted 可保存；绑定内容、模板修订和呈现参数 |
| 另存为 | 按当前状态创建新投递版 | 顶部另存为 / 版本页 | `/api/agent/save` 或版本接口 | 生成独立版本；原版本不被覆盖 |
| 版本管理 | 打开、改名、归档 | 投递版本页 | `/api/versions`、`/api/version`、`/api/versions/rename`、`/api/versions/archive` | 打开版本采用其绑定参数；归档可恢复查看，不删除文件 |
| Agent | 输入简历任务并查看工具工序 | 独立 Agent 页 | `POST /api/agent/run` + 领域工具 | Agent 必须读取、起草、渲染、等待测量、验收；未通过不能声称完成 |
| 设置 | 查看当前绑定 | 设置页 | 当前任务快照 | 只展示，不生成第二套状态 |

## 5. Agent 执行工序

Agent 的最短完整闭环固定为：

```text
workspace_info
→ workspace_materials_list
→ workspace_material_read（只读相关素材）
→ resume_prepare
→ resume_read
→ resume_check
→ template_select（仅用户要求换模板时）
→ presentation_update（优先解决排版）
→ resume_write
→ resume_check
→ resume_render
→ resume_metrics（浏览器回传当前 renderId 的测量）
→ resume_finalize
→ 用户确认后保存
```

任何内容、模板或排版变化都必须从 `resume_render` 重新开始。Agent 不得伪造页数、占用率、溢出和“验收通过”。

## 6. 像素级验收方法

1. 在 DSH 和 CVAgent 使用同一 Edge viewport、DPR、字体和同一份工作区内容。
2. 固定导航宽度、主内容内边距、顶栏、三栏工作区和 A4 iframe 的 bounding box。
3. 对比顶部操作顺序、按钮高度、下拉框宽度、字体、颜色、边框、滚动条和状态文案。
4. 对比开始、工作区、预览、版本、模板库、模板工坊、排版检查和 Agent 页面。
5. 差异只能是产品名和独立 Agent 模块；抗锯齿差异不能作为功能差异解释。

当前 Edge 1258×622 基线：`.cj-mainBar = 136,16,1106,49`，`.cj-previewWorkspace = 136,75,1106,531`。验收截图保存在 `logs/cvagent-parity-final-race-guard.png`。

## 7. 来源冲突和并发防线

- 页面显示的模板、简历和版本都从当前任务快照刷新，不从旧 DOM 文案推断。
- 工作区预览列表由服务端扫描当前工作区生成，不从历史下拉选项缓存恢复。
- `loadSource` 使用请求代次；旧工作区、旧简历和旧模板请求完成后无权写入界面。
- iframe 消息必须同时匹配来源窗口、sessionId 和 renderId，并使用去重键消费一次。
- 新渲染没有测量时，状态必须回到测量中；旧测量不能让保存按钮重新可用。
- CSS 只允许 `workbench.css` 提供 DSH `cj-*` 视觉基线；旧布局选择器已命名空间隔离。
- 测量协议统一使用 payload 顶层 `renderId`；前端兼容读取历史 payload 的 `metrics.renderId`，并在同源 iframe `load` 时回读 `window.__cvagentMetrics`。服务端仍以当前 `sessionId + renderId` 做最终校验，避免“页面已渲染但状态永远测量中”。

## 8. 交付门槛

- `node --check` 通过。
- `npm.cmd test` 全部通过。
- health、source、previews、bootstrap、render、measure、verify、save 接口至少各有一条验证证据。
- 浏览器从入口进入，能完成读取、切换预览、编辑、排版、渲染、测量和版本查看。
- 控制台不能出现由 CVAgent 新增的 404、重复导航、资源洪泛或未处理异常。
- 任一像素差异、来源冲突、过期响应覆盖新状态或空白页问题未解决时，不得标记最终交付完成。

## 9. 本轮最终回归记录

- 发现并修复测量回传字段错位：渲染器将 `renderId` 放在 payload 顶层，工作台原先只读取 `metrics.renderId`，因此测量事件被静默丢弃。
- 修复后从入口“工作区 → 读取当前文件”实测进入预览，iframe 回传 `pageCount=2`，状态从“测量中 · 排版指标”变为“版式需调整 · 排版指标”；当前内容因两页目标与页面占用规则未达到通过条件而被正确阻塞，不再假装通过。
