# CVAgent Fullstack

CVAgent 的单仓库前后端工程。前端和后端目录职责明确，插件源码不进入本仓库运行时。

## 目录

```text
frontend/   # 正式 Web 前端
backend/    # CVAgent API、Agent、工作区、模板、渲染和会话后端
```

## 开发启动

先启动后端：

```powershell
cd backend
npm install
npm start
```

再启动前端：

```powershell
cd frontend
$env:CVAGENT_API_ORIGIN = 'http://127.0.0.1:3180'
node server.mjs
```

前端地址：`http://127.0.0.1:3191/`

前端通过 `/api/*` 代理访问后端，避免浏览器直接连接 MCP 或依赖插件目录。后续前端 API Client 接通后，页面的会话、工作区、模板、简历和预览全部以 backend 返回值为准。

前端运行时错误通过 `POST /api/client-events` 上报到 backend 日志。接口只接受白名单字段，自动脱敏并拒绝未知字段；简历正文、聊天内容、提示词、密钥和本地绝对路径不会进入上报 payload。

## 仓库规则

- 前端视觉和交互只在 `frontend/` 修改；
- 业务能力、接口、Agent 和渲染只在 `backend/` 修改；
- 接口变更必须同步更新对接文档和测试；
- 不把 `.env`、`.cvagent`、`logs`、`node_modules` 提交到仓库；
- 不在前端恢复插件运行时依赖。

详细对接方案见 `backend/docs/DEMO_V2_FRONTEND_INTEGRATION_RETROSPECTIVE.zh.md`。
