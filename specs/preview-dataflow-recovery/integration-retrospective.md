# 预览数据流对接复盘

## 1. 背景与目标

本次问题表现为：工作区已经存在，页面却显示“选择工作区后显示真实预览”；切换工作区、恢复会话或重新渲染后，A4 预览有时仍停留在旧空态。目标不是给空态换文案，而是让工作区、会话、草稿、渲染产物和预览挂载之间恢复单向、可解释的数据流。

本次改动只收敛前端状态与渲染边界，不改变后端 API 的语义，也不伪造预览。真实预览仍必须由有效的 `sessionId + renderId` 驱动。

## 2. 原数据流与根因

原链路同时使用 `liveState.sessionId` 和运行时私有的 `activeSessionId`。工作区引入、会话恢复、模板切换、草稿重新渲染会分别更新其中一部分，导致 URL 生成、模板缩略图和预览空态读取的不是同一份状态。

同时，旧运行时通过 DOM 直接查找 iframe 并在无 URL 时执行 `frame.replaceWith(empty)`。A4 iframe 实际由 React `A4Pane` 挂载，这会让 React 的拥有关系和运行时的 DOM 修改互相覆盖；后续状态更新即使拿到有效 `renderId`，React 仍可能没有机会把空态恢复成 iframe。

因此，“有工作区”与“有可展示的渲染产物”被错误合并成了一个判断：只要当前 renderId 为空，就误显示成“选择工作区”。renderId 为空可能只是草稿尚未渲染、模板变更后渲染失效或正在 bootstrap。

## 3. 新的状态边界

### 3.1 唯一事实来源

- 当前工作区：`liveState.workspace` / `liveState.workspaceId`
- 当前会话：`liveState.sessionId`
- 当前简历草稿：`liveState.sourceContent`、`liveState.draftContent`
- 当前真实渲染产物：`liveState.renderId`
- 当前 A4 预览 URL：只由 `liveState.sessionId + liveState.renderId` 计算

删除 `activeSessionId`，禁止再增加第二个 session 缓存。

### 3.2 显式预览状态

`currentPreviewState()` 只返回四种状态：

| 状态 | 条件 | 用户看到的含义 |
| --- | --- | --- |
| `no_workspace` | 没有工作区 | 需要先选择或导入工作区 |
| `loading` | 有工作区但 session 尚未完成加载 | 正在加载当前简历和预览 |
| `awaiting_render` | 有 session 但没有有效 renderId | 当前草稿尚未生成预览 |
| `ready` | sessionId 与 renderId 均存在 | 挂载真实 A4 iframe |

这四种状态必须由 React A4Pane 渲染，不能由外层运行时再替换 React 管理的节点。

## 4. 新的数据流

```text
工作区列表
  -> 选择/恢复 workspace
  -> bootstrap 或 restore session
  -> liveState.workspace + liveState.sessionId
  -> 读取 source/draft
  -> render 得到 renderId
  -> currentPreviewState()
  -> React A4Pane 决定空态或真实 iframe
  -> iframe 加载后发送 A4 metrics
  -> session measurement / workflow state 更新
```

具体约束：

1. bootstrap 开始时清空旧 session、draft、renderId、measurement，避免上一个工作区的预览残留。
2. restore 时只有后端状态允许展示渲染产物，才恢复 renderId；否则进入 `awaiting_render`，而不是伪造旧预览。
3. 草稿保存、版式调整、模板切换重新 render 后，必须先更新 renderId，再刷新 React A4Pane；不能只调用旧的 DOM 同步函数。
4. bootstrap 成功后必须先提交 `loading=false`，再挂载 React A4Pane；否则首屏会永久停在加载态。
5. `syncPreviewFrames()` 只负责兼容的完整预览和模板缩略图；遇到 `.direct-preview-stage` 时立即退出，不得替换 React 节点。
6. React A4Pane 的 `preview.status` 或 `preview.url` 变化后发布 `cvagent:a4-preview-changed`，运行时仅重新绑定尺寸与测量，不接管节点生命周期。
7. 测量只针对当前 canonical A4 iframe，不把模板缩略图、旧 iframe 或 full preview 页面当成当前产物。

## 5. 本次修改

- `frontend/react/src/runtime/workbench-runtime.js`
  - 删除第二份 `activeSessionId`。
  - 新增 `currentPreviewState()`。
  - bootstrap/失败清理时重置完整的工作区、草稿、render、measurement 状态。
  - 草稿保存和版式调整重新渲染后刷新 React A4Pane。
  - 禁止 DOM 运行时替换 React 直接预览节点。
- `frontend/react/src/features/preview/A4Pane.tsx`
  - 接收结构化 `PreviewState`。
  - 由 React 决定渲染真实 iframe 或状态空态。
  - 预览 URL 变化时通知运行时重新绑定测量。
- `backend/test/frontend-contract.test.js`
  - 增加单一 session 来源、显式预览状态、React 节点所有权和状态变更通知的契约检查。

## 6. 验收标准

### 功能

- 已有工作区但尚未渲染：显示“当前草稿尚未生成预览”，不能显示“选择工作区”。
- 正在 bootstrap：显示加载态，旧工作区的 A4 内容和测量值不残留。
- render 成功：A4Pane 自动切换到真实 iframe，并使用新的 renderId。
- 模板切换、保存草稿、版式调整后：预览不被旧空态覆盖，等待新的 A4 测量。
- 恢复历史会话：按后端状态恢复真实预览或进入明确的等待渲染态。

### 数据流不变量

- 任意预览 URL 都必须同时包含当前 `liveState.sessionId` 和 `liveState.renderId`。
- 不存在 `activeSessionId` 等第二份会话事实来源。
- React 管理的 `.direct-preview-stage` 内节点不能被运行时 `replaceWith`。
- `renderId` 失效时不展示旧 iframe，不把“没有 renderId”解释成“没有 workspace”。
- A4 测量必须绑定当前 session/render 组合。

## 7. 验证计划

1. `npm run typecheck --prefix frontend/react`
2. `npm run build --prefix frontend/react`
3. `node --test backend/test/frontend-contract.test.js`
4. 启动本地服务，浏览器验证：已有工作区恢复、工作区切换、草稿保存并重新渲染、模板切换、A4 iframe 加载和测量回传。
5. 截图验收四种状态：无工作区、加载中、等待渲染、真实预览；确认页面文案与状态一一对应。

## 8. 后续边界

本次先修复预览空态和 session/render 状态错位。聊天历史的时间线拼装、工具事件收纳和 SSE 重连仍需沿用同一原则：服务端事件序号是排序事实来源，前端只做幂等归并，不按网络到达顺序直接追加。该问题不应通过继续增加局部补丁掩盖。
