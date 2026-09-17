# 日志升级设计

## 1. 模块边界

```text
MCP resume workflow
        │
        ├─ tool-runner.js：工具技术事件 + 业务事件触发
        ├─ event-catalog.js：事件名称、关联字段、事件构造
        ├─ logger.js：脱敏、序列化、轮转、保留、刷盘
        ├─ session-store.js：快照、消息、会话事件持久化
        └─ server.js：请求、恢复、源变化、保存拒绝、优雅退出
```

## 2. 事件模型

业务事件保留统一上下文：

```text
sessionId, runId, taskId, workspaceId, resumeId,
contentVersion, templateRevision, renderId
```

工具运行器继续产生 `tool_call_*`，根据工具结果产生业务事件：

| 工具 | 业务事件 |
| --- | --- |
| `resume_write` | `artifact_written` |
| `resume_render` | `render_started/succeeded/failed` |
| `resume_metrics` | `measurement_received` |
| `resume_finalize` | `verification_passed/blocked/failed` |

服务端负责：

| 场景 | 业务事件 |
| --- | --- |
| Agent 运行 | `agent_run_started/finished` |
| 会话加载 | `session_restored/session_interrupted` |
| 源文件变化 | `source_changed` |
| 保存 | `save_confirmed/save_rejected` |

## 3. 一致性策略

- 业务状态仍由 `workflow.js` 和会话快照决定，日志只用于审计。
- 事件写入复用 `sanitizeLogValue`，禁止会话事件绕过脱敏。
- 渲染 ID 在渲染操作开始前生成，确保开始和结束事件一致。
- 业务日志写入失败不抛回业务流程。
- 保存确认事件只在版本文件写入成功后产生。
- 事件序列测试覆盖成功、阻塞、失败、源变化和重启恢复。

## 4. 测试策略

- 事件目录字段测试。
- 工具运行器业务事件映射测试。
- 完整 Agent 工序成功序列测试。
- 验收阻塞和保存拒绝测试。
- 渲染失败和源文件变化测试。
- 会话重启恢复事件测试。
- 会话事件脱敏测试。
- 日志刷盘和既有轮转/脱敏回归测试。
