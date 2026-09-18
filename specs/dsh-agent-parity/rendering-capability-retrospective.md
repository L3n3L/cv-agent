# CVAgent ↔ DSH 简历模板渲染能力对接复盘

更新：2026-09-18  
状态：渲染内核、主题生态、layoutSpec 和受限自动调参已接入；完整视觉平替仍以浏览器矩阵为准
基线提交：`59a197a feat: align presentation tuning with DSH workflow`

## 1. 复盘结论

本次审计不能把 CVAgent 描述为“已经完成像素级复刻 DSH 插件”。准确结论是：

> CVAgent 已迁移 DSH 的简历渲染内核、A4 验收、17 个主题家族、结构化 layoutSpec 和受限自动调参；模板逐项视觉结果仍必须通过真实浏览器矩阵验收，不能只凭后端测试宣称像素级平替。

CVAgent 的独立 HTTP、Session、工作区和 Agent 边界继续保留，不直接复制 DSH 的 `ctx.tools`、宿主工作区、MCP Server 或插件 UI。对齐的是简历领域能力和结果契约。

## 2. 本次审计范围

对照对象：

- DSH：`1-插件源码/dsh-campus-job/lib/`
- CVAgent：`backend/src/migrated/resume-engine/`、`backend/src/core/render.js`、`backend/src/agent/resume-tools.js`

重点检查：

1. Markdown 到简历 HTML 的渲染链路；
2. 模块语义、布局 IR、页面规格和模板 CSS；
3. A4 分页、溢出、留白、密度和逐页 metrics；
4. 字体、间距、边距、颜色、分隔线和图标微调；
5. 模板生成、主题家族、模板保存/版本和自动调参；
6. Agent 是否能够通过工具实际触发上述能力。

## 3. 已经达到基本平替的能力

### 3.1 渲染内核

`backend/src/migrated/resume-engine/renderer.js` 已覆盖 DSH 核心渲染路径：

- Markdown 转 HTML，并将链接转换为新窗口安全链接；
- 图片资源重写、照片模块和安全资源路径；
- `[icon:token]` 图标 token 解析，未知 token 不泄露为正文；
- profile、summary、contact、experience、projects、education、skills、awards、links、photo 等模块；
- skill tags、skill groups、timeline、metric row、portfolio card、project list、QR code 等语义包装；
- 入口标题、联系方式、经历条目、项目结果等结构化装饰；
- 模板 CSS、用户自定义 CSS 和页面级 token 的组合。

### 3.2 布局和页面规格

`renderers/registry.js` 的 `composition` renderer 与 DSH 对应实现的结构一致，当前支持：

- stack 单栏；
- split 双栏；
- grid 作品集网格；
- pageSpec 的模块顺序、模块变体和页面属性；
- timeline、role-stack、feature-first、cards、compact、grouped-chips、rows 等变体；
- `balanced-footer` 流布局、模块不拆分和孤立模块警告。

### 3.3 A4 分页和真实测量

当前 renderer 在浏览器 iframe 内生成固定 A4 页面，并回传当前 `renderId` 的真实测量：

- page count；
- page width / height；
- overflow；
- top / bottom whitespace；
- occupancy ratio / blank ratio；
- module details；
- visual audit；
- sparse、balanced、needs-review、multi-page、overflow 状态。

这部分比“只看页数”更严格。页数正确但页面过空、顶部留白过大、模块孤立或发生溢出，仍不能通过验收。

CVAgent 没有复制 DSH renderer 自己向 MCP 写 metrics 的宿主行为，而是由 `src/core/render.js` 生成渲染物、由 CVAgent session/HTTP 层接收当前 `renderId` 的测量。这是宿主适配差异，不是渲染能力降级。

### 3.4 手动 presentation 微调

当前已对齐 DSH 手动微调范围：

- 字体族；
- 字号；
- 行高；
- 模块间距；
- 页边距；
- 实际 iframe 中发现的图标逐项缩放和垂直偏移；
- 撤销、恢复默认和应用到当前草稿；
- 调整后重新生成 renderId 并重新读取真实 A4 metrics。

这部分采用 CVAgent 的产品适配：滑杆先是本地 presentation draft，用户点击“应用到当前草稿”后才写入当前简历的 presentation override。它不会修改正文、模板 CSS 或模板 revision，也不会绕过 finalize。

### 3.5 内置模板和 CSS

CVAgent 当前已迁移 DSH 的主要内置模板与 CSS：

- `business-ledger-plus`
- `magazine-feature`
- `geek-lab`
- `case-study`
- `portrait-profile`

模板 CSS 已使用 CVAgent 命名空间适配，并增加独立的 A4 页面尺寸和测量契约。结构上保持 DSH 的视觉基准，但仍需要逐模板真实浏览器截图确认，不能仅凭源码相似度宣称像素一致。

## 4. 本轮已补齐的能力

### 4.1 canonical 主题家族

`backend/src/migrated/resume-engine/theme-system.js` 现在是唯一主题来源，已包含 DSH 的 17 个家族及其 layout、typography、spacing、visual、moduleTypes 和 block preset。`template-generation.js` 与 `template_family_list` 均消费同一来源，未知 family 不会继续维护第二份静默回退表。

### 4.2 AI 模板候选的 layoutSpec 已接入渲染

DSH 的 `generateTemplateCandidate()` 不只生成颜色和字体，还会返回：

- module type 映射；
- block preset；
- layout IR；
- main/side 区域；
- 可被 Renderer 消费的 `layoutSpec`；
- 主题家族和模块预设说明。

`generateTemplateCandidate()` 现在同时返回并写入模板快照的 `layoutSpec`，包含 main/side regions、stack/split/grid IR、模块顺序、语义 block type 和 preset。`renderResumeDraft()` 会读取已保存模板的 layoutSpec，并把它传给 `assembleResumeSections()` 与 `buildPreviewDocument()`，因此候选结构不再只是元数据，而是实际参与渲染。

### 4.3 Agent 主题列表和自动调参已接入

DSH 业务契约中存在：

- `template_family_list`：列出主题家族和可用模块预设；
- `template_autotune`：基于真实 metrics 做受限的 1～3 轮自动调参。

CVAgent 现在提供 `template_family_list` 与 `template_autotune`。自动调参只接受当前 `renderId` 的真实 measurement，一次最多执行一个 round、最多支持三轮；它只修改当前简历 presentation，不修改正文或可复用模板。发生修改后会提升 presentation revision、使旧 render 失效，并明确要求重新 `resume_check → resume_render → resume_metrics → resume_finalize`。

### 4.4 不能把源码相似度当作视觉验收

CSS 文件和 renderer 经过命名空间适配后存在结构相似性，但以下内容必须用真实浏览器验收：

- 文字变长后的换行和分页；
- 一页饱满简历的上下留白；
- 双栏/网格的列宽和跨栏行为；
- 图标基线、照片裁切和链接显示；
- 每个主题的页面密度和标题层级；
- 打印样式和固定 A4 尺寸；
- 真实 viewport 下缩放后的完整可见性。

没有截图和当前 `renderId` metrics 的结果，只能称为代码迁移完成，不能称为渲染能力验收完成。

## 5. 后续验收与仍需补齐的部分

### 已完成的实现阶段

- canonical `theme-system.js`：17 个主题家族与 block preset；
- `template_family_list`：Agent 可读取同一主题来源；
- `template_generate`：返回 `layoutSpec`、主题信息与模块预设；
- 模板保存/加载：layoutSpec 随模板 revision 持久化；
- renderer：实际消费保存的 layoutSpec；
- `template_autotune`：受限、可解释、绑定当前 renderId 的 presentation mutation。

`template_generate` 当前返回：

```text
brief
template
layoutSpec
themeFamily
modulePresets
qualityAudit
nextSteps
```

候选仍然只存在内存中。只有用户明确要求创建、保存、替换或应用时，才进入 `template_save`。

### 仍需完成的验收

1. 17 个主题家族逐个用饱满真实简历渲染；
2. stack、split、grid 逐个截图并核对真实列宽、分页和留白；
3. 以真实浏览器触发至少一轮 overflow 和 sparse autotune，记录前后 renderId、metrics、截图；
4. 验证所有生成模板的 layoutSpec 在 UI 预览、正式渲染和版本恢复后仍一致；
5. 对照 DSH 的具体 CSS 视觉差异继续修正，而不是把后端 schema 通过当作视觉完成。

## 6. 能力验收矩阵

补齐后必须执行以下矩阵，不接受只测默认模板：

| 维度 | 验收范围 |
| --- | --- |
| 主题家族 | 17 个 DSH 家族全部可列出、生成、校验或明确标记不支持 |
| 内置模板 | 5 个模板逐个渲染 |
| 布局 | stack、split、grid |
| 模块 | profile、summary、contact、experience、projects、education、skills、awards、links、photo |
| 语义变体 | timeline、role-stack、feature-first、cards、compact、grouped-chips、rows、inline |
| 内容 | 短内容、饱满一页、目标两页、超长内容 |
| 资源 | 图标、照片、外链、图片、未知图标 token |
| 排版 | 字号、行高、模块间距、页边距、颜色、分隔线、图标微调 |
| 质量 | overflow、top/bottom whitespace、occupancy、blank ratio、module details |
| 生命周期 | generate → preview → save → render → measure → revise → restore |
| 验收证据 | 后端测试、前端构建、真实浏览器截图、当前 renderId metrics |

每个矩阵项至少保留：输入模板/简历、renderId、metrics、截图路径、测试结果和发现的问题。

## 7. 以后接手时先检查

1. 先读本文，再读 `specs/dsh-agent-parity/integration-handoff.md`；
2. 查看 `git status` 和最近提交；
3. 对照 DSH `lib/theme-system.js`、`lib/template-generation.js`、`lib/autotune.js`；
4. 确认 CVAgent 没有静默把未知主题回退到默认主题；
5. 确认 `template_generate` 返回并持久化 `layoutSpec`；
6. 确认 `template_autotune` 只接受真实当前 metrics；
7. 运行后端测试、前端构建和真实浏览器截图；
8. 最后才可以判断是“渲染内核平替”还是“完整模板能力平替”。

## 8. 当前禁止的表述

在视觉矩阵和真实浏览器证据补齐之前，不要写：

- “CVAgent 已完整复刻 DSH 模板能力”；
- “仅通过单元测试即可证明视觉平替”。

当前准确表述应为：

> CVAgent 已完成 DSH 简历渲染内核、A4 测量、手动 presentation 微调、主题生态、结构化模板生成和受限自动调参接入；最终视觉是否平替仍以真实浏览器验收矩阵为准。
