# CVAgent 代码质量与运行时收敛对接复盘

日期：2026-09-19
基线：`3069fca feat: adopt native DeepAgent resume skill`

## 1. 调研结论

本轮按 Codex 官方工程实践整理规则，而不是继续依赖个人记忆：

- [Codex 最佳实践：AGENTS.md、测试与质量闭环](https://developers.openai.com/zh-Hans/guides/best-practices) 建议把目录结构、命令、测试、约束和完成标准写进可复用的 `AGENTS.md`，并在改动后执行测试、lint/typecheck、行为确认和 diff 审查。
- [Codex 自定义代码审查规则](https://developers.openai.com/zh-Hans/blog/custom-code-review-rules-for-codex) 建议规则只描述非显然的不变量，机械问题交给测试或 CI，并用真实违规案例和安全反例验证规则。

因此本仓库采用四层质量闭环：唯一运行时边界、可执行契约测试、构建/类型检查、真实浏览器验收。文档不再承担“看起来规范”的作用，而是记录能被代码和测试验证的边界。

## 2. 发现的问题

### 2.1 多套入口造成回退错觉

- `backend/public/` 是历史静态页面副本，和现在的 React 工作台并存。
- `frontend/index.html` 是另一套根路径入口，`frontend/server.mjs` 同时给旧根页面和 React 页面分配静态资源。
- 契约测试仍以旧 HTML 和旧 `cj-*` 选择器为基线，导致“测试通过”不等于用户打开的页面就是 React 页面。

### 2.2 React 外壳仍依赖散落的共享运行时

Agent、SSE、会话和工作台交互原本由 `frontend/` 根目录的四个脚本承担，React 入口再动态注入它们。这些脚本不是死代码，但目录位置和 `legacy` 命名让它们看起来像可删除副本，也容易被新实现重复覆盖。

### 2.3 流式结果的时序仍有真实风险

后端工作流经 `invoke` 后启动 SSE，前端再建立订阅；事件 broker 只向当时在线的连接广播，且 `assistant_delta` 不持久化。这样会出现：工具事件或回答增量在订阅建立前丢失，刷新后只剩最终回答。这个问题不是靠换一个 UI 文案解决的，下一阶段必须补 replay/握手和恢复测试。

## 3. 本轮已执行的收敛

- 停止开发服务 3180/3191，先清理运行路径再改代码。
- 删除 `backend/public/*` 和 `frontend/index.html`，移除后端页面静态服务分支。
- `frontend/server.mjs` 只服务 `frontend/react/dist`；`/` 和 `/react` 统一 302 到 `/react/`，其他非 API 路径返回 404。
- 将四个当前仍被使用的运行时模块迁入 `frontend/react/src/runtime/`：API client、client events、Agent chat、workbench runtime。
- 将共享样式迁入 `frontend/react/src/styles.css`，把 `legacy-bridge` 改名为 `react-pane-bridge`，把卸载接口改成 `unmountReactPanes`。
- React 在 shell 挂载后按明确顺序加载运行时模块，消除根目录脚本注入和旧入口双轨。
- 新增根目录 `AGENTS.md`，并重写 UI 契约测试，使其验证唯一入口、旧目录不存在、运行时迁移边界和 `/react/` 路由。

## 4. 有意保留的边界

本轮没有把 8 万行工作台 DOM 逻辑强行重写成 React 组件，因为那会把“清理入口”和“重写业务状态”混成一次高风险变更。它已经迁入 React 运行时目录，调用路径唯一；后续按模块迁移 Agent/SSE、会话和模板工作流，完成一个模块就删除对应运行时代码和 bridge，不再保留旧根目录副本。

## 5. 下一阶段任务

1. 给 SSE broker 增加 run 级 replay 或订阅握手屏障，覆盖订阅竞态、重连、刷新、完成和错误终态。
2. 把 Agent chat/session 状态迁成 React 状态，工具时间线只由真实事件驱动，不能由前端生成“已执行 N 项工具”之类的伪状态。
3. 迁移工作台路由、模板库和版本管理，逐步删除 `runtime/workbench-runtime.js` 与 `react-pane-bridge.tsx` 中已无调用的部分。
4. 每个阶段都执行后端测试、React build 和真实浏览器闭环；完成前不把旧入口重新加回来。

## 6. 验收记录

- 服务已在清理前停止。
- 已完成旧入口和静态副本删除，待测试/build/浏览器验证后提交。
- `logs/` 为本地运行日志，保持忽略，不进入提交。
