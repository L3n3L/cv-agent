# Implementation Plan

- [x] 1. 建立数据流需求和现状证据
  - 记录 messages、workflowEvents、SSE 和前端临时状态的来源与归并方式。
  - 标记 paused 提前返回、有限事件快照截断和同步竞态风险。
  - _Requirement: REQ-1, REQ-2, REQ-3_

- [x] 2. 固化事件身份与回放设计
  - 引入 session 内单调 sequence。
  - 为 SSE workflow frame 增加 event id，并支持 Last-Event-ID。
  - _Requirement: REQ-2_

- [x] 3. 修复 Agent 各退出分支的消息持久化
  - 在用户执行开始前保存用户消息。
  - 统一保存正常、暂停、提前完成和失败前已获得的消息结果。
  - _Requirement: REQ-1_

- [x] 4. 修复前端事件归并和终态同步竞态
  - sequence 优先去重。
  - 保留当前流式文本 fallback。
  - 为重叠 session sync 排队最新一次同步。
  - _Requirement: REQ-1, REQ-3_

- [x] 5. 补齐自动化回归
  - paused 后消息恢复。
  - SSE 断点回放。
  - 长事件流和重复事件不漏渲染。
  - _Requirement: REQ-4_

- [x] 6. 完成构建、测试和浏览器链路验收
  - backend tests。
  - frontend typecheck/build。
  - 真实浏览器验证发送、失败、刷新和恢复；成功/暂停/测量链路继续由集成测试覆盖。
  - _Requirement: REQ-4_

## 第二阶段：数据流收敛与旧链路退役

- [x] 7. 建立 turn/run/message 的稳定身份模型
  - 为每次用户回合创建 `turnId`，为每次实际执行创建独立 `runId`。
  - 将 `turnId`、`runId`、`messageId` 贯穿 session、messages.ndjson、workflow event、SSE 和 API 响应。
  - 自动 continuation 归属于原 turn，不得复用旧 run 身份。
  - _Requirement: REQ-3, REQ-5_

- [x] 8. 统一 Agent run 终态
  - 工具失败、模型异常、取消、暂停和成功都必须产生明确终态。
  - 增加工具失败后必有 `agent_run_finished(outcome=failed)` 的回归测试。
  - 服务恢复只作为异常兜底，不再作为正常结束机制。
  - _Requirement: REQ-1, REQ-4, REQ-5_

- [x] 9. 重写前端 ConversationState reducer
  - 以 session snapshot、SSE replay 和 live event 为输入，统一归并成 turn timeline。
  - 按稳定身份去重 assistant delta、最终消息和工具事件。
  - 删除按 `groupIndex` 或数组位置绑定消息与 workflow 的逻辑。
  - _Requirement: REQ-3, REQ-5_

- [x] 10. 迁移并退役旧 renderer/fallback
  - 迁移所有调用方到新 reducer。
  - 删除旧 timeline renderer、按 `groupIndex` 关联和重复 assistant 渲染路径；仅保留文档明确允许的当前流式文本兜底。
  - 全局搜索并证明旧符号、旧接口和旧入口没有业务引用。
  - _Requirement: REQ-5_

- [x] 10.1. 实现 turn 内工具过程折叠呈现
  - 工具调用默认收起，不作为独立聊天消息平铺。
  - 运行中显示轻量渐变/呼吸状态，完成后显示稳定摘要。
  - 展开后按 sequence 显示工具名称、耗时、结果和错误。
  - 刷新或重连后默认收起，但保留完整工具事实和终态。
  - _Requirement: REQ-3, REQ-6_

- [x] 11. 执行开发期 session reset 并验证新会话恢复
  - 在切换新数据模型前清空开发环境 `.cvagent/sessions/*`，不迁移旧 session。
  - 保留工作区源文件、模板、渲染产物和诊断日志，不删除业务源材料。
  - 新 session 的最终 assistant 消息必须在刷新后可恢复，不依赖内存 delta。
  - _Requirement: REQ-1, REQ-3, REQ-5_

- [ ] 12. 完成删除式验收
  - 新建会话、多轮消息、自动 continuation、工具失败、刷新、SSE 重连和服务恢复全部实测。
  - 通过 backend tests、frontend typecheck/build、浏览器验收和残留引用扫描。
  - 只有旧实现已删除且 P0 全部通过，才将本 spec 标记为完成。
  - _Requirement: REQ-4, REQ-5_
