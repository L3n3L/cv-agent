import { z } from 'zod'

export const inspectSchema = z.object({ includeContent: z.boolean().default(true).describe('Whether to return the current Markdown content to the agent.') })
export const qualitySchema = z.object({ target: z.enum(['source', 'draft']).default('draft'), targetPages: z.number().int().positive().max(3).default(1) })
export const listSchema = z.object({ maxFiles: z.number().int().positive().max(200).default(100), maxDepth: z.number().int().min(0).max(8).default(4) })
export const readMaterialSchema = z.object({ path: z.string().min(1).describe('Relative path returned by workspace_materials_list.') })
export const writeSchema = z.object({ content: z.string().min(1).describe('Complete replacement Markdown draft. Preserve high-signal evidence unless the user explicitly asks to remove it.') })
export const measureSchema = z.object({ renderId: z.string().min(1), pageCount: z.number().int().positive().max(3), occupancy: z.array(z.number().min(0).max(1)).min(1).max(3), overflow: z.boolean().default(false) })
export const templateSelectSchema = z.object({ templateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) })
export const templateCopySchema = z.object({ sourceTemplateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), newTemplateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), name: z.string().min(1).max(80).optional() })
export const presentationSchema = z.object({
  layout: z.object({ fontFamily: z.enum(['system-sans', 'modern-sans', 'serif']).optional(), fontSize: z.number().min(11).max(18).optional(), lineHeight: z.number().min(1.2).max(2).optional(), sectionGap: z.number().min(6).max(30).optional(), pageMargin: z.number().min(24).max(72).optional() }).default({}),
  visual: z.object({ accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), textColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), mutedColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), cornerRadius: z.number().min(0).max(16).optional(), divider: z.enum(['none', 'solid', 'dashed']).optional() }).default({}),
  iconTuning: z.record(z.string(), z.object({ scale: z.number().min(0.7).max(1.5).optional(), offsetY: z.number().min(-0.25).max(0.25).optional() })).default({}),
})
