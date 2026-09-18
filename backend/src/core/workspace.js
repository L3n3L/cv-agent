import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const MANIFEST_DIR = '.cvagent'
const MANIFEST_NAME = 'workspace.json'
const DRAFTS_DIR = 'drafts'
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_ASSET_BYTES = 8 * 1024 * 1024
const MATERIAL_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml'])
const ASSET_MIME_TYPES = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
})

export const EMPTY_RESUME_TEMPLATE = `# 未命名候选人

## 求职意向

待补充

## 教育经历

待补充

## 工作 / 项目经历

待补充
`

function workspaceError(message, code = 'WORKSPACE_INVALID') {
  return Object.assign(new Error(message), { code })
}

function assertWorkspaceRoot(root) {
  const resolved = path.resolve(String(root || ''))
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) throw workspaceError('workspaceRoot must be a non-root absolute directory')
  return resolved
}

function assertRelativePath(relativePath) {
  const value = String(relativePath || '').trim()
  if (!value || path.isAbsolute(value)) throw workspaceError('path must be a non-empty relative path')
  const normalized = value.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..') || normalized.startsWith('./') || normalized === '.') throw workspaceError('path traversal is not allowed')
  if (segments[0] === MANIFEST_DIR) throw workspaceError('reserved workspace metadata path')
  return normalized
}

function resolveInside(root, relativePath) {
  const safePath = assertRelativePath(relativePath)
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(resolvedRoot, safePath)
  const relative = path.relative(resolvedRoot, resolvedPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw workspaceError('path must stay inside the workspace')
  return resolvedPath
}

async function assertRegularFile(filePath, maxBytes = MAX_TEXT_BYTES, tooLargeCode = 'WORKSPACE_FILE_TOO_LARGE') {
  const stat = await fs.lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') throw workspaceError('file does not exist', 'WORKSPACE_FILE_NOT_FOUND')
    throw error
  })
  if (!stat.isFile() || stat.isSymbolicLink()) throw workspaceError('only regular files are allowed', 'WORKSPACE_FILE_INVALID')
  if (stat.size > maxBytes) throw workspaceError('file is too large for a workspace read', tooLargeCode)
}

export async function writeAtomic(filePath, content) {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
  }
}

export async function ensureWorkspace(root, name = '') {
  const workspaceRoot = assertWorkspaceRoot(root)
  const stat = await fs.stat(workspaceRoot).catch(() => null)
  if (!stat?.isDirectory()) throw workspaceError('workspaceRoot must be an existing directory')
  const metadataRoot = path.join(workspaceRoot, MANIFEST_DIR)
  const manifestPath = path.join(metadataRoot, MANIFEST_NAME)
  let manifest = null
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw workspaceError('workspace manifest is invalid', 'WORKSPACE_MANIFEST_INVALID')
  }
  if (!manifest?.id) {
    manifest = { schemaVersion: 1, id: `ws_${crypto.randomUUID()}`, name: String(name || path.basename(workspaceRoot)), createdAt: new Date().toISOString() }
    await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return { root: workspaceRoot, manifestPath, ...manifest }
}

export async function readWorkspaceText(root, relativePath) {
  const workspace = await ensureWorkspace(root)
  const safePath = assertRelativePath(relativePath)
  const filePath = resolveInside(workspace.root, safePath)
  await assertRegularFile(filePath)
  return { ...workspace, relativePath: safePath, absolutePath: filePath, content: await fs.readFile(filePath, 'utf8') }
}

export async function createResumeSource(root, relativePath = 'resume.md', content = EMPTY_RESUME_TEMPLATE) {
  const workspace = await ensureWorkspace(root)
  const safePath = assertRelativePath(relativePath)
  if (!['.md', '.markdown'].includes(path.extname(safePath).toLowerCase())) throw workspaceError('resumePath must point to a Markdown file', 'WORKSPACE_RESUME_INVALID')
  const source = String(content || '')
  if (!source.trim()) throw workspaceError('resume source cannot be empty', 'WORKSPACE_RESUME_INVALID')
  const filePath = resolveInside(workspace.root, safePath)
  const existing = await fs.lstat(filePath).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))
  if (existing) throw workspaceError('resume source already exists', 'WORKSPACE_RESUME_EXISTS')
  await writeAtomic(filePath, source)
  return { ...workspace, relativePath: safePath, absolutePath: filePath, content: source }
}

export async function readWorkspaceAsset(root, relativePath) {
  const workspace = await ensureWorkspace(root)
  const safePath = assertRelativePath(relativePath)
  const contentType = ASSET_MIME_TYPES[path.extname(safePath).toLowerCase()]
  if (!contentType) throw workspaceError('asset type is not supported', 'ASSET_UNSUPPORTED')
  const filePath = resolveInside(workspace.root, safePath)
  await assertRegularFile(filePath, MAX_ASSET_BYTES, 'ASSET_TOO_LARGE')
  return { ...workspace, relativePath: safePath, absolutePath: filePath, contentType, content: await fs.readFile(filePath) }
}

export async function listWorkspaceMaterials(root, options = {}) {
  const workspace = await ensureWorkspace(root)
  const maxFiles = Math.max(1, Math.min(200, Number(options.maxFiles) || 100))
  const maxDepth = Math.max(0, Math.min(8, Number(options.maxDepth) || 4))
  const files = []
  async function visit(directory, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (files.length >= maxFiles || entry.name === MANIFEST_DIR || entry.name.startsWith('.')) continue
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) { await visit(absolutePath, depth + 1); continue }
      if (!entry.isFile() || !MATERIAL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      const stat = await fs.stat(absolutePath)
      if (stat.size > MAX_TEXT_BYTES) continue
      files.push({ path: path.relative(workspace.root, absolutePath).replaceAll(path.sep, '/'), bytes: stat.size })
    }
  }
  await visit(workspace.root, 0)
  return { ...workspace, files, truncated: files.length >= maxFiles }
}

export async function listWorkspacePreviews(root, options = {}) {
  const workspace = await ensureWorkspace(root)
  const maxFiles = Math.max(1, Math.min(200, Number(options.maxFiles) || 100))
  const maxDepth = Math.max(0, Math.min(8, Number(options.maxDepth) || 6))
  const previews = []
  async function visit(directory, depth) {
    if (depth > maxDepth || previews.length >= maxFiles) return
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (previews.length >= maxFiles || entry.name === MANIFEST_DIR || entry.name.startsWith('.')) continue
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) { await visit(absolutePath, depth + 1); continue }
      if (!entry.isFile() || entry.name.toLowerCase() !== 'preview.html') continue
      previews.push(path.relative(workspace.root, absolutePath).replaceAll(path.sep, '/'))
    }
  }
  await visit(workspace.root, 0)
  previews.sort((left, right) => left.localeCompare(right))
  return { ...workspace, previews, truncated: previews.length >= maxFiles }
}

export async function readWorkspaceMaterial(root, relativePath) {
  const safePath = assertRelativePath(relativePath)
  if (!MATERIAL_EXTENSIONS.has(path.extname(safePath).toLowerCase())) throw workspaceError('material type is not supported in the first version', 'MATERIAL_UNSUPPORTED')
  return readWorkspaceText(root, safePath)
}

export async function writeResumeDraft(root, taskId, resumePath, content) {
  const workspace = await ensureWorkspace(root)
  const sourcePath = assertRelativePath(resumePath)
  if (!sourcePath.toLowerCase().endsWith('.md')) throw workspaceError('resumePath must point to a Markdown file')
  const draftId = String(taskId || '').trim()
  if (!draftId || !/^[A-Za-z0-9_-]+$/.test(draftId)) throw workspaceError('taskId is invalid')
  const text = String(content ?? '')
  if (!text.trim()) throw workspaceError('draft content cannot be empty', 'DRAFT_EMPTY')
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw workspaceError('draft content is too large', 'DRAFT_TOO_LARGE')
  const draftRelativePath = path.posix.join(MANIFEST_DIR, DRAFTS_DIR, draftId, path.posix.basename(sourcePath))
  const draftPath = path.resolve(workspace.root, ...draftRelativePath.split('/'))
  await writeAtomic(draftPath, text)
  return { ...workspace, sourcePath, draftRelativePath, draftPath, bytes: Buffer.byteLength(text, 'utf8'), contentVersion: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) }
}

export async function readResumeDraft(root, taskId, resumePath) {
  const workspace = await ensureWorkspace(root)
  const draftId = String(taskId || '').trim()
  if (!draftId || !/^[A-Za-z0-9_-]+$/.test(draftId)) throw workspaceError('taskId is invalid')
  const sourcePath = assertRelativePath(resumePath)
  const draftRelativePath = path.posix.join(MANIFEST_DIR, DRAFTS_DIR, draftId, path.posix.basename(sourcePath))
  const draftPath = path.resolve(workspace.root, ...draftRelativePath.split('/'))
  await assertRegularFile(draftPath)
  return { ...workspace, sourcePath, draftRelativePath, draftPath, content: await fs.readFile(draftPath, 'utf8') }
}

export async function saveResumeVersion(root, taskId, resumePath, metadata = {}) {
  const draft = await readResumeDraft(root, taskId, resumePath)
  if (metadata.state !== 'accepted') throw workspaceError('only an accepted task can be saved as a formal version', 'SAVE_NOT_ALLOWED')
  const versionId = `version_${crypto.randomUUID()}`
  const versionRelativePath = path.posix.join(MANIFEST_DIR, 'versions', versionId, path.posix.basename(draft.sourcePath))
  const versionPath = path.resolve(draft.root, ...versionRelativePath.split('/'))
  await writeAtomic(versionPath, draft.content)
  const cleanLabel = (value, maxLength) => String(value || '').trim().slice(0, maxLength)
  let jobDescriptionPath = null
  if (metadata.jobDescriptionPath) {
    try { jobDescriptionPath = assertRelativePath(metadata.jobDescriptionPath) } catch { jobDescriptionPath = null }
  }
  const record = {
    schemaVersion: 2,
    id: versionId,
    name: cleanLabel(metadata.name || '未命名版本', 80),
    resumePath: versionRelativePath,
    contentVersion: String(metadata.contentVersion || ''),
    templateId: String(metadata.templateId || ''),
    templateRevision: String(metadata.templateRevision || ''),
    templateSnapshot: metadata.templateSnapshot && typeof metadata.templateSnapshot === 'object' ? metadata.templateSnapshot : null,
    presentation: metadata.presentation && typeof metadata.presentation === 'object' ? metadata.presentation : null,
    renderId: String(metadata.renderId || ''),
    targetRole: cleanLabel(metadata.targetRole, 120) || null,
    company: cleanLabel(metadata.company, 120) || null,
    jobDescriptionPath,
    savedAt: new Date().toISOString(),
  }
  const recordRelativePath = path.posix.join(MANIFEST_DIR, 'versions', versionId, 'version.json')
  await writeAtomic(path.resolve(draft.root, ...recordRelativePath.split('/')), `${JSON.stringify(record, null, 2)}\n`)
  return { ...record, absolutePath: versionPath }
}

export async function listResumeVersions(root) {
  const workspace = await ensureWorkspace(root)
  const versionsRoot = path.join(workspace.root, MANIFEST_DIR, 'versions')
  const entries = await fs.readdir(versionsRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const versions = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^version_[A-Za-z0-9-]+$/.test(entry.name)) continue
    const recordPath = path.join(versionsRoot, entry.name, 'version.json')
    const record = await fs.readFile(recordPath, 'utf8').then((text) => JSON.parse(text)).catch(() => null)
    if (!record?.id) continue
    versions.push(record)
  }
  return versions.sort((left, right) => String(right.savedAt || '').localeCompare(String(left.savedAt || '')))
}

function assertVersionId(versionId) {
  const value = String(versionId || '').trim()
  if (!/^version_[A-Za-z0-9-]+$/.test(value)) throw workspaceError('invalid resume version id', 'VERSION_INVALID')
  return value
}

async function readResumeVersionRecord(root, versionId) {
  const workspace = await ensureWorkspace(root)
  const safeId = assertVersionId(versionId)
  const directory = path.join(workspace.root, MANIFEST_DIR, 'versions', safeId)
  const recordPath = path.join(directory, 'version.json')
  const record = await fs.readFile(recordPath, 'utf8').then((text) => JSON.parse(text)).catch((error) => {
    if (error?.code === 'ENOENT') throw workspaceError('resume version was not found', 'VERSION_NOT_FOUND')
    throw error
  })
  if (!record?.id || record.id !== safeId) throw workspaceError('resume version record is invalid', 'VERSION_INVALID')
  return { workspace, safeId, directory, recordPath, record }
}

export async function readResumeVersion(root, versionId) {
  const current = await readResumeVersionRecord(root, versionId)
  const contentPath = path.resolve(current.workspace.root, ...String(current.record.resumePath || '').replaceAll('\\', '/').split('/'))
  const relative = path.relative(current.workspace.root, contentPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw workspaceError('version content path is invalid', 'VERSION_INVALID')
  await assertRegularFile(contentPath)
  return { ...current.record, content: await fs.readFile(contentPath, 'utf8'), absolutePath: contentPath }
}

export async function renameResumeVersion(root, versionId, name) {
  const current = await readResumeVersionRecord(root, versionId)
  const nextName = String(name || '').trim()
  if (!nextName || nextName.length > 80) throw workspaceError('version name must be 1-80 characters', 'VERSION_NAME_INVALID')
  const record = { ...current.record, name: nextName, renamedAt: new Date().toISOString() }
  await writeAtomic(current.recordPath, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

export async function archiveResumeVersion(root, versionId) {
  const current = await readResumeVersionRecord(root, versionId)
  const record = { ...current.record, archived: true, archivedAt: current.record.archivedAt || new Date().toISOString() }
  await writeAtomic(current.recordPath, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

export function summarizeResume(content, relativePath) {
  const text = String(content || '')
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim())
  return { relativePath, bytes: Buffer.byteLength(text, 'utf8'), characters: text.length, headingCount: headings.length, headings, content: text }
}

export { assertRelativePath, resolveInside }
