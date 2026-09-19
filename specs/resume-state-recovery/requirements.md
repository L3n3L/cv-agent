# 简历渲染状态恢复：需求与验收标准

## 背景

当前简历生产链路在测量失败、验收阻塞或服务重启后，可能保留 `contentVersion` 和旧 `renderId`，但任务状态已经是 `blocked`。此时 Agent 按现有 Skill 直接执行 `resume_render`，会得到 `DRAFT_REQUIRED`；前端还可能继续对旧 iframe 提交测量，最终表现为 `TOOL_FAILED`。此外，前端使用固定 A4 容器的 `scrollHeight/clientHeight` 重新估算占用率，导致占用率容易被错误显示为 100%。

## 用户故事

1. 作为简历制作者，我在上一次测量失败后继续对话时，Agent 应能识别已有隔离草稿并恢复到可渲染状态，而不是重复停在 `DRAFT_REQUIRED`。
2. 作为简历制作者，我希望只有当前有效 render 的浏览器测量会写回任务，旧预览或阻塞状态不能污染当前会话。
3. 作为维护者，我希望看到可分类的状态错误、恢复动作和上下文，而不是只看到泛化的 `TOOL_FAILED`。
4. 作为简历制作者，我希望 A4 占用率来自渲染器实际计算的内容边界，而不是固定页面容器高度。

## 范围

- 后端任务状态恢复：`blocked` / `needs_revision` + 当前草稿 -> `drafting`。
- `resume_prepare` 返回真实状态、草稿可用性和下一动作，并优先检查当前隔离草稿。
- 新增显式 `resume_reopen_draft` 工具，保持状态转换可追踪。
- 前端清理陈旧 `renderId`，仅在当前 `rendered` 且等待测量时提交测量。
- 前端优先使用渲染器的 `window.__cvagentMetrics` 指标。
- 预览渲染器完成分页后通过 `postMessage` 主动回传同一份指标；iframe `load` 读取只作为旧产物兼容回退，不依赖单次 load 时序。
- 错误事件保留原始错误码，并带恢复分类。
- 单元、集成、浏览器验收证据。

## 非目标

- 不改变简历生产的业务规则、模板选择规则或正式版本保存权限。
- 不把浏览器测量交给模型生成。
- 不把所有工具异常静默吞掉或无限重试。
- 不迁移 DeepAgent 或替换当前 Agent 框架。

## EARS 验收标准

### R1 状态恢复

- 当任务状态为 `blocked` 或 `needs_revision` 且存在当前 `contentVersion` 时，系统应返回 `resume_reopen_draft` 作为下一动作。
- 当用户继续当前任务时，Agent 调用 `resume_reopen_draft` 后，任务应进入 `drafting`，并清除旧 `renderId`、旧测量和旧阻塞项。
- 当任务没有当前草稿时，系统应明确返回需要 `resume_write`，不能伪造恢复成功。

### R2 渲染前置条件

- 当任务不是 `drafting` 或不存在当前 `contentVersion` 时，`resume_render` 应返回 `DRAFT_REQUIRED`，同时包含当前状态、是否有草稿和恢复工具，不得只返回泛化错误。
- 当任务恢复到 `drafting` 后，`resume_render` 应能正常生成新的 `renderId`，且旧 render 不再是当前 render。

### R3 测量一致性

- 当 session 状态不是 `rendered` 或当前 run 不是等待测量时，前端不得提交 `/api/agent/measure`。
- 当后端 session 没有 `renderId` 时，前端必须清理本地旧 `renderId`，不能使用旧值继续渲染或测量。
- 当浏览器回调的 `renderId` 与当前 session 不一致时，回调必须被丢弃且不能更新 UI 状态。

### R4 指标真实性

- 当预览 iframe 暴露 `window.__cvagentMetrics.metrics` 时，前端应使用其 `pageCount`、`overflow` 和逐页 `occupancyRatio`。
- 当渲染器向父窗口发送 `source: cvagent-resume-preview` 的指标消息时，前端应校验消息来源、当前 `sessionId`、当前 `renderId` 后提交同一份指标；消息和 load 回退不得产生重复测量。
- 当官方指标缺失时，系统应报告测量不可用或等待，而不是把固定容器高度当作 100% 内容占用率。

### R5 错误可恢复性

- 当业务工具失败时，事件和 API 响应应保留原始 `errorCode`，并提供 `failureClass` 与 `recoveryTool`（如果存在）。
- 对可恢复的状态错误，Agent 应能根据工具结果继续执行；对真正的致命错误才结束当前回合。

### R6 回归与验收

- 后端现有测试与新增状态恢复、陈旧测量、官方指标测试全部通过。
- 前端 typecheck/build 通过。
- 浏览器真实验证包含：阻塞任务恢复、产生新 render、当前 render 测量、旧 render 测量被拒绝、占用率不再由固定容器强制变为 100%。
