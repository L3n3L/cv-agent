# 简历渲染状态恢复：设计

## 设计结论

保留 DeepAgent 作为推理和工具编排层，把“状态转换、当前 render 身份、测量提交和错误分类”收敛到 CVAgent harness。Agent 不应靠提示词猜测如何从 `blocked` 恢复；恢复动作必须是显式工具和结构化结果。

## 正确数据流

```text
用户消息
  -> session lock
  -> Agent 读取 task state
  -> resume_prepare 返回 state / draftAvailable / nextAction
  -> blocked|needs_revision + draft
  -> resume_reopen_draft
  -> drafting
  -> resume_check
  -> resume_render
  -> rendered + 新 renderId
  -> 当前 iframe 的渲染器完成分页
  -> iframe postMessage 回传 __cvagentMetrics
  -> 父窗口校验 source / sessionId / renderId
  -> /api/agent/measure
  -> measured
  -> resume_finalize
  -> accepted 或 needs_revision
```

## 状态规则

`resume_reopen_draft` 是唯一的“保留当前草稿、清除旧渲染依赖并恢复编辑态”的显式动作：

```text
blocked / needs_revision + contentVersion
  -> drafting + renderId=null + measurements=null + blockers=[]
```

`resume_prepare` 不隐藏修改任务状态，只返回恢复建议；这样事件审计仍能区分“读取状态”和“改变状态”。

## 错误协议

工具失败至少包含：

```json
{
  "errorCode": "DRAFT_REQUIRED",
  "failureClass": "requires_transition",
  "currentState": "blocked",
  "draftAvailable": true,
  "recoveryTool": "resume_reopen_draft"
}
```

错误分类：

- `requires_transition`：需要调用明确的恢复工具。
- `stale_context`：旧 `sessionId`、`renderId` 或内容版本。
- `retryable`：临时 IO / 网络异常，最多有限重试。
- `user_blocked`：缺少用户事实或正式确认。
- `fatal`：程序错误，结束当前回合并保留诊断上下文。

底层 handler 仍然抛出异常以保持审计和 LangChain 语义；公开给 Agent 的工具入口只把已知可恢复业务错误转换为结构化结果，未知/致命异常继续抛出。事件和错误对象不能丢失业务错误码和恢复信息。

## 测量规则

渲染器是页面指标的唯一权威来源。前端顺序：

1. 校验 session、workflow state、run state、renderId 都是当前值。
2. 以预览渲染器完成分页后发出的 `postMessage` 为主入口，消息必须包含 `source: cvagent-resume-preview` 和当前 `renderId`。
3. 从消息中的 `metrics` 读取 `pageCount`、`overflow`、`pages[].occupancyRatio`；同一 render 只允许提交一次。
4. iframe `load` 时读取 `window.__cvagentMetrics.metrics` 只作为旧预览产物兼容回退，并允许有限次延迟重试。
5. 官方指标缺失时不提交伪造的 100%，等待下一次可测量状态。

## 兼容性与风险

- 新工具只增加 Agent 能力，不改变现有 API 路径。
- 旧 session 可以继续读取；它们在下一次 `resume_prepare` 时得到恢复提示。
- 前端清理旧 renderId 可能隐藏旧预览，但这是正确行为，避免旧测量污染新任务。
- 不对无效测量无限重试；仅允许当前 render 的消息回传和有限的 load 回退重试，旧 render 永远不能触发测量。

## 验证策略

- `workflow` 单测验证状态转换和结构化恢复信息。
- 工具单测验证 `resume_prepare` 和 `resume_reopen_draft`。
- server 集成测试验证阻塞 session 的真实恢复闭环。
- 前端契约测试验证状态门禁、旧 render 清理和官方指标读取。
- 浏览器验证记录 route、操作、期望、结果和控制台。
