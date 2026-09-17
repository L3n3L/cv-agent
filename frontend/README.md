# CVAgent UI Demo v2

CVAgent 的正式前端；页面结构、排版和交互以本目录为唯一视觉基线，业务数据通过 `/api/*` 代理连接同仓库 `backend`。

启动：`node server.mjs`

地址：`http://127.0.0.1:3191/`

默认将 `/api/*` 转发到 `http://127.0.0.1:3180`。如后端地址不同，可设置 `CVAGENT_API_ORIGIN`，例如：

```powershell
$env:CVAGENT_API_ORIGIN = 'http://127.0.0.1:3180'
node server.mjs
```

开发期保持前后端分端口，生产期可由反向代理统一成同源地址。正式预览必须使用 backend 的真实预览接口，不再依赖插件目录或前端伪造模板。
