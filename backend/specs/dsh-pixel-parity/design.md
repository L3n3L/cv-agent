# DSH 像素级复刻设计

## 总体原则

采用“DOM/CSS 基线复用，数据与事件替换”的迁移方式。CVAgent 不再维护一套近似的工作台样式；可见工作台使用 DSH 的 `cj-*` 结构和 CSS，独立业务只通过明确的数据适配层连接到 CVAgent 后端。

## 前端边界

- `public/index.html`：保留 DSH 工作台主结构，预览视图仅渲染 `cj-mainBar` 与 `cj-previewWorkspace`；工作区输入只属于工作区视图。
- `public/workbench.css`：作为工作台视觉基线，来源规则保持可追溯；不得用同名的自有 CSS 覆盖尺寸、间距和字体。
- `public/styles.css`：只保留 CVAgent 外壳、非 DSH 视图和 Agent 独有样式；所有公共覆盖必须显式命名空间化。
- `public/app.js`：集中管理单一视图状态、单一当前实体、单一渲染请求和后端动作；禁止多个来源同时驱动选中模板、预览 URL 或页数状态。

## 状态模型

```text
workspaceRoot + resumePath
        ↓
currentResume / currentTemplate / presentationDraft
        ↓
draft revision
        ↓ render
render artifact + measurement
        ↓ quality gate
accepted snapshot
        ↓ save / save-as
immutable delivery version
```

页面只从当前任务快照读取状态。导航切换不创建新任务；重新渲染只替换当前 `renderId`；旧 iframe 在新渲染生效前不重复挂载。

## 后端契约

沿用现有 CVAgent 域接口并补齐响应结构：

- `/api/source`：读取授权工作区中的源 Markdown。
- `/api/templates`、`/api/template`、`/api/templates/copy`、`/api/templates/save`：模板目录和模板修订。
- `/api/agent/run`：创建或继续 Agent 任务。
- `/api/agent/draft`：写入隔离草稿并使旧渲染失效。
- `/api/agent/render`、`/api/agent/preview`：生成并读取当前渲染产物。
- `/api/agent/template`、`/api/agent/presentation`：保存当前任务的模板和呈现参数。
- `/api/agent/quality`：执行内容与排版验收。
- `/api/agent/save`：保存正式版本并固化内容、模板修订和排版参数绑定。
- `/api/versions` 及 rename/archive/read：版本管理。

所有写操作必须回传 `state`、`context`、`revision` 或 `renderId` 中与动作相关的字段；前端不得根据按钮点击自行推断成功。

## 像素验收方法

为 DSH 和 CVAgent 固定：Edge、viewport、device scale factor、字体加载完成时机、滚动位置、工作区、简历文件、模板、排版参数和视图状态。核心快照至少包括：空预览、已加载预览、手动调整打开、Agent 打开、模板库、模板工坊、版本页、排版检查页。

验收分两层：

1. DOM/Computed Style：检查关键节点数量、class、尺寸、字体、颜色、间距和可见性。
2. Screenshot diff：比较固定 viewport PNG；忽略浏览器时间、光标和抗锯齿区域，不允许忽略布局区域。

## 风险和保护

- 不能继续向 `styles.css` 追加同名覆盖；发现冲突先合并规则来源。
- 不能使用 HTML `hidden` 后又由后置 `display:flex/grid` 覆盖；统一使用 `.cj-workbench [hidden] { display:none !important; }`。
- 不能让模板选择、URL、当前版本存在多个状态源；所有选择变更必须经过 `currentContext`。
- 不能在每次 iframe load 时再次触发导航或渲染；渲染请求需要 request key 和过期响应丢弃。
