# Implementation Plan

- [x] 1. 固化 DSH → DeepAgent 的需求、边界和验收标准
  - 建立 EARS 验收标准，明确 Skill、工具、Middleware、状态门禁的职责。
  - _Requirement: 1, 2, 3, 4, 5, 6, 7_

- [x] 2. 建立 DSH 对齐的原生 `resume-production` Skill
  - 使用 `SKILL.md` frontmatter。
  - 迁移 DSH 的任务识别、证据账本、内容优先级、A4 闭环、模板和保存授权规则。
  - 保留 DSH 来源版本，便于后续复盘和升级。
  - _Requirement: 1, 5_

- [x] 3. 接入 DeepAgent 原生 Skill loading
  - 生产模式传入 `skills: ['/skills/']`。
  - 使用 StateBackend 输入提供 Skill 文件，避免宿主仓库访问扩大。
  - 非生产模式不加载生产 Skill。
  - _Requirement: 1, 2, 3, 7_

- [x] 4. 收缩总提示词职责
  - 删除与 Skill 重复的 DSH 长流程。
  - 保留身份、语言、证据安全、完成声明边界和模式入口。
  - 兼容保留 `resume_production_guide`，避免破坏旧工具协议。
  - _Requirement: 1, 6_

- [x] 5. 补充 Skill/Agent 配置自动化测试
  - 验证 Skill 文件和元数据。
  - 验证不同执行模式的 Skill source 和输入 files 隔离。
  - _Requirement: 1, 2, 3, 7_

- [ ] 6. 真实浏览器闭环验收
  - 新会话普通问候、只读检查、生产任务分别跑一次。
  - 确认工具事件、Skill 读取、真实测量、最终验收和截图顺序。
  - _Requirement: 4, 6_

- [ ] 7. 后续迁移 durable continuation
  - 将当前测量后的业务续跑从定时器适配迁移到 LangGraph `interrupt` + checkpointer 或持久化恢复队列。
  - 本轮不扩大范围，先保留现有 `renderId` 和预算保护。
  - _Requirement: 4, 6_

## 本轮文档落地追踪（2026-09-19）

- [x] 8. 建立唯一的 `workflow-coordinator`
  - 从任务状态和草稿可用性计算唯一 `nextTool` / `nextAction`。
  - 对 `resume_render`、`resume_metrics`、`resume_save_version` 提供统一前置条件判断。

- [x] 9. 接入 DeepAgent Workflow Guard Middleware
  - 在模型调用前注入紧凑 Harness 状态摘要。
  - 在工具边界阻止过期测量和非法保存，并对有草稿的阻塞态渲染自动恢复。
  - 自动恢复写入结构化日志和工作流事件。

- [x] 10. 增加阻塞态恢复和工具门禁回归测试
  - 覆盖缺少草稿、阻塞态直接渲染、非法测量和状态摘要。
  - 后端全量测试通过后再进入浏览器验收。

- [~] 11. 真实浏览器闭环验收
  - 已完成：新会话问候、多轮“继续修订”、工具过程折叠、流式/最终回复去重、草稿恢复后的预览失效与控制台检查。
  - 待补：以固定 holdout 数据跑完整生产任务、真实浏览器测量回传和正式版本保存。

- [ ] 12. train/holdout Harness 评测

- [ ] 13. durable continuation
