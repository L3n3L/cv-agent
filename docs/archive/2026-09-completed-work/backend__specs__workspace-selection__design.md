# 工作区选择技术设计

## 组件

- `workspace-registry`：维护受管工作区目录、manifest 和产品元数据；
- `POST /api/workspaces/import`：将浏览器选择的文件物化到受管目录；
- `resolveWorkspaceInput`：把 `workspaceId` 解析成现有 Agent 所需的内部 workspace；
- Web 工作区入口：使用 File System Access API，保留 `webkitdirectory` 作为兼容回退；
- 既有 Agent、渲染和会话层：继续使用内部绝对路径，但不再由新 UI 传入。

## 状态

```text
unselected → selected → imported → bootstrapped → editing → accepted → saved
```

`workspaceId` 是唯一的业务引用；`workspaceRoot` 仅在服务端内部和兼容旧调用中存在。

## 错误边界

- 目录未选择：不发送请求；
- 没有 Markdown 简历：返回 `WORKSPACE_RESUME_NOT_FOUND`；
- 文件太大、类型不支持、路径穿越：返回明确的 4xx 错误；
- 已导入工作区损坏：不自动修复或切换，提示用户重新选择。

