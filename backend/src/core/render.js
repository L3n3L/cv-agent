import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureWorkspace } from './workspace.js'
import { assembleResumeSections, buildPreviewDocument, markdownToHtml, rewriteImageSources } from '../migrated/resume-engine/renderer.js'
import { loadWorkspaceTemplate } from '../migrated/resume-engine/catalog.js'
import { assertTemplateSpec } from '../migrated/resume-engine/template-schema.js'
import { applyPresentationOverride } from '../migrated/resume-engine/presentation.js'

const ENGINE_ROOT = fileURLToPath(new URL('../migrated/resume-engine/', import.meta.url))
const DEFAULT_CSS_PATH = path.join(ENGINE_ROOT, 'templates', 'default.css')

function generatedId(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized || !/^[A-Za-z0-9_.@-]+$/.test(normalized)) throw Object.assign(new Error(`${label} is invalid`), { code: 'RENDER_INPUT_INVALID' })
  return normalized
}

async function writeArtifact(root, relativePath, content) {
  const workspace = await ensureWorkspace(root)
  const filePath = path.resolve(workspace.root, ...relativePath.split('/'))
  const relative = path.relative(workspace.root, filePath)
  if (!relative.startsWith('.cvagent' + path.sep)) throw Object.assign(new Error('render output must stay in .cvagent'), { code: 'RENDER_PATH_INVALID' })
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporaryPath, filePath)
  } finally { await fs.rm(temporaryPath, { force: true }).catch(() => {}) }
  return filePath
}

function templateFileId(templateId) {
  const value = String(templateId || 'campus-standard').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw Object.assign(new Error('templateId is invalid'), { code: 'TEMPLATE_INVALID' })
  return value
}

async function resolveTemplate(options) {
  if (options.templateSpec) {
    const raw = assertTemplateSpec(options.templateSpec)
    return { spec: applyPresentationOverride(raw, options.presentation, raw.id, options.resumePath), css: String(options.templateCss || options.templateSpec.templateCss || '') }
  }
  const id = templateFileId(options.templateId || 'campus-standard')
  let loaded
  try {
    loaded = await loadWorkspaceTemplate(options.workspaceRoot, id)
  } catch (error) {
    if (error?.code === 'ENOENT') throw Object.assign(new Error(`template is not available in CVAgent: ${id}`), { code: 'TEMPLATE_NOT_FOUND' })
    throw error
  }
  const raw = assertTemplateSpec(loaded)
  return { spec: applyPresentationOverride(raw, options.presentation, raw.id, options.resumePath), css: String(options.templateCss || loaded?.templateCss || '') }
}

/** Render a draft through the migrated, standalone resume engine. */
export async function renderResumeDraft(options = {}) {
  const taskId = generatedId(options.taskId, 'taskId')
  const renderId = generatedId(options.renderId || `render_${crypto.randomUUID()}`, 'renderId')
  const contentVersion = generatedId(options.contentVersion, 'contentVersion')
  const resolvedTemplate = await resolveTemplate(options)
  const templateRevision = generatedId(options.templateRevision || `${resolvedTemplate.spec.id}@${resolvedTemplate.spec.metadata?.revision || 1}`, 'templateRevision')
  const content = String(options.content || '')
  const sourceHtml = rewriteImageSources(markdownToHtml(content), { root: options.workspaceRoot })
  const layoutSpec = resolvedTemplate.spec.layoutSpec || null
  const bodyHtml = assembleResumeSections(sourceHtml, layoutSpec, resolvedTemplate.spec.layout, resolvedTemplate.spec, { iconState: { next: 0 } })
  const baseCss = await fs.readFile(DEFAULT_CSS_PATH, 'utf8')
  const title = /^\s*#\s+(.+)$/m.exec(content)?.[1]?.trim() || 'CVAgent Resume'
  const relativePath = `.cvagent/renders/${taskId}/${renderId}/preview.html`
  const renderedHtml = buildPreviewDocument({
    title,
    bodyHtml,
    cssText: baseCss,
    templateCssText: resolvedTemplate.css,
    sourcePath: options.resumePath || 'resume.md',
    templatePath: `builtin:${resolvedTemplate.spec.id}`,
    previewPath: relativePath,
    previewRoot: options.workspaceRoot,
    renderId,
    contentHash: crypto.createHash('sha256').update(`${contentVersion}:${templateRevision}:${resolvedTemplate.spec.id}:${resolvedTemplate.css}:${JSON.stringify(layoutSpec || {})}`).digest('hex').slice(0, 16),
    templateSpec: resolvedTemplate.spec,
    layoutSpec,
    initialIconTuning: options.initialIconTuning || options.presentation?.iconTuning || {},
  })
  const html = renderedHtml.replace('<main class="resume-document', '<main data-product="CVAgent" class="resume-document')
  const absolutePath = await writeArtifact(options.workspaceRoot, relativePath, html)
  return { renderId, templateId: resolvedTemplate.spec.id, templateRevision, contentVersion, relativePath, absolutePath, bytes: Buffer.byteLength(html, 'utf8') }
}

export { DEFAULT_CSS_PATH }
