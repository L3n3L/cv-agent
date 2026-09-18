# CVAgent ↔ DSH 简历模板渲染能力对接复盘

更新：2026-09-18  
状态：渲染内核基本对齐，模板生态与自动调参尚未达到完整平替  
基线提交：`59a197a feat: align presentation tuning with DSH workflow`

## 1. 复盘结论

本次审计不能把当前 CVAgent 描述为“已经完整复刻 DSH 插件能力”。准确结论是：

> CVAgent 已基本迁移 DSH 的简历渲染内核和 A4 验收能力，但模板生成生态、主题家族和自动调参仍存在明确缺口；在缺口补齐并通过真实浏览器矩阵验收前，不得宣称能力完全平替。

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

## 4. 尚未达到完整平替的能力

### 4.1 主题家族不完整

DSH 的 `theme-system.js` 当前有 17 个主题家族；CVAgent 的 `template-generation.js` 当前只有 8 个 `FAMILY_PROFILES`。

CVAgent 已有：

- `campus-clear`
- `engineering-dense`
- `split-focus`
- `editorial-quiet`
- `portfolio-grid`
- `business-timeline`
- `magazine-editorial`
- `geek-lab`

尚缺：

- `mono-terminal`
- `avatar-profile`
- `impact-board`
- `operation-block`
- `career-chronicle`
- `simple-typographic`
- `heading-stack`
- `case-study`
- `social-profile`

因此，当前 Agent 请求某些 DSH 主题家族时可能回退到 `campus-clear`，这不是完整平替，必须修正为显式拒绝或完整支持，不能静默降级。

### 4.2 AI 模板候选没有完整返回 DSH 的 layoutSpec

DSH 的 `generateTemplateCandidate()` 不只生成颜色和字体，还会返回：

- module type 映射；
- block preset；
- layout IR；
- main/side 区域；
- 可被 Renderer 消费的 `layoutSpec`；
- 主题家族和模块预设说明。

CVAgent 当前的 `generateTemplateCandidate()` 主要返回模板对象、质量审计和下一步建议，没有完整返回 DSH 同等级的 `layoutSpec` 与 block preset 结果。

影响：AI 可以生成一个看起来合法的模板对象，但新模板的模块语义、布局结构和主题预设可能没有完整落到渲染器上。这个缺口必须补齐后，才算“AI 能生成全新模板”，而不是“AI 生成一组模板元数据”。

### 4.3 Agent 工具缺少主题列表和自动调参

DSH 业务契约中存在：

- `template_family_list`：列出主题家族和可用模块预设；
- `template_autotune`：基于真实 metrics 做受限的 1～3 轮自动调参。

CVAgent 当前有 `template_generate`、`template_save`、`template_versions`、`template_restore`、`presentation_update` 和 `presentation_suggest`，但没有完整的 `template_family_list` 和 `template_autotune`。

`presentation_suggest` 只能提出建议，不能替代 DSH 的确定性自动调参能力。后续应将自动调参实现为受限、可解释、可回滚的 mutation，并继续要求重新渲染、重新测量和 finalize。

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

## 5. 后续补齐方案

### 阶段 A：建立 canonical theme system

- 新增 CVAgent 自己的 `theme-system.js`；
- 迁移 DSH 的 17 个主题家族和 block preset 语义；
- 不迁移 DSH workspace、MCP、宿主 UI 和全局状态；
- `template-generation.js` 只消费这一份主题来源，禁止继续维护第二份家族定义；
- `template_family_list` 直接返回同一 canonical source。

### 阶段 B：补齐 AI 模板候选的结构输出

`template_generate` 必须返回：

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

### 阶段 C：补齐受限自动调参

迁移 DSH `autotune.js` 的业务语义，但使用 CVAgent 的工具和状态约束：

1. 只接受当前 renderId 的真实 metrics；
2. 每次最多一个 round，最多连续三轮；
3. 溢出优先收紧页边距、模块间距，再考虑字号；
4. 留白过多优先增加字号、模块间距，再考虑页边距；
5. 每轮都生成新 presentation revision 和新 renderId；
6. 自动调参不改正文、不覆盖内置模板、不直接保存正式版本；
7. 每轮都要经过浏览器截图和 finalize。

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
5. 确认 `template_generate` 返回 `layoutSpec`；
6. 确认 `template_autotune` 只接受真实当前 metrics；
7. 运行后端测试、前端构建和真实浏览器截图；
8. 最后才可以判断是“渲染内核平替”还是“完整模板能力平替”。

## 8. 当前禁止的表述

在上述缺口补齐之前，不要写：

- “CVAgent 已完整复刻 DSH 模板能力”；
- “所有 DSH 模板家族都已迁移”；
- “AI 已具备自动调参能力”；
- “模板生成已经和 DSH 完全一致”；
- “仅通过单元测试即可证明视觉平替”。

当前准确表述应为：

> CVAgent 已完成 DSH 简历渲染内核、A4 测量和手动 presentation 微调的主体迁移；模板主题生态、候选结构输出和自动调参仍在补齐，后续以真实浏览器验收矩阵为准。
