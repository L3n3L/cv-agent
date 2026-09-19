# DRAFT_REQUIRED / TOOL_FAILED 对接复盘

## 现象

“重新渲染简历”反复出现 `DRAFT_REQUIRED`；浏览器继续对旧预览提交 A4 测量时出现 `TOOL_FAILED`；占用率在前端容易显示为 100%。

## 根因

1. `resume_prepare` 是只读预检，不会把 `blocked` 恢复为 `drafting`，但 Skill 让 Agent 在 prepare 后直接 render。
2. 任务虽然保留 `contentVersion`，但状态机只允许 `drafting -> rendered`，因此有草稿不等于允许渲染。
3. 前端同步 session 时会保留不存在的旧 `renderId`，测量回调又只校验身份，不校验任务生命周期状态。
4. 后端渲染器已经计算真实内容边界，前端却用固定 A4 容器的 `scrollHeight/clientHeight` 二次估算，产生虚假的满占用。
5. 工具异常缺少恢复分类，业务状态错误容易被用户看到为泛化 `TOOL_FAILED`。
6. 前端原先只在 iframe `load` 时读取一次 `__cvagentMetrics`；渲染器稍后完成分页时，页面已经有真实指标但父窗口永远不会再次提交测量。

## 本次落地原则

- 状态恢复显式化：新增 `resume_reopen_draft`。
- 状态与身份双门禁：`workflowState`、`runState`、`sessionId`、`renderId` 必须同时匹配。
- 指标单一来源：以渲染器 `__cvagentMetrics` 为准。
- 指标回传有明确事件边界：渲染器完成分页后 `postMessage` 给父窗口，父窗口按 `sessionId + renderId` 去重；load 读取仅为旧产物兜底。
- 错误保留上下文：错误码、当前状态、草稿可用性、恢复工具必须可见。
- 先写可验收文档，再做代码修改；不以增加提示词掩盖状态机缺陷。

## 验收结果

### 对照文档验收记录

- R1/R2：通过。后端测试覆盖 `blocked|needs_revision + draft -> resume_reopen_draft -> drafting -> resume_render`，并验证无草稿时返回结构化 `DRAFT_REQUIRED`。
- R3：通过。前端同步在无当前 render 时清理本地身份；服务端旧 render 回调实测返回 `MEASUREMENT_STALE`，当前 render 与测量未被污染。
- R4：通过。浏览器实测当前 render `render_faff3adc-e6ba-4be0-9473-dbc0be2d1a05` 回传 2 页、逐页占用率 `[0.879, 0.1]`；前端 iframe 显示“已完成真实 A4 测量”，未使用固定容器推算。
- R5：通过。`presentation_suggest` 在没有当前测量时返回结构化 `MEASUREMENT_REQUIRED`，不再触发 DeepAgent 未处理拒绝；自动修订 4 轮期间后端保持健康。
- R6：通过。后端 `npm test` 80/80；前端 `typecheck`、`build`、前端契约测试通过；浏览器走通恢复、渲染、消息回传、测量和旧 render 拒绝。

剩余业务结论：当前测试简历最终为 `needs_revision`（2 页，`[0.879, 0.1]`），这是排版验收结果，不是链路失败；自动修订预算已用尽，正文没有因本次恢复链路被改写。
