# CVAgent 布局契约与 React/Vite 对接复盘

更新时间：2026-09-18  
适用项目：`cv-agent`  
当前阶段：从静态前端逐步迁移到 React/Vite，保留现有工作台交互结构

## 1. 本次决策

CVAgent 不做“换一个聊天框”的局部改造，也不直接全量推翻现有前端。目标是：

1. 保留当前用户已经认可的工作流：左侧工作区/导航、中间 Markdown 草稿与 A4 预览、右侧 Agent；
2. 允许视觉升级，但所有模块必须遵守同一套布局与组件契约；
3. 用 React 负责组件边界、状态流和可复用 UI，用 Vite 负责开发构建与模块化；
4. 保留现有 Node 后端、API、简历工序和浏览器验收能力；
5. 每个阶段都能独立运行、截图、回归和回滚，禁止一次性重写后再猜问题。

React/Vite 本身不是视觉方案。它解决的是“同一套组件契约能否被稳定复用”，而不是自动把页面变好看。视觉变化必须来自明确的设计 token、间距规则、层级规则和截图验收。

## 2. 当前 UI 的核心问题

当前布局方向是对的，但模块之间是各自维护的：

- Markdown、A4、Agent 各自拥有标题、内容区、底栏和滚动边界；
- 标题起始线、标题高度、左右内边距、底部锚点没有统一来源；
- CSS 经过多轮追加覆盖，局部修复容易产生新的空白、遮挡或错位；
- Agent 打开/收起、侧栏宽度、A4 缩放会改变可用空间，但模块没有共同的尺寸计算契约；
- 过去用过的单点偏移（例如给某个标题额外加几像素）只能修一个截图，不能解决系统性对齐。

要解决的不是“把所有模块做成同一个卡片”，而是让它们共享外壳几何，同时保留各自的业务内容。

## 3. 统一与不统一的边界

### 3.1 必须统一的内容

以下内容属于工作台级别契约，由 `AppShell`、`WorkbenchGrid` 和共享 Pane 组件负责：

- 页面主轴：`sidebar | main route | agent`；
- 工作台主轴：`markdown | divider | a4`；Agent 打开时作为同级右侧 pane；
- 标题区域的顶部基线、固定高度、上下内边距和底部分隔线；
- 每个 pane 的左右内容起始线；
- pane 之间的 1px 分隔线与拖拽热区；
- 内容区的 `min-width: 0`、`min-height: 0`、overflow 边界；
- 工作台剩余高度、底部锚点和 Agent 打开/收起后的空间分配；
- pane footer 的底部对齐规则；
- 折叠、拖拽、A4 fit-to-width 的容器边界；
- 字体族、基础字号、颜色层级、边框色、焦点态和按钮高度等基础 token。

### 3.2 必须保持独立的内容

以下内容不能为了“齐平”而强行共用：

- A4 纸张内部页边距、模板字号、简历行距和模板自身的视觉装饰；
- Markdown 编辑器的文本滚动、等宽字体和编辑光标；
- Agent 时间线、工具调用折叠、消息气泡、Composer 和流式状态；
- 各模块的业务按钮和验收状态。

结论：统一的是容器几何与设计语言，不是把三种内容做成同一类控件。

## 4. 目标组件契约

目标结构：

```text
AppShell
├─ Sidebar
│  └─ WorkspaceHeader
├─ MainStage
│  ├─ RouteHeader
│  └─ WorkbenchGrid
│     ├─ MarkdownPane
│     │  ├─ PaneHeader variant="editor"
│     │  ├─ PaneBody
│     │  └─ PaneFooter
│     ├─ ResizeDivider
│     └─ A4Pane
│        ├─ PaneHeader variant="preview"
│        ├─ PaneBody
│        └─ PaneFooter
└─ AgentPane
   ├─ PaneHeader variant="agent"
   ├─ Timeline
   └─ Composer
```

共享组件只拥有布局属性，不拥有业务内容：

- `PaneHeader`：统一标题基线、标题高度、状态位和分隔线；
- `PaneBody`：统一 `min-width/min-height/overflow` 语义；
- `PaneFooter`：统一底部锚定和边界；
- `WorkbenchGrid`：统一列轨道、拖拽分隔线和打开/收起后的宽度计算；
- `LayoutTokens`：统一 CSS variables，不允许业务组件自行定义同义间距。

旧 DOM 到目标组件的映射：

| 当前实现 | 目标组件 | 迁移原则 |
| --- | --- | --- |
| `.editor-head` | `PaneHeader variant="editor"` | 保留 Markdown 语义，改为共享几何 |
| `.direct-preview-head` | `PaneHeader variant="preview"` | 保留 A4 状态与适配按钮 |
| `.drawer-header` | `PaneHeader variant="agent"` | 保留 Agent 收起操作 |
| `.workspace-switcher` | `WorkspaceHeader` | 使用同一套标题/副标题 token |
| `.workbench-split` | `WorkbenchGrid` | 保留拖拽和列比例 |
| `.assistant-drawer` | `AgentPane` | 作为同级 pane，不覆盖 A4 |

## 5. 视觉策略

本项目允许视觉变化，但采用“低噪声文档工作台”方向：

- 主色继续以现有深色文字、浅灰画布和克制蓝色强调为基础；
- 不用大量卡片、渐变、阴影和圆角制造“AI 产品感”；
- 通过同一条基线、同一套边界、同一组间距和少量层级色制造整体感；
- 大块编辑区和预览区优先使用连续画布，模块之间用 1px 分隔线；
- 边界只在确实需要时出现，避免每个功能都套独立矩形卡片；
- 允许调整字体、间距、边框和标题层级，但每次调整都必须说明影响范围并截图验证。

## 6. React/Vite 迁移边界

### 第一阶段：壳层与契约

- 建立 Vite 开发入口和 React `AppShell`；
- 搭建 `WorkbenchGrid`、`PaneHeader`、`PaneFooter`、`ResizeDivider`；
- 复用现有 class/token 或提供兼容映射，保持当前三栏位置与交互；
- 不迁移简历业务逻辑，不改 API，不改 Agent 工具协议。

### 第二阶段：按 pane 迁移

顺序固定为：

1. Markdown 编辑器；
2. A4 预览与 presentation 控制；
3. Agent 时间线、工具调用折叠和 Composer；
4. 侧栏与会话列表。

每迁移一个 pane，都必须同时完成：类型检查、构建、旧功能回归、浏览器截图。

### 第三阶段：切换与清理

- Vite 构建产物由现有 Node 服务提供；
- 删除已迁移且无引用的旧 DOM 拼接逻辑；
- 保留 API 契约测试和布局契约测试；
- 只有在新入口通过截图验收后，才删除旧入口。

## 7. 截图验收矩阵

每个阶段至少验收以下场景：

| 场景 | 重点检查 |
| --- | --- |
| 1600×1000，Agent 打开 | 三个 pane 标题基线、左右分隔线、A4 右边缘不被遮挡 |
| 1280×720，Agent 打开 | 工作台填满剩余高度，Composer 不覆盖内容 |
| 1280×720，Agent 收起 | Markdown/A4 直接贴合主工作区，不出现外部空白带 |
| 拖动侧栏/编辑器/Agent | 不能重叠，不能出现负宽度，A4 始终可见 |
| Markdown 长文本 | 编辑区内部滚动，底栏不制造大面积空白 |
| A4 长简历 | 纸张 fit-to-width，纸张外画布可见，不能被 pane 裁掉 |
| Agent 工具调用 | 事件按时间顺序出现，工具组可展开/收起，刷新后仍可恢复 |

验收记录必须包含：视口尺寸、操作路径、预期、实际、截图路径、控制台错误数和网络错误数。

## 8. 设计与实现禁区

- 不用单个组件的 `margin-top` 或 `padding-top` 修复跨模块错位；
- 不给 A4 纸张内部样式加规则来修复外层工作台空白；
- 不让 Agent 通过绝对定位覆盖 Markdown/A4；
- 不把 React 迁移等同于全量重写；
- 不在没有截图的情况下宣称视觉修复完成；
- 不为了组件复用牺牲 Markdown、A4 或 Agent 的专有交互。

## 9. 回滚与提交策略

每个阶段独立提交：

1. 文档与契约；
2. React/Vite 壳层；
3. Markdown pane；
4. A4 pane；
5. Agent pane；
6. 旧入口清理。

任一阶段出现布局回归，只回滚该阶段，不回滚已经验证通过的后端和前端历史修复。

当前已验证的基础修复提交：

- `46e4afa`：恢复 Agent 标题栏；
- `fb8e2e8`：分隔线与拖拽热区解耦；
- `b46b535`：减少工作台内部无意义空白；
- `2a4b976`：填满无 Agent 工作台高度；
- `e1dfe55`：填满 Agent 打开时工作台高度；
- `cfd8df6`：移除 Agent 收起后的工作台外部 gutters。

这些提交是迁移基线，不代表最终视觉不可改变。

## 10. 本轮执行顺序

1. 保留现有静态前端作为行为基线；
2. 写入本复盘文档和布局契约测试；
3. 建立 React/Vite 壳层，不改变后端和三栏交互；
4. 用同一组 token 和共享 Pane 组件完成标题、边界、底部锚点统一；
5. 逐个迁移业务 pane；
6. 每一步运行测试并启动 `3191` 服务截图验收；
7. 通过后再提交和推送。

## 11. 第一阶段执行记录（2026-09-18）

已完成：

- 新增 `frontend/react` React + Vite + TypeScript 工程，不替换现有根入口；
- React 壳层复现旧页面所需的 DOM id/class 契约，继续复用现有 API、Agent 工具时间线和简历渲染逻辑；
- `frontend/server.mjs` 增加 `/react/` 构建产物入口；
- 增加 React/Vite 壳层契约测试；
- 增加桌面端最小 pane 宽度契约，并在 Agent 打开时自动收敛历史拖拽宽度，避免 A4 被挤成不可用窄条；
- 保留 Agent 打开/收起、Markdown 编辑、A4 预览和拖拽分隔线的现有交互。

截图验收结果：

- 1280×720、Agent 打开：Markdown 约 281px，A4 280px，Agent 约 372px；三者同级，无重叠；
- 1280×720、Agent 收起：工作台从主区左边界铺到右边界，A4 右侧没有被遮挡；
- React 页面控制台 error/warning：0；
- 后端回归测试：35/35 通过；
- React/Vite 类型检查和生产构建：通过。

当前仍未完成：

- A4、Agent 的业务 pane 尚未改写为 React 组件；
- 共享 `PaneHeader`、`PaneFooter` 还处于契约设计阶段，旧 selector 仍是行为基线；
- `/react/` 目前是并行验收入口，根路径仍使用旧入口，待各 pane 逐个迁移并通过截图后再切换。

## 12. 第二阶段执行记录：Markdown pane（2026-09-18）

已完成：

- 新增 React `PaneHeader` 和 `MarkdownPane` 组件；
- 通过 `legacy-bridge` 将 React Markdown pane 挂载到现有工作台，不复制后端状态；
- 保留现有 `#resumeEditor`、`#editorApply`、`.editor-layout` 等行为契约，保存与重新渲染仍由原有 Agent 工作流负责；
- 路由切换时卸载旧 React root，避免重复挂载和事件累积；
- 补充 React 挂载点的全高尺寸契约，避免嵌套挂载后编辑区被压缩。

验收结果：

- Markdown pane 实际挂载数量：1；
- 路由切换后 Markdown pane 未重复挂载；
- 1280×720、Agent 打开时 Markdown/A4/Agent 仍为同级，编辑区和 A4 均保持可用宽度；
- 控制台 error/warning：0；
- React 类型检查、生产构建和后端 35 项回归测试：通过。
