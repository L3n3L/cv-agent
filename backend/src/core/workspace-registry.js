import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureWorkspace, writeAtomic, assertRelativePath } from './workspace.js'

const WORKSPACE_ID_PATTERN = /^ws_[A-Za-z0-9-]+$/
const MANIFEST_RELATIVE_PATH = '.cvagent/workspace.json'
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.css', '.csv', '.yaml', '.yml'])
const ASSET_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
const MAX_FILES = 500
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_ASSET_BYTES = 8 * 1024 * 1024

function workspaceError(message, code = 'WORKSPACE_INVALID') {
  return Object.assign(new Error(message), { code })
}

function assertWorkspaceId(value) {
  const id = String(value || '').trim()
  if (!WORKSPACE_ID_PATTERN.test(id)) throw workspaceError('workspaceId is invalid', 'WORKSPACE_INVALID')
  return id
}

function fileType(relativePath) {
  const extension = path.extname(relativePath).toLowerCase()
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  if (ASSET_EXTENSIONS.has(extension)) return 'asset'
  return null
}

function normalizeImportedFile(input) {
  const relativePath = assertRelativePath(input?.path)
  const type = fileType(relativePath)
  if (!type) throw workspaceError(`unsupported workspace file type: ${relativePath}`, 'WORKSPACE_FILE_UNSUPPORTED')
  const encoding = input?.encoding || (type === 'text' ? 'utf8' : 'base64')
  let content
  if (encoding === 'utf8') content = Buffer.from(String(input?.content ?? ''), 'utf8')
  else if (encoding === 'base64') content = Buffer.from(String(input?.content ?? ''), 'base64')
  else throw workspaceError(`unsupported workspace file encoding: ${encoding}`, 'WORKSPACE_FILE_INVALID')
  const maxBytes = type === 'text' ? MAX_TEXT_BYTES : MAX_ASSET_BYTES
  if (!content.length) throw workspaceError(`workspace file is empty: ${relativePath}`, 'WORKSPACE_FILE_INVALID')
  if (content.length > maxBytes) throw workspaceError(`workspace file is too large: ${relativePath}`, 'WORKSPACE_FILE_TOO_LARGE')
  return { relativePath, type, content }
}

async function writeBufferAtomic(filePath, content) {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporaryPath, content, { flag: 'wx' })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
  }
}

async function findResumePath(root) {
  const exact = path.join(root, 'resume.md')
  const exactStat = await fs.stat(exact).catch(() => null)
  if (exactStat?.isFile()) return 'resume.md'
  const candidates = []
  async function visit(directory, depth) {
    if (depth > 3) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name === '.cvagent' || entry.name.startsWith('.')) continue
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) { await visit(absolutePath, depth + 1); continue }
      if (!entry.isFile() || !['.md', '.markdown'].includes(path.extname(entry.name).toLowerCase())) continue
      candidates.push(path.relative(root, absolutePath).replaceAll(path.sep, '/'))
    }
  }
  await visit(root, 0)
  candidates.sort((left, right) => left.localeCompare(right))
  if (!candidates[0]) throw workspaceError('the selected workspace does not contain a Markdown resume', 'WORKSPACE_RESUME_NOT_FOUND')
  return candidates[0]
}

function publicWorkspace(record) {
  return {
    id: record.id,
    name: record.name,
    resumeName: record.resumePath ? path.basename(record.resumePath) : '',
    hasResume: Boolean(record.resumePath),
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    fileCount: Number(record.fileCount || 0),
  }
}

async function readRecord(root) {
  const manifestPath = path.join(root, MANIFEST_RELATIVE_PATH)
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  if (!manifest?.id || !WORKSPACE_ID_PATTERN.test(manifest.id) || (manifest.resumePath != null && typeof manifest.resumePath !== 'string')) throw workspaceError('workspace manifest is invalid', 'WORKSPACE_MANIFEST_INVALID')
  return { ...manifest, root, manifestPath }
}

export function createWorkspaceRegistry(options = {}) {
  const directory = path.resolve(options.directory || process.env.CVAGENT_WORKSPACE_DIR || path.join(process.cwd(), '.cvagent', 'workspaces'))

  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true })
  }

  async function resolve(workspaceId) {
    const id = assertWorkspaceId(workspaceId)
    const root = path.resolve(directory, id)
    const relative = path.relative(directory, root)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw workspaceError('workspaceId is outside the registry', 'WORKSPACE_INVALID')
    return readRecord(root)
  }

  async function list() {
    await ensureDirectory()
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const records = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !WORKSPACE_ID_PATTERN.test(entry.name)) continue
      const record = await readRecord(path.join(directory, entry.name)).catch(() => null)
      if (record) records.push(publicWorkspace(record))
    }
    return records.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
  }

  async function importFiles({ name, files }) {
    if (!Array.isArray(files) || files.length === 0) throw workspaceError('workspace files are required', 'WORKSPACE_FILES_REQUIRED')
    if (files.length > MAX_FILES) throw workspaceError(`workspace contains too many files (max ${MAX_FILES})`, 'WORKSPACE_TOO_MANY_FILES')
    const normalized = files.map(normalizeImportedFile)
    const totalBytes = normalized.reduce((sum, file) => sum + file.content.length, 0)
    if (totalBytes > MAX_TOTAL_BYTES) throw workspaceError('workspace import is too large', 'WORKSPACE_IMPORT_TOO_LARGE')
    await ensureDirectory()
    const id = `ws_${crypto.randomUUID()}`
    const root = path.join(directory, id)
    const createdAt = new Date().toISOString()
    try {
      await fs.mkdir(root, { recursive: true })
      for (const file of normalized) await writeBufferAtomic(path.resolve(root, file.relativePath), file.content)
      const resumePath = await findResumePath(root)
      const manifest = {
        schemaVersion: 1,
        id,
        name: String(name || '未命名工作区').trim().slice(0, 120) || '未命名工作区',
        resumePath,
        origin: 'browser_directory',
        fileCount: normalized.length,
        byteCount: totalBytes,
        createdAt,
        updatedAt: createdAt,
      }
      await writeAtomic(path.join(root, MANIFEST_RELATIVE_PATH), `${JSON.stringify(manifest, null, 2)}\n`)
      const workspace = await ensureWorkspace(root, manifest.name)
      if (workspace.id !== id) throw workspaceError('workspace manifest could not be created', 'WORKSPACE_MANIFEST_INVALID')
      return { ...manifest, root, manifestPath: path.join(root, MANIFEST_RELATIVE_PATH) }
    } catch (error) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async function createEmpty({ name }) {
    await ensureDirectory()
    const id = `ws_${crypto.randomUUID()}`
    const root = path.join(directory, id)
    const createdAt = new Date().toISOString()
    const manifest = {
      schemaVersion: 1,
      id,
      name: String(name || '未命名工作区').trim().slice(0, 120) || '未命名工作区',
      resumePath: null,
      origin: 'empty_workspace',
      fileCount: 0,
      byteCount: 0,
      createdAt,
      updatedAt: createdAt,
    }
    try {
      await fs.mkdir(root, { recursive: true })
      await writeAtomic(path.join(root, MANIFEST_RELATIVE_PATH), `${JSON.stringify(manifest, null, 2)}\n`)
      return { ...manifest, root, manifestPath: path.join(root, MANIFEST_RELATIVE_PATH) }
    } catch (error) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async function setResumePath(workspaceId, resumePath) {
    const record = await resolve(workspaceId)
    const relativePath = assertRelativePath(resumePath)
    if (!['.md', '.markdown'].includes(path.extname(relativePath).toLowerCase())) throw workspaceError('resumePath must point to a Markdown file', 'WORKSPACE_RESUME_INVALID')
    const next = {
      ...record,
      resumePath: relativePath,
      fileCount: Math.max(1, Number(record.fileCount || 0)),
      updatedAt: new Date().toISOString(),
    }
    const { root, manifestPath, ...manifest } = next
    await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    return next
  }

  async function metadata(workspaceId) {
    return publicWorkspace(await resolve(workspaceId))
  }

  return { directory, ensureDirectory, resolve, list, importFiles, createEmpty, setResumePath, metadata, publicWorkspace }
}

export { MAX_ASSET_BYTES, MAX_FILES, MAX_TEXT_BYTES, MAX_TOTAL_BYTES }
