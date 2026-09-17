# CVAgent

CVAgent 是独立的 AI 简历生产产品。原有插件只作为可迁移能力和设计经验的来源，不作为运行时依赖。

## 当前已落地

- 独立产品目录和 Node.js 入口；
- Deep Agents Harness 接入边界；
- 统一 Agent 任务上下文；
- 内容、模板、渲染、指标版本绑定；
- 未通过验收不能完成/保存；
- 工具事件和按日期切分的结构化运行日志。
- 工作区清单和安全相对路径校验；
- 目录选择、受管工作区导入和不透明 `workspaceId`；
- 当前 Markdown 简历读取/摘要；
- 不覆盖源文件的隔离草稿写入；
- `POST /api/agent/run` 的独立 Agent 调用入口。

## 运行

```sh
npm install
npm test
npm start
```

默认健康检查：`http://127.0.0.1:3180/health`

Agent 调用入口：`POST http://127.0.0.1:3180/api/agent/run`
浏览器测量回传入口：`POST http://127.0.0.1:3180/api/agent/measure`
当前渲染预览：`GET http://127.0.0.1:3180/api/agent/preview?sessionId=...`
正式版本保存：`POST http://127.0.0.1:3180/api/agent/save`（必须明确传 `confirm: true`）
历史会话（兼容旧调用）：`GET http://127.0.0.1:3180/api/sessions?workspaceRoot=...&resumePath=resume.md`
恢复会话：`GET http://127.0.0.1:3180/api/session?sessionId=...`

工作区选择入口：

- `GET /api/workspaces`：列出最近的受管工作区；
- `POST /api/workspaces/import`：接收浏览器选择目录后的文件清单；
- `GET /api/source?workspaceId=...`：读取系统自动识别的简历源文件。

请求体最小示例：

```json
{
  "message": "基于当前简历生成一版产品经理草稿，先读取原文，再保留高信号证据并写入隔离草稿。",
  "workspaceId": "ws_...",
  "targetPages": 1
}
```

Web 用户只需要选择工作区目录。CVAgent 会把用户主动选择的文件导入自己的受管工作区，自动识别 `resume.md` 或首个 Markdown 简历，并在 API 层使用 `workspaceId`；绝对路径只存在于服务端内部。Agent 的第一版写入 `.cvagent/drafts/<taskId>/resume.md`，不会覆盖源 `resume.md`。
同一聊天可复用响应中的 `sessionId`；会话一旦绑定工作区和简历源，后续请求切换来源会被拒绝。历史的 `workspaceRoot + resumePath` 参数仍保留给旧脚本和迁移调用。
Session 快照、消息和事件默认保存在项目 `.cvagent/sessions/`，也可以通过 `CVAGENT_SESSION_DIR` 指定目录；服务重启后可以继续历史会话。
测量入口必须携带当前渲染返回的 `renderId`，因此旧预览或模型臆造的指标不能推进验收。
正式版本保存到 `.cvagent/versions/<versionId>/resume.md`，保存前必须通过验收且由用户确认；Agent 不能代替用户确认。

Agent 核心工具按 MCP 简历工序对齐：`resume_prepare → resume_read → resume_check → resume_write → resume_render → resume_metrics → resume_finalize`。模板和排版变化会使旧渲染、指标和验收结果失效。

## 当前架构原则

Deep Agents 负责规划、Skill、上下文和工具循环；简历领域核心负责唯一来源、版本失效、真实渲染指标和完成门。第一版不额外维护一套与 Deep Agents 平行的业务编排框架。

产品复盘见：[docs/agent-product-retrospective.zh.md](docs/agent-product-retrospective.zh.md)，MCP 工序对接见：[docs/CVAGENT_MCP_ALIGNMENT.zh.md](docs/CVAGENT_MCP_ALIGNMENT.zh.md)，生产级日志升级见：[docs/LOGGING_UPGRADE_RETROSPECTIVE.zh.md](docs/LOGGING_UPGRADE_RETROSPECTIVE.zh.md)，运行日志规范见：[docs/PROJECT_LOG.md](docs/PROJECT_LOG.md) 和 [logs/README.md](logs/README.md)。
工作区选择对接复盘见：[docs/WORKSPACE_SELECTION_RETROSPECTIVE.zh.md](docs/WORKSPACE_SELECTION_RETROSPECTIVE.zh.md)。
