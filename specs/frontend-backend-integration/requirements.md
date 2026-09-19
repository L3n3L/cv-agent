# 前后端真实链路对接需求

## 目标

让用户使用 `frontend/` 时，体验等同于 demo 已经连接 CVAgent 后端：工作区、会话、简历内容、Agent 修改、渲染预览和正式保存都来自同一条真实链路。

## 范围

- 浏览器目录导入为受控的 workspace import，前端只保存后端返回的 opaque `workspaceId`。
- 以 `sessionId` 绑定当前会话，所有源文件、草稿、Agent 执行、render 和测量都在该 session 下完成。
- 保留当前视觉布局，不在本阶段重做颜色、布局和动效。
- 删除或下线前端假响应前，必须有真实 API 和失败态。

## 验收标准

### R1 工作区

当用户选择一个包含简历的目录时，系统应上传允许的文件、创建 workspace，并在界面显示后端返回的工作区名称和 ID 状态；取消或导入失败时，原工作区不得被替换。

### R2 会话与源文件

当用户选择工作区并开始工作台时，系统应调用 bootstrap，建立 session，加载后端返回的 Markdown 草稿，并使用返回的 render 身份更新预览。

### R3 Agent 对话

当用户发送消息时，系统应把 `sessionId`、`workspaceId` 和消息发送到 `/api/agent/run`；执行中显示进行中状态，成功显示 Agent 文本和最新状态，失败显示可理解的错误且不伪造成功。

### R4 编辑、渲染与测量

当用户应用编辑器内容时，系统应先写入隔离 draft，再调用 render；预览必须使用最新 `renderId`，并在 iframe 加载后回传实际页数、占用率和溢出信息。

### R5 正式保存

只有后端状态为 accepted 且用户明确确认时，系统才允许调用 `/api/agent/save`；保存失败不得显示为已保存。

### R6 可维护性

前端 API 错误必须携带后端 `errorCode` 和 requestId；代理和后端日志必须可按 requestId、sessionId、workspaceId 关联。核心链路至少有 API 自动化测试和浏览器冒烟证据。

## 非目标

- 本阶段不迁移 dsh 插件 UI，也不保留两套可写业务实现。
- 本阶段不实现流式 Agent 输出；先保证请求、状态、结果和错误闭环。
- `backend/public` 历史静态副本已删除；后端只提供 API、Agent、会话、模板和渲染能力，页面唯一入口为 `frontend/react/`。
