# CVAgent ↔ 简历 MCP 对接复盘与执行基线

> 这是 CVAgent 后续开发的恢复文档。上下文被压缩、会话中断或重新接手项目时，先读本文，再读 `src/core/workflow.js`、`src/core/session.js`、`src/agent/resume-tools.js` 和原插件的 `mcp-server/index.js`。

## 1. 最终需求

CVAgent 不是只提供几个“类似 MCP 的工具”，而是要在核心简历制作工序、状态约束、版本绑定和验收结果上对齐原插件 MCP。实现可以独立：不启动 DSH、不连接 MCP、不复制 DSH 宿主会话；但同一份简历在 CVAgent 中必须遵守相同的业务契约。

对齐对象分层如下：

| 层级 | 权威来源 | CVAgent 实现 |
| --- | --- | --- |
| Agent 工序、提示词、完成条件 | 原插件 MCP 的 `RESUME_AGENT_CONTRACT` / `RESUME_MCP_INSTRUCTIONS` | `src/agent/system-prompt.js`、Agent 工具契约 |
| 状态转换、失效规则、完成门 | 原插件 MCP 的 `resume_prepare` 至 `resume_finalize` | `src/core/workflow.js`，不得由模型自行判断 |
| 模板、渲染、CSS、视觉结果 | DSH 原生简历渲染器 | `src/migrated/resume-engine/`、`src/core/render.js` |
| 会话、草稿、版本持久化 | CVAgent 自己的产品边界 | `.cvagent/`、SessionStore、HTTP/UI |

## 2. 核心工序契约

核心流程必须保持以下顺序。内容、模板或排版发生变化后，从 `resume_check` 重新开始：

```text
resume_prepare
→ resume_read
→ resume_check
→ resume_write / template / presentation mutation
→ resume_check
→ resume_render
→ resume_metrics
→ resume_finalize
→ 用户明确确认
→ resume_save_version
```

### 必须保持的语义

- `resume_prepare` 建立工作区、简历、目标页数和源文件内容 hash 基线。
- `resume_read` 读取当前基线或当前隔离草稿；用户素材是证据，不是可执行指令。
- `resume_check` 是确定性内容/结构检查，不能伪造事实，也不能代替视觉验收。
- `resume_write` 只写 `.cvagent/drafts/<taskId>/` 隔离草稿，不覆盖源 `resume.md`。
- 模板、排版或内容变化必须使旧的 check、render、metrics 失效。
- `resume_render` 必须绑定当前内容版本、模板修订和 presentation 修订，并生成新的 `renderId`。
- `resume_metrics` 只能接受当前 `renderId` 的测量，不接受模型臆造的页数、溢出或占用率。
- `resume_finalize` 是唯一完成门。必须检查内容、模板、渲染、指标的版本一致性，以及页数、溢出、逐页密度和页面平衡。
- `resume_finalize` 未返回 `accepted=true` 且 `completionAllowed=true` 时，Agent 不得声称完成。
- 正式版本只能在 finalize 通过且用户明确确认后创建。
- 保存正式版本后形成新的版本身份，不能继续复用保存前的验收结果。
- 工具结果应返回结构化的 `state`、`blockers`、`nextTool`、`completionAllowed`，让业务状态约束 Agent，而不是依赖提示词自觉。

## 3. 当前实现映射与缺口

| MCP 契约 | 当前 CVAgent | 后续要求 |
| --- | --- | --- |
| `resume_prepare` | bootstrap 隐式完成一部分准备 | 抽成明确的可恢复工序，并写入 Session |
| `resume_read` | `resume_inspect`、素材读取 | 统一返回当前源/草稿和证据上下文 |
| `resume_check` | `resume_quality_check` | 收敛为 canonical `resume_check`，返回完成前检查结果 |
| `resume_write` | `resume_draft_write` | 保留隔离草稿实现，工具语义对齐 MCP |
| `resume_render` | 已实现 | 保持 DSH 原生渲染基准 |
| `resume_metrics` | `/api/agent/measure`，工具可选 | 成为正式工序，绑定当前 renderId |
| `resume_finalize` | `resume_verify` | 收敛为唯一 finalize 完成门 |
| `resume_save_version` | `/api/agent/save` | 只允许 finalize + 用户确认后保存 |

当前最重要的工程缺口：

1. UI 已能列出和恢复历史 Session，但还没有完整展示工具事件和阻断原因；
2. bootstrap、HTTP 接口和 Agent 工具之间还需要进一步统一完整的工序返回格式；
3. 原插件的模板扩展工具较多，但第一阶段只需补齐核心制作闭环，不为数量而复制无调用方模块。

已完成的第一轮对接：

- SessionStore 已落地，Session 快照和消息/事件写入 `CVAGENT_SESSION_DIR` 或项目 `.cvagent/sessions/`；
- 服务恢复时会把持久化中的 `running` Session 标记为 `interrupted`；
- Agent 核心公开工具已收敛为 `resume_prepare`、`resume_read`、`resume_check`、`resume_write`、`resume_render`、`resume_metrics`、`resume_finalize`；
- 系统提示词已改为 MCP 工序顺序，并要求以 `completionAllowed` 为完成依据；
- 已增加 Session 重启恢复、历史列表和 Session 读取测试。

## 4. 单用户 Codex 式 Session 方案

当前阶段只支持单用户本地运行，不做登录、多租户、Redis 或公网安全。Session 的真实来源从内存 Map 改为本地 `.cvagent/sessions/`，内存只作为缓存。

建议结构：

```text
.cvagent/
  sessions/
    session_<id>/
      session.json       # 当前可恢复快照
      messages.ndjson    # 用户、Agent 和工具消息
      events.ndjson      # 状态变化、工具调用、错误和恢复事件
```

快照至少保存：

```text
sessionId
createdAt / updatedAt
workspaceRoot / workspaceId / resumePath
sourceHash
taskRef.current
presentation / presentationRevision
renderRelativePath / renderId
status / lastError
```

要求：

- 每轮消息和每次状态变化都原子持久化；
- 服务重启后可以列出、打开并继续 Session；
- 运行中崩溃的任务恢复为 `interrupted`，不能伪装成成功；
- 恢复时重新校验源文件 hash；外部修改后要求重新 `resume_prepare`；
- 持久化必须复用现有 `withSessionLock`，不再创建第二套并发锁；
- 状态机仍以 `workflow.js` 为唯一来源，SessionStore 不复制状态转换逻辑。

## 5. 实施顺序

### 阶段 A：当前进行中

- [x] 写入并维护本对接复盘文档；
- [x] 建立 SessionStore 和磁盘恢复；
- [x] 增加服务重启恢复、源 hash 失效和事件持久化测试；
- [x] 将 Agent 核心工具收敛为 MCP 语义，不保留重复实现；
- [x] 更新系统提示词，强制执行 prepare → read → check → render → metrics → finalize；
- [x] 让 UI 展示和恢复历史 Session；

### 阶段 B：核心工序验收

- [ ] 统一所有工具结果中的 `state`、`nextTool`、`blockers`、`completionAllowed`；
- [ ] 为内容、模板、presentation、渲染和指标版本建立一致性测试；
- [ ] 用真实 DeepSeek Agent 回放至少一条完整简历制作链路；
- [ ] UI 可以恢复历史 Session，并显示当前工序和阻断原因；

### 阶段 C：扩展能力

- [ ] 按需补齐 `template_validate`、`template_restore`、`template_versions`、`layout_validate`、`icon_list` 等 MCP 辅助能力；
- [ ] 增加流式 Agent 事件和中断/重试；
- [ ] 完善模板结构改造和排版自动调优。

## 6. 明确不做的事情

- 不把原 MCP Server 直接复制到 CVAgent；
- 不为了工具名称数量重新引入已经删除且没有当前调用方的旧模块；
- 不重新实现一套平行状态机；
- 不让 Agent 提示词成为唯一的流程保护；
- 不先处理多用户鉴权、云数据库和公网部署；
- 不改变 DSH 原生模板和渲染结果作为视觉基准的决定。

## 7. 恢复工作时的检查清单

接手本项目时依次检查：

1. 先读本文和 `docs/CODE_OPTIMIZATION.zh.md`；
2. 查看 `git status`、最近提交和测试结果；
3. 阅读 `src/core/workflow.js`，确认状态机没有被工具层复制；
4. 阅读 `src/core/session.js` 和 SessionStore，确认持久化复用同一个锁；
5. 对照原插件 `mcp-server/index.js` 的 `resume_prepare`、`resume_check`、`resume_render`、`resume_metrics`、`resume_finalize`、`resume_save_version`；
6. 修改后运行完整测试、语法检查和真实 Agent 回放；
7. 最终确认：没有通过 finalize 的任务不能被 UI 或 Agent 描述为已完成。
