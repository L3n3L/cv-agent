import { z } from 'zod'

export const inspectSchema = z.object({ includeContent: z.boolean().default(true).describe('Whether to return the current Markdown content to the agent.') })
export const qualitySchema = z.object({ target: z.enum(['source', 'draft']).default('draft'), targetPages: z.number().int().positive().max(3).default(1) })
export const listSchema = z.object({ maxFiles: z.number().int().positive().max(200).default(100), maxDepth: z.number().int().min(0).max(8).default(4) })
export const readMaterialSchema = z.object({ path: z.string().min(1).describe('Relative path returned by workspace_materials_list.') })
export const writeSchema = z.object({ content: z.string().min(1).describe('Complete replacement Markdown draft. Preserve high-signal evidence unless the user explicitly asks to remove it.') })
const pageMetricSchema = z.object({
  page: z.number().int().positive().max(3).optional(),
  occupancyRatio: z.number().min(0).max(1).optional(),
  blankRatio: z.number().min(0).max(1).optional(),
  usedHeight: z.number().nonnegative().optional(),
  availableHeight: z.number().positive().optional(),
  topWhitespace: z.number().nonnegative().optional(),
  bottomWhitespace: z.number().nonnegative().optional(),
  overflow: z.boolean().optional(),
  modules: z.array(z.string().max(120)).max(20).optional(),
  moduleDetails: z.array(z.object({
    id: z.string().max(120).optional(),
    type: z.string().max(80).optional(),
    name: z.string().max(120).optional(),
    top: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional(),
  })).max(20).optional(),
}).passthrough(false)

const visualAuditSchema = z.object({
  state: z.string().max(40).optional(),
  occupancy: z.array(z.number().min(0).max(1)).max(3).optional(),
  warnings: z.array(z.object({ code: z.string().max(80), message: z.string().max(240) })).max(20).optional(),
  moduleCount: z.number().int().nonnegative().max(100).optional(),
  pageBalance: z.number().min(0).max(1).nullable().optional(),
}).passthrough(false)

export const measureSchema = z.object({
  renderId: z.string().min(1),
  pageCount: z.number().int().positive().max(3),
  occupancy: z.array(z.number().min(0).max(1)).min(1).max(3),
  overflow: z.boolean().default(false),
  pages: z.array(pageMetricSchema).min(1).max(3).optional(),
  visualAudit: visualAuditSchema.optional(),
})
export const iconListSchema = z.object({ query: z.string().max(80).default(''), limit: z.number().int().min(1).max(50).default(24) })
export const layoutValidateSchema = z.object({ layout: z.record(z.string(), z.unknown()).describe('A template layout specification to normalize and validate before it is proposed or saved.') })
export const templateSelectSchema = z.object({ templateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) })
export const templateCopySchema = z.object({ sourceTemplateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), newTemplateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), name: z.string().min(1).max(80).optional() })
export const templateGenerateSchema = z.object({ brief: z.record(z.string(), z.unknown()).describe('A constrained Design Brief: name, audience, family, layout, density, tone, modules, palette, and optional scoped CSS.') })
export const templateAutotuneSchema = z.object({ round: z.number().int().min(1).max(3).default(1).describe('One bounded automatic tuning round. It only uses the current browser measurement and invalidates the current render.') })
export const templateSaveSchema = z.object({ template: z.record(z.string(), z.unknown()).describe('A candidate returned by template_generate, or a validated workspace template specification.'), replaceExisting: z.boolean().default(false), confirmedByUser: z.literal(true).describe('True only after the user explicitly asked to create or overwrite this workspace template.') })
export const templateVersionsSchema = z.object({ templateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) })
export const templateRestoreSchema = z.object({ templateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), versionId: z.string().regex(/^\d{4,}$|^[a-zA-Z0-9_-]+$/), confirmedByUser: z.literal(true).describe('True only after the user explicitly requested this version restore.') })
export const presentationSuggestSchema = z.object({ round: z.number().int().min(1).max(3).default(1).describe('Bounded adjustment round. A suggestion never changes the presentation by itself.') })
export const versionSaveSchema = z.object({
  name: z.string().min(1).max(80),
  confirmedByUser: z.literal(true).describe('True only after the user explicitly asked to save this exact accepted draft as a formal version.'),
  targetRole: z.string().max(120).optional(),
  company: z.string().max(120).optional(),
  jobDescriptionPath: z.string().max(240).optional(),
})
export const presentationSchema = z.object({
  reset: z.boolean().default(false).describe('Remove the selected template presentation override for the current isolated resume. This does not modify the template or resume content.'),
  clear: z.array(z.enum(['layout', 'visual', 'iconTuning'])).default([]).describe('Remove only the named presentation groups so the template defaults apply again.'),
  layout: z.object({ fontFamily: z.enum(['system-sans', 'modern-sans', 'serif']).optional(), fontSize: z.number().min(11).max(18).optional(), lineHeight: z.number().min(1.2).max(2).optional(), sectionGap: z.number().min(6).max(30).optional(), pageMargin: z.number().min(24).max(72).optional() }).default({}),
  visual: z.object({ accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), textColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), mutedColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), cornerRadius: z.number().min(0).max(16).optional(), divider: z.enum(['none', 'solid', 'dashed']).optional() }).default({}),
  iconTuning: z.record(z.string(), z.object({ scale: z.number().min(0.7).max(1.5).optional(), offsetY: z.number().min(-0.25).max(0.25).optional() })).default({}),
})
