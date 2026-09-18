# 测试脚本说明

`scripts/` 只放可重复执行的本地开发、诊断或测试辅助程序；生产 HTTP 服务仍从 `src/server.js` 启动。

## Agent 聊天浏览器测试服务

`agent-chat-browser-server.mjs` 启动一个独立的测试后端：

- 默认监听 `127.0.0.1:3281`；
- 在系统临时目录（或 `CVAGENT_TEST_ROOT`）创建独立工作区、会话、日志；
- 注入 `support/scripted-resume-agent.js`，不请求任何模型服务；
- 用于浏览器重放 Agent → SSE → A4 测量 → 验收 → 保存链路；
- 不属于生产 API，不能作为用户实际简历服务启动。

启动：

```powershell
cd backend
npm run test:browser-harness
```

可选环境变量：

```powershell
$env:CVAGENT_TEST_PORT = '3281'
$env:CVAGENT_TEST_ROOT = 'E:\temp\cvagent-browser-test'
npm run test:browser-harness
```

前端代理需要指向该端口时，设置 `CVAGENT_API_ORIGIN=http://127.0.0.1:3281` 后启动 `frontend/server.mjs`。

## 脚本化 Agent

`support/scripted-resume-agent.js` 不是“模拟一个语言模型”，而是确定性地调用 CVAgent 现有 canonical tools：

```text
resume_prepare → resume_read → resume_check → resume_write
→ resume_check → resume_render
```

浏览器或测试代码再回传真实/受控 metrics，并断言 `resume_finalize`、过期 `renderId` 拒绝及显式保存门。这样可以稳定测试产品工序，而不让模型随机性掩盖工作流回归。

维护规则：新增或修改 canonical 工具、事件名称、状态转换、SSE schema 时，必须同步更新 `backend/test/agent-chat-integration.test.js` 与本夹具；不要把用户简历、密钥或原始日志写入脚本或提交到仓库。
