# CVAgent 模板生命周期：设计

## 1. DSH 借鉴与适配

DSH 的 `lib/template-generation.js` 将 Agent 产生的 `DesignBrief` 映射为受约束的 `TemplateSpec`；`template-presets.js` 负责内置/工作区模板、复制、保存、历史与恢复；`index.js` 将其暴露为生成、保存、复制、版本和恢复工具。

CVAgent 保留这套“模型做设计意图、确定性代码做结构化落盘和验收”的边界，但不迁入 DSH 宿主依赖、全局工作区状态或插件 UI。

## 2. 生命周期

```text
用户意图
  → template_generate（DesignBrief，内存候选）
  → template_validate（结构/CSS）
  → template_save 或 template_copy（工作区模板 revision）
  → template_select
  → resume_render → resume_metrics → resume_finalize
  → 用户确认后保存正式简历版本
```

`presentation_update` 不进入模板修订链：它只改变当前会话/简历的呈现覆盖；只有用户选择“保存为我的模板”才将其显式物化为 TemplateSpec 修订。

## 3. 存储设计

保留现有平铺路径作为当前工作区模板入口，新增不可变修订存档：

```text
<workspace>/
  templates/
    product-minimal.json       # 当前 TemplateSpec
    product-minimal.css        # 当前独立 CSS
  .cvagent/
    templates/
      product-minimal/
        revisions/
          0001/template.json
          0001/template.css
          0002/template.json
          0002/template.css
```

`metadata.revision` 是当前修订号；`metadata.sourceTemplateId` 记录派生来源；`metadata.lineageId` 保持整个派生族谱稳定。现有 `.cvagent/legacy/template-history` 仅作为迁移读取来源，不再写入。

正式简历版本新增 `templateSnapshot`：对自定义模板记录 `templateId + revision + snapshot path + fingerprint`。官方模板记录包内 ID、revision 与 CSS fingerprint；后续官方模板更新必须递增 revision。

## 4. 模块与 API

- `migrated/resume-engine/template-generation.js`：从 DSH 适配的 DesignBrief 归一化、候选生成和 CSS 审计，不访问磁盘。
- `migrated/resume-engine/template-presets.js`：新增 revision snapshot 写入、列出与恢复；保持旧模板读取兼容。
- `migrated/resume-engine/catalog.js`：暴露生成、保存、版本、恢复的 CVAgent 领域接口。
- `agent/schemas.js` 与 `agent/resume-tools.js`：增加 `template_generate`、`template_save`、`template_versions`、`template_restore`；保存、选择、恢复均使 render/metrics 失效。
- `server.js`：为 UI 提供模板保存、版本列出和恢复 API；不暴露绝对工作区路径。
- 模板库 UI：第一阶段先显示来源、修订、派生关系和恢复入口；生成由 Agent 会话驱动，不另建重复的自由表单。

## 5. 验证策略

- 单元测试：候选生成、Schema 拒绝、不可变内置模板、revision 单调递增、恢复形成新 revision、presentation 不生成模板修订。
- API/Agent 集成：生成候选不落盘；明确保存后可列出、选择、渲染、测量；恢复后旧 renderId 不可用于 finalize。
- 浏览器：模板库显示当前模板的来源/修订，Agent 生成后工具时间线显示“候选→保存→渲染→测量”。使用饱满的一页与两页样本截图验收。
