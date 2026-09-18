import { listAvailableTemplates, listTemplatePresets, getTemplatePreset, loadTemplate, copyTemplate, saveTemplate, listTemplateVersions, restoreTemplateVersion, templateSnapshotIdentity } from './template-presets.js'

export function listMigratedTemplates() {
  return listTemplatePresets().map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    family: template.family,
    tags: [...(template.tags || [])],
    revision: Number(template.metadata?.revision || 1),
    immutable: Boolean(template.metadata?.immutable),
  }))
}

export function resolveMigratedTemplate(id) {
  const template = getTemplatePreset(String(id || '').trim())
  if (!template) throw Object.assign(new Error(`template is not available in CVAgent: ${id}`), { code: 'TEMPLATE_NOT_FOUND' })
  return template
}

export async function listWorkspaceTemplates(root) {
  const templates = await listAvailableTemplates(root)
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    family: template.family,
    tags: [...(template.tags || [])],
    revision: Number(template.metadata?.revision || 1),
    immutable: Boolean(template.metadata?.immutable),
    sourceTemplateId: template.metadata?.sourceTemplateId || null,
  }))
}

export async function loadWorkspaceTemplate(root, id) {
  return loadTemplate(root, id)
}

export async function saveWorkspaceTemplate(root, template, options = {}) {
  return saveTemplate(root, template, options)
}

export async function copyWorkspaceTemplate(root, sourceId, newId, name) {
  return copyTemplate(root, sourceId, newId, name)
}

export async function listWorkspaceTemplateVersions(root, id) {
  return listTemplateVersions(root, id)
}

export async function restoreWorkspaceTemplateVersion(root, id, versionId) {
  return restoreTemplateVersion(root, id, versionId)
}

export async function getWorkspaceTemplateSnapshotIdentity(root, id, revision) {
  return templateSnapshotIdentity(root, id, revision)
}
