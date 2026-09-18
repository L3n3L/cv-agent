import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auditTemplateCss, generateTemplateCandidate, listTemplateFamilies, validateDesignBrief } from '../src/migrated/resume-engine/template-generation.js'
import { assembleResumeSections, markdownToHtml, rewriteImageSources } from '../src/migrated/resume-engine/renderer.js'
import { autoTunePresentation } from '../src/agent/presentation-autotune.js'
import { TASK_STATES } from '../src/core/workflow.js'
import { copyTemplate, listTemplateVersions, restoreTemplateVersion, saveTemplate } from '../src/migrated/resume-engine/template-presets.js'
import { createServer } from '../src/server.js'

async function closeServer(server) {
  await server.flushLogs?.()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

test('controlled template generation produces a renderable candidate without touching a workspace', () => {
  const result = generateTemplateCandidate({
    id: 'product-evidence',
    name: '产品证据',
    audience: 'product',
    family: 'business-timeline',
    density: 'standard',
    tone: 'clear',
    moduleOrder: ['profile', 'summary', 'projects', 'experience', 'education', 'skills'],
  })
  assert.equal(result.valid, true)
  assert.equal(result.template.id, 'product-evidence')
  assert.equal(result.template.renderer, 'composition')
  assert.equal(result.template.metadata.generatedBy, 'cvagent-template-design')
  assert.equal(result.template.composition.page, 'stack')
  assert.equal(result.template.composition.pageSpec.page.size, 'A4')
  assert.equal(result.layoutSpec.ir.type, 'stack')
  assert.equal(result.layoutSpec.blocks.find((block) => block.id === 'projects').options.preset, 'project-list')
  assert.equal(result.nextSteps[0], '候选仍在内存中，不会写入工作区')
})

test('canonical DSH theme system exposes all families and family-specific layout semantics', () => {
  const families = listTemplateFamilies()
  assert.equal(families.length, 17)
  assert.ok(families.every((family) => family.supportedBlocks.length > 0))
  const result = generateTemplateCandidate({ name: '肖像候选', family: 'avatar-profile', moduleOrder: ['profile', 'skills', 'experience'] })
  assert.equal(result.valid, true)
  assert.equal(result.template.composition.pageSpec.header.variant, 'centered')
  assert.equal(result.layoutSpec.blocks.find((block) => block.id === 'skills').type, 'skill-tags')

  const portfolio = generateTemplateCandidate({ name: '作品集候选', family: 'portfolio-grid', moduleOrder: ['education', 'experience', 'projects', 'skills', 'awards'] })
  assert.deepEqual(
    Object.fromEntries(['page', 'header', 'entry', 'meta', 'skills'].map((key) => [key, portfolio.template.composition[key]])),
    { page: 'grid', header: 'standard', entry: 'stack', meta: 'split', skills: 'chips' },
  )

  const timeline = generateTemplateCandidate({ name: '商务候选', family: 'business-timeline', moduleOrder: ['education', 'experience', 'projects', 'skills', 'awards'] })
  assert.deepEqual(
    Object.fromEntries(['page', 'header', 'entry', 'meta', 'skills'].map((key) => [key, timeline.template.composition[key]])),
    { page: 'stack', header: 'hero', entry: 'timeline', meta: 'split', skills: 'list' },
  )
})

test('every canonical theme preserves the full Markdown section set in the renderer contract', () => {
  const source = markdownToHtml(`# 候选人\n北京\n\n## 教育经历\n\n### 测试大学 · 计算机科学与技术\n\n## 实习经历\n\n### 测试公司 · 产品实习生\n\n- 负责需求分析与交付协作。\n\n## 项目经历\n\n### 测试项目\n\n- 完成项目方案与验证。\n\n## 技能\n\n- JavaScript\n\n## 获奖\n\n- 测试奖项`)
  const expectedModules = ['education', 'experience', 'projects', 'skills', 'awards']
  const results = listTemplateFamilies().map((family) => {
    const candidate = generateTemplateCandidate({
      id: `matrix-${family.id}`,
      name: `矩阵 ${family.name}`,
      family: family.id,
      moduleOrder: ['education', 'experience', 'projects', 'skills', 'awards'],
    })
    assert.equal(candidate.valid, true, `${family.id} should generate a valid candidate`)
    const html = assembleResumeSections(source, candidate.layoutSpec, candidate.template.layout, candidate.template, { iconState: { next: 0 } })
    for (const module of expectedModules) assert.match(html, new RegExp(`data-module-id="${module}"`), `${family.id} lost ${module}`)
    assert.match(html, /测试公司/, `${family.id} lost Markdown company content`)
    assert.match(html, /产品实习生/, `${family.id} lost Markdown role content`)
    assert.match(html, /完成项目方案与验证/, `${family.id} lost Markdown bullet content`)
    return { family: family.id, modules: expectedModules.length, htmlBytes: Buffer.byteLength(html, 'utf8') }
  })
  assert.equal(results.length, 17)
  assert.ok(results.every((result) => result.htmlBytes > 600))
})

test('template generation rejects unknown theme families instead of silently falling back', () => {
  const result = generateTemplateCandidate({ name: 'Unknown family', family: 'not-a-real-family' })
  assert.equal(result.valid, false)
  assert.match(result.errors.join(' '), /family is unsupported/)
})

test('bounded template autotune applies DSH-compatible presentation steps only after current metrics', () => {
  const task = {
    state: TASK_STATES.MEASURED,
    context: { renderId: 'render-current' },
    measurements: { renderId: 'render-current', pageCount: 1, occupancy: [0.42], overflow: false },
    acceptance: { minOccupancy: 0.9, maxSpread: 1 },
  }
  const result = autoTunePresentation({
    task,
    template: { id: 'campus-standard', typography: { fontSize: 14, lineHeight: 1.55 }, spacing: { sectionGap: 20, pageMargin: 48 } },
    presentation: null,
    resumePath: 'resume.md',
    round: 3,
  })
  assert.equal(result.changed, true)
  assert.deepEqual(result.patch.layout, { fontSize: 14.5, sectionGap: 22, pageMargin: 50 })
  assert.equal(result.measurement.renderId, 'render-current')
})

test('Design Brief only accepts supported values and rejects unsafe CSS', () => {
  const result = validateDesignBrief({
    name: 'Unsafe',
    templateCss: '@import url(https://example.com/theme.css);',
    moduleOrder: ['profile', 'unknown-module'],
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('disallowed')))
  assert.deepEqual(result.value.moduleOrder, ['profile'])
})

test('template CSS audit requires CVAgent renderer hooks before browser review', () => {
  const completeCss = `
    .resume-document[data-template-id="quality-check"] .header-block { color: #111827; }
    .resume-document[data-template-id="quality-check"] .cvagent-resume-section { margin-top: 12px; }
    .resume-document[data-template-id="quality-check"] .cvagent-entry-title { font-weight: 700; }
    .resume-document[data-template-id="quality-check"] .cvagent-entry-meta { color: #64748b; }
    .resume-document[data-template-id="quality-check"] .cvagent-entry-bullets { padding-left: 16px; }
    @media print { .resume-document[data-template-id="quality-check"] { color: #111827; } }
  `
  const audit = auditTemplateCss(completeCss, 'quality-check')
  assert.equal(audit.status, 'ready-for-browser-review')
  assert.deepEqual(audit.missing, [])
  assert.ok(listTemplateFamilies().some((family) => family.id === 'split-focus'))
})

test('inline Markdown images use the CVAgent asset adapter while preserving the DSH rewrite contract', () => {
  const html = rewriteImageSources(markdownToHtml('![头像](assets/avatar.png)'), { root: 'C:\\resume-workspace' })
  assert.match(html, /src="\/api\/asset\?workspaceRoot=C%3A%5Cresume-workspace&amp;path=assets%2Favatar\.png"/)
  const rejected = rewriteImageSources(markdownToHtml('![不安全](../secret.png)'), { root: 'C:\\resume-workspace' })
  assert.match(rejected, /src=""/)
})

test('custom templates write immutable workspace revisions and restore as a new revision', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-template-revisions-'))
  try {
    const created = await copyTemplate(root, 'campus-standard', 'revision-proof', 'Revision Proof')
    assert.equal(created.revision, 1)
    assert.equal(created.versionPath, '.cvagent/templates/revision-proof/revisions/0001/template.json')
    assert.equal(await fs.stat(path.join(root, '.cvagent', 'templates', 'revision-proof', 'revisions', '0001', 'template.css')).then(() => true), true)

    const updated = await saveTemplate(root, { ...created.template, description: 'changed on revision two' }, { replaceExisting: true })
    assert.equal(updated.revision, 2)
    const versions = await listTemplateVersions(root, 'revision-proof')
    assert.deepEqual(versions.map((item) => item.id), ['0002', '0001'])
    assert.equal(versions.every((item) => item.source === 'revision'), true)

    const restored = await restoreTemplateVersion(root, 'revision-proof', '0001')
    assert.equal(restored.revision, 3)
    assert.equal(restored.template.description, created.template.description)
    assert.equal((await listTemplateVersions(root, 'revision-proof')).length, 3)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('template lifecycle HTTP API keeps generation transient and gates writes on confirmation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-template-api-'))
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const base = `http://127.0.0.1:${address.port}`
    const generatedResponse = await fetch(`${base}/api/templates/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief: { id: 'api-proof', name: 'API Proof', audience: 'product' } }) })
    const generated = await generatedResponse.json()
    assert.equal(generatedResponse.status, 200)
    assert.equal(generated.persisted, false)
    await assert.rejects(() => fs.stat(path.join(root, 'templates', 'api-proof.json')), { code: 'ENOENT' })

    const denied = await fetch(`${base}/api/templates/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root, templateJson: generated.candidate.template }) })
    assert.equal(denied.status, 400)
    const savedResponse = await fetch(`${base}/api/templates/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root, templateJson: generated.candidate.template, confirmedByUser: true }) })
    const saved = await savedResponse.json()
    assert.equal(savedResponse.status, 200)
    assert.equal(saved.result.revision, 1)

    const versionsResponse = await fetch(`${base}/api/templates/versions?workspaceRoot=${encodeURIComponent(root)}&templateId=api-proof`)
    const versions = await versionsResponse.json()
    assert.equal(versionsResponse.status, 200)
    assert.deepEqual(versions.versions.map((item) => item.id), ['0001'])
    const restoredResponse = await fetch(`${base}/api/templates/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root, templateId: 'api-proof', versionId: '0001', confirmedByUser: true }) })
    const restored = await restoredResponse.json()
    assert.equal(restoredResponse.status, 200)
    assert.equal(restored.result.revision, 2)
  } finally {
    await closeServer(server)
    await fs.rm(root, { recursive: true, force: true })
  }
})
