# Presentation 与模板工作台：设计

## 1. 设计规格

**用途：** 用户在现有“Markdown + A4 预览 + Agent”工作台中，安全控制当前简历的视觉呈现，并把模板当作长期工作区资产管理。

**视觉方向：** 克制的生产工具界面。沿用 CVAgent 当前的中性白灰表面、细分隔线、紧凑信息密度与同层 PaneHeader 契约；不引入渐变、营销卡片、额外说明文字或与主工作台冲突的色彩语言。

**色彩：** 继续使用现有 CSS token；简历强调色、分隔线、圆角等视觉 Token 是模板工坊的能力，不放进 A4 手动微调。

**字体：** 继续沿用项目当前与 Codex 对齐的界面字体 token。简历字体选择使用语义项“系统无衬线 / 现代无衬线 / 衬线”，不将字体名称当作产品装饰。

**布局：** 不改变当前工作台三栏结构。手动微调仍从 A4 预览右上角展开，作为该 pane 的紧凑浮层；模板库维持网格浏览，但每张模板卡统一使用固定元信息行和动作区，历史与创建使用就地抽屉，不增加全页向导。

## 2. 模块边界

```text
A4Pane (React)
  → browser-local presentation draft + iframe postMessage
  → explicit "应用到当前草稿"
  → /api/agent/presentation
  → presentation_update
  → session resume-scoped presentation override
  → /api/agent/render → canonical A4 iframe → browser metrics

模板库（既有路由，逐步 React 化）
  → /api/templates + /api/templates/versions
  → /api/templates/copy | generate | save | restore
  → workspace/templates + .cvagent/templates/<id>/revisions
  → explicit template_select → render → metrics
```

不让 presentation 写模板文件，也不让模板保存自动选择当前模板。这两个边界由现有后端工具和本期 UI 调用顺序共同保证。

## 3. 手动微调 V2

### 控件分组

| 组 | 参数 | 交互与作用范围 |
| --- | --- | --- |
| 字体与排版 | 字体、字号、行高、区块间距、页边距 | 右上角弹出浮层内的 select + slider；仅当前简历 |
| 图标 | 全局及每个实际图标的缩放、上下偏移 | 从当前 A4 iframe 的 `.cvagent-icon` 扫描库存；仅展示存在的图标 |

这直接对齐 DSH：每次滑杆变化即时作用于当前 iframe，保留最多 20 步本地撤销栈并提供默认恢复；关闭弹层不丢弃草稿。CVAgent 的生产性适配是：即时变化只在浏览器草稿中；用户点击“应用到当前草稿”后才写入受控 override、重新生成 canonical A4，并等待新的真实测量。这样不会把未重新渲染的 DOM 误当成带有可信 `renderId` 的正式结果。颜色、分隔线、圆角等视觉 Token 留给模板工坊，保存后作为模板修订的一部分。

首次实现用 typed `PresentationOverride` 传递 `layout/iconTuning`；后端仍保留 `visual` 字段给模板工坊使用，并由 Zod 与渲染引擎钳制范围。

## 4. 模板库补齐路径

### 卡片信息

每张卡片显示：名称、官方/我的模板、修订号、派生来源（若有）、当前使用状态。内置模板仅有“复制为我的模板 / 选择”；工作区模板额外有“历史”。

### 工作流

1. **复制：** 输入新的 lower-kebab-case ID 与显示名，调用 copy；成功后刷新列表，但不自动选择。
2. **历史：** 请求 versions，展示 revision、来源与保存时间；用户确认后调用 restore；刷新列表并提示“已生成新修订”，不自动选择。
3. **新建：** 在模板库中填写受控 Design Brief，调用 generate；页面展示候选摘要、质量审计与“保存为我的模板”；确认后调用 save，再刷新列表。候选不写入 local storage，刷新即失效。

第一批实现优先完成可读的来源/修订信息与历史查看；复制、新建表单和恢复操作按同一 API 契约扩展。任何结构性候选保存后仍需要用户明确选择并重新 A4 验收。

## 5. 测试策略

- 单元：presentation schema 与 reset 语义；模板 API 的修订递增、恢复不覆写。
- 集成：presentation 更新不创建模板文件；候选生成不落盘，确认保存后产生 revision 1。
- 浏览器：打开微调、修改排版与实际扫描到的图标、观察 iframe 即时变化且“保存正式版”被阻断；应用后观察 renderId 刷新；恢复默认；模板库显示官方/工作区来源与历史；保存与恢复后截图和控制台检查。
- 截图覆盖：一页饱满简历、两页饱满简历、窄 A4 pane、Agent 打开/收起状态。
