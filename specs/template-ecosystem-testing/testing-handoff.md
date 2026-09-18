# 模板生态全面测试对接复盘

## 目标与边界

本轮验证 CVAgent 的模板生态是否能在单用户、长期工作区里可靠运行，而不只验证某个接口返回 200。测试对象包括：内置模板、Agent 候选生成、自定义模板入库、不可变修订、恢复、正式简历版本可复现性，以及工作台、会话、模板库三者的状态联动和后续 UI 截图验收。

工作区是模板资产边界；内置模板是只读产品资产。模板候选在用户明确创建、保存、替换或恢复前不得写入工作区，也不得改变当前简历选择。

## 当前实现基线

| 能力 | 当前实现 | 测试结论 |
| --- | --- | --- |
| 内置模板 | `backend/src/migrated/resume-engine/template-presets.js` | 只读；复制后才进入工作区 |
| 候选生成 | `template-generation.js` | 受限 Design Brief，候选只在内存存在 |
| 当前模板 | `<workspace>/templates/<id>.json/.css` | 供渲染器读取的当前版本 |
| 修订快照 | `.cvagent/templates/<id>/revisions/0001/...` | 创建、替换、恢复均写新快照 |
| 历史兼容 | `.cvagent/legacy/template-history/` | 只读回退，不再追加 |
| Agent 工具 | `template_generate/save/versions/restore` | 保存与恢复需要 `confirmedByUser=true` |
| 正式简历版本 | `.cvagent/versions/<id>/version.json` | 记录模板 ID、修订、快照路径、指纹与 presentation |

## 必测用户路径

### 0. 工作台、会话与模板库联动

1. 工作台打开某个会话时，模板库只展示该工作区的自定义模板与全局内置模板；不得混入其他工作区；
2. 模板库“查看候选/复制/保存/恢复”后，列表修订号必须刷新；候选未保存时不得出现在列表；
3. 会话只有在 `template_select` 后才更新当前 `templateId@revision`；仅保存或恢复其他模板不得静默替换工作台预览；
4. 若恢复的是会话当前模板，会话 render/metrics 必须失效，工作台必须要求重新渲染；
5. 若恢复的不是当前模板，会话和工作台预览保持不变，直到用户显式选择；
6. 刷新页面或服务重启后，会话持久化的模板身份、工作台当前预览和模板库最新修订必须一致；
7. 正式保存版本后，从版本列表重新读取的 `templateSnapshot` 必须对应当时会话的模板修订，而不是模板库后续最新修订。

### A. 新用户从空工作区制作

1. 选择空目录，CVAgent 初始化 `resume.md`；
2. Agent 读取、收集信息、选择内置模板；
3. 生成草稿、渲染、浏览器回传当前 `renderId` 指标、`finalize` 通过；
4. 用户确认保存；
5. 保存版本必须包含 `templateSnapshot`，且其修订、路径和指纹可定位当时模板。

### B. 新建模板但暂不保存

1. 用户要求全新模板；
2. Agent 调用 `template_generate`；
3. 返回 TemplateSpec、质量审计与下一步，但 `templates/` 和 `.cvagent/templates/` 不得新增文件；
4. 未明确确认时，`template_save` 必须拒绝。

### C. 创建、替换与恢复模板

1. 用户明确保存候选，产生 `0001`；
2. 明确替换产生 `0002`，`0001` 内容不变；
3. 恢复 `0001` 产生 `0003`，而不是覆写 `0002`；
4. 当前平铺模板与最新修订内容一致；
5. 渲染只能使用显式 `template_select` 选中的版本。

### D. 视觉与 A4 验收

对每种改变后的模板，使用一页和两页“饱满真实简历”执行：

- 真实浏览器截图，不以 HTML 字符串或模拟页数替代；
- 截图检查标题、模块、页尾、双栏/单栏流与打印样式；
- 指标必须绑定新 renderId；
- 溢出、稀疏页、页数偏差均不得进入正式保存；
- UI 模板库显示来源、当前修订与可恢复历史，且不会让用户误以为候选已经保存。

## 自动化分层与故障定位

| 层 | 入口 | 应捕获的问题 |
| --- | --- | --- |
| 纯函数 | `template-generation.test.js` | 非法 brief、CSS、TemplateSpec、候选不确定性 |
| 文件系统 | `template-presets` 测试 | 修订号、快照缺失、恢复覆写历史、迁移兼容 |
| Agent 工具 | `createResumeTools` | 工具未注册、确认门绕过、选择后未失效渲染 |
| HTTP | `/api/templates/*` | 序列化、错误码、确认门、工作区解析 |
| 会话保存 | `/api/agent/save` | `version.json` 缺少模板快照身份 |
| 工作台联动 | 工作台 bootstrap、会话 SSE、模板库 API | 选择静默变化、模板库不刷新、恢复后渲染未失效 |
| 浏览器 | 本地工作台 + 截图 | UI 状态不同步、预览未刷新、视觉与 A4 实测问题 |

日志排查顺序：先按 `sessionId → runId → taskId → renderId` 查结构化日志；再读取对应 `.cvagent` 草稿、render 与模板修订；最后用浏览器复现。不要用模型自然语言结论取代测量或截图。

## 本轮执行记录

- 已有：候选生成、修订写入/恢复、HTTP 确认门自动化覆盖。
- 本轮补充：正式简历版本模板快照断言；Agent 工具级确认门和选择失效断言；工作台/会话/模板库联动夹具。
- 真实浏览器回归（`http://127.0.0.1:3191/react/`，`.test-import`）：Agent 实际创建了 `browser-link-verify` 工作区模板副本；模板库真实显示“浏览器联动验证 · 修订 1”；刷新页面后该卡片仍显示“当前使用”。
- 浏览器首次运行暴露并修复：任务已有隔离草稿但处于 `blocked` 时，`recordTemplateChange` 没有回到 `drafting`，导致 Agent 和模板库都会在重新渲染时收到 `DRAFT_REQUIRED`。现在任何已有 `contentVersion` 的模板变更都会重新进入 `drafting`；新增回归测试覆盖此状态。
- 修复后在同一浏览器实际完成：`browser-link-verify → campus-standard → browser-link-verify`。两次切换均重新产生 render，模板库卡片与会话恢复状态一致，最终卡片为“当前使用”。
- 第二轮受控 Agent 浏览器测试实际执行 `template_generate → template_save(confirmedByUser=true) → template_select → resume_render`，持久化生成 `browser-generated-candidate@1`，并在模板库真实显示为当前模板。该候选的质量审计仍是 `needs-visual-work`，因此它仅作为生命周期闭环样本，不应被当作可投递的生产模板。
- 该轮还暴露了两个前端闭环问题：模板库只渲染缩略图时没有唯一的 A4 测量目标；旧测量回调完成后会自动发起 Agent 续跑，可能擅自改变用户内容或版式。现在选择模板会自动回到工作台，以唯一真实预览 iframe 测量；测量只更新验收状态，是否让 Agent 再继续必须由用户显式发起。过期 `renderId` 回调被丢弃。
- 最后一次真实浏览器回归：从模板库选择 `browser-generated-candidate` 后，页面自动回到工作台，A4 预览显示新模板、状态显示“已完成真实 A4 测量”、保存正式版解锁，左侧当前会话也同步为“验收通过 · 1 页”。这证明“选择 → 渲染 → 浏览器测量 → 验收状态/UI 同步”已经闭环。
- 浏览器控制台同时发现路由切换期间 `#editorState` 可能已卸载；`saveDraftAndRender` 已改为 null-safe。无 URL 的 `MutationObserver` 报错来自浏览器注入环境，源码中没有对应观察器调用，不能归因到 CVAgent 页面。
- 仍待补：用一页和两页专用夹具跑 `render → browser metrics → finalize → save version`，并把每页占用率与截图作为正式验收附件；模板切换成功不等于 A4 验收通过。

## 回归命令

```powershell
Set-Location E:\vsws\deepseek-harness-plugins\cv-agent\backend
npm.cmd test
```

通过标准：所有测试通过；任何模板保存、恢复、渲染或版本保存路径都能追溯模板身份；浏览器验收只对真实渲染结果判定。
