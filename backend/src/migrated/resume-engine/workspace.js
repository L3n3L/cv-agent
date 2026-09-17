import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureWorkspace, writeAtomic } from '../../core/workspace.js'

// File adapter for migrated resume capabilities. CVAgent owns the actual
// workspace boundary and keeps engine-specific history under private metadata.
function normalize(value) {
  const text = String(value || '').replaceAll('\\', '/')
  if (!text || text.startsWith('/') || /^[A-Za-z]:\//i.test(text)) throw new Error('path must be relative')
  const parts = text.split('/')
  if (parts.some((part) => !part || part === '..')) throw new Error('path traversal is not allowed')
  if (parts.includes('.')) throw new Error('path is invalid')
  return parts.join('/')
}

export function resolveWorkspacePath(root, relativePath) {
  const rel = normalize(relativePath)
  const absolute = path.resolve(String(root || ''), ...rel.split('/'))
  const rootPath = path.resolve(String(root || ''))
  const check = path.relative(rootPath, absolute)
  if (!check || check.startsWith('..') || path.isAbsolute(check)) throw new Error('path must stay inside workspace')
  return { abs: absolute, rel }
}

export async function readWorkspaceFile(root, relativePath) {
  const workspace = await ensureWorkspace(root)
  const resolved = resolveWorkspacePath(workspace.root, relativePath)
  return { ...workspace, abs: resolved.abs, rel: resolved.rel, content: await fs.readFile(resolved.abs, 'utf8') }
}

export async function writeWorkspaceFile(root, relativePath, content) {
  const workspace = await ensureWorkspace(root)
  const resolved = resolveWorkspacePath(workspace.root, relativePath)
  await writeAtomic(resolved.abs, String(content ?? ''))
  return { ...workspace, abs: resolved.abs, rel: resolved.rel }
}
