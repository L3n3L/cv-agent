# 前后端真实链路对接设计

## 边界

```text
浏览器 frontend
  ├─ api-client.js：统一请求、错误、requestId
  ├─ app.js：页面状态与交互
  └─ file input：目录文件读取与导入 payload
          ↓ /api/*
frontend/server.mjs：同源代理与访问日志
          ↓
backend/src/server.js：workspace/session/agent/render/save
          ↓
CVAgent resume engine：Markdown、模板、A4 HTML、workflow state
```

## 状态模型

前端只维护以下运行时状态：`workspaceId`、`workspace`、`sessionId`、`resumePath`、`sourceContent`、`draftContent`、`templateId`、`renderId`、`workflowState`、`measurement`。界面文本由该状态派生；demo 夹具只在没有 workspace 时作为未接通提示，不作为业务状态。

## 请求顺序

1. `GET /api/workspaces`
2. 用户选择目录后 `POST /api/workspaces/import`
3. `POST /api/agent/bootstrap`，得到 `workspaceId/sessionId/source/context/renderId`
4. `GET /api/agent/preview?sessionId=...`
5. iframe 读取实际 DOM 后 `POST /api/agent/measure`
6. 对话调用 `POST /api/agent/run`
7. 编辑器调用 `POST /api/agent/draft`，随后 `POST /api/agent/render`
8. 通过验证后 `POST /api/agent/save` 且 `confirm=true`

## 失败策略

- HTTP 非 2xx 或 body `ok !== true` 统一转为带 `errorCode/requestId` 的异常。
- 任何请求失败只更新错误状态，不更新 session、render 或保存成功状态。
- renderId 变化后，旧测量结果立即失效；测量必须带当前 renderId。
- 浏览器页面只接收 workspaceId，不把后端本地绝对路径展示为可编辑业务入口。

## 测试策略

- 后端继续保留 workspace、bootstrap、run、measure、save 的自动化 contract tests。
- 前端先做原生 JS syntax check，再做浏览器冒烟：导入入口、bootstrap 后编辑器内容、真实 iframe、发送消息、错误态。
- 真实 Agent 依赖模型配置；自动化使用 injected agent，浏览器验收使用本地配置或明确记录未配置原因。
