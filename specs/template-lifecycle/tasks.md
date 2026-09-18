# Implementation Plan

- [x] 1. 形成 DSH 对接复盘、需求、设计与任务基线
  - 明确单工作区模板库、候选生成与版本规则。
  - _Requirement: 1-7_

- [x] 2. 适配受控 Template Generation 内核
  - 从 DSH 迁移并去宿主化 DesignBrief、候选生成和 CSS 质量审计。
  - 为 CVAgent 增加覆盖候选生成的单元测试。
  - _Requirement: 1_

- [x] 3. 实现自定义模板不可变修订存储
  - 为创建、更新与恢复写入 revision snapshot；兼容既有平铺模板。
  - 为正式简历版本补充可复现模板快照身份。
  - _Requirement: 2, 4, 7_

- [x] 4. 接入 MCP 对齐 Agent 工具与 HTTP API
  - 暴露 generate/save/versions/restore，保持当前 render/metrics 失效约束。
  - _Requirement: 1-5_

- [ ] 5. 在模板库暴露来源、修订与恢复
  - 不改变现有工作台布局；生成入口保留在 Agent 会话。
  - _Requirement: 2, 4, 6_

- [ ] 6. 完成端到端与截图验收
  - 用一页、两页饱满样本验证生成、保存、恢复和版本可复现性。
  - _Requirement: 1-7_
