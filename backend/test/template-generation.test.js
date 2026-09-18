import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auditTemplateCss, generateTemplateCandidate, listTemplateFamilies, validateDesignBrief } from '../src/migrated/resume-engine/template-generation.js'
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
  assert.equal(result.nextSteps[0], '候选仍在内存中，不会写入工作区')
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
