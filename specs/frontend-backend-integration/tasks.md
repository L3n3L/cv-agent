# Implementation Plan

- [x] 1. 记录当前六条链路的差距和验收标准
  - 建立 requirements/design/tasks 和对接复盘文档
  - Requirement: R1-R6

- [x] 2. 建立前端 API client 与运行时状态
  - 统一 JSON 请求、错误码和 requestId
  - Requirement: R6

- [x] 3. 接通工作区导入和 session bootstrap
  - 目录文件转为后端允许的 import payload
  - 用 bootstrap 返回值填充编辑器和预览
  - Requirement: R1-R2

- [x] 4. 接通 Agent 对话
  - 替换本地延迟假响应
  - 处理进行中、成功、失败和 session 恢复
  - Requirement: R3

- [ ] 5. 接通 draft/render/measure/save
  - 已完成 draft、render 和 iframe 测量接线；正式版本 save UI 尚未开放
  - 编辑器写隔离草稿并重新渲染
  - iframe 测量当前 renderId
  - 只在 accepted 后开放正式保存
  - Requirement: R4-R5

- [ ] 6. 全链路验收与旧代码清理
  - 浏览器冒烟和失败态验证
  - 删除重复静态前端和未使用旧渲染函数
  - Requirement: R6
