# Presentation 与模板工作台：实施任务

- [x] 1. 形成 DSH 对接复盘、需求、设计与任务基线
  - 划分 presentation 与模板资产边界，确认已有领域接口。
  - _Requirement: 1-7_

- [x] 2. 实现手动微调 V2
  - React A4Pane 已提供 typed presentation draft、排版滑杆、实际 A4 图标控制、20 步撤销与默认恢复；未把视觉 Token 混进手动微调。
  - 滑杆只即时预览；“应用到当前草稿”才调用 presentation API、重渲染并要求重新测量，正式版本会在存在未应用草稿时被阻断。
  - _Requirement: 1-3_

- [x] 3. 补齐模板库元信息与历史入口
  - 统一卡片的来源、修订、派生关系和当前状态；实现历史读取与确认恢复。
  - _Requirement: 4-5_

- [x] 4. 补齐模板候选到保存的工作台流程
  - 提供受控 Design Brief、候选审阅、显式保存与刷新，不自动选择。
  - _Requirement: 6_

- [ ] 5. 添加回归测试与真实浏览器截图验收
  - 已覆盖 presentation 不产生模板修订、模板候选不落盘、恢复生成新修订；已做手动微调真实浏览器截图。
  - 仍需用一次性测试工作区完成 template copy/save/restore 的可写浏览器闭环，以及一页/两页样本矩阵。
  - _Requirement: 1-7_
