import { COMPOSITION_OPTIONS, normalizeCompositionPageSpec, normalizeTemplateSpec, TEMPLATE_DEFAULTS, validateCssText, validateTemplateSpec } from './template-schema.js'
import { blockPreset, listThemeFamilies, resolveThemeFamily, THEME_FAMILY_IDS } from './theme-system.js'

// This is deliberately a constrained design language. An Agent may describe a
// template with a Design Brief, but it cannot invent renderer IDs, modules, or
// unsafe CSS. The renderer remains the sole authority for final layout.
const AUDIENCES = new Set(['campus', 'engineering', 'product', 'design', 'academic', 'general'])
const LAYOUTS = new Set(['single-column', 'two-column'])
const DENSITIES = new Set(['compact', 'standard', 'airy'])
const TONES = new Set(['clear', 'technical', 'editorial', 'minimal', 'terminal'])
const MODULES = new Set(['profile', 'education', 'skills', 'projects', 'experience', 'awards', 'links', 'photo', 'summary', 'contact'])
const BLOCK_TYPES = new Set(['profile', 'education', 'skills', 'projects', 'experience', 'awards', 'links', 'project-list', 'skill-tags', 'skill-groups', 'timeline', 'metric-row', 'portfolio-card', 'qr-code', 'photo', 'summary', 'contact', 'custom-section'])
const HEX = /^#[0-9a-f]{6}$/i

const CSS_QUALITY_HOOKS = Object.freeze([
  ['template scope', 'data-template-id'],
  ['header', 'header-block'],
  ['section headings', 'cvagent-resume-section'],
  ['entry titles', 'cvagent-entry-title'],
  ['entry metadata', 'cvagent-entry-meta'],
  ['result bullets', 'cvagent-entry-bullets'],
  ['print output', '@media print'],
])

export const DESIGN_BRIEF_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  id: '',
  name: 'AI 模板候选',
  description: '',
  family: 'campus-clear',
  audience: 'general',
  layout: 'single-column',
  density: 'standard',
  tone: 'clear',
  palette: {},
  templateCss: '',
  customCss: '',
  moduleOrder: [...TEMPLATE_DEFAULTS.layout.moduleOrder],
  moduleTypes: {},
  sidebarModules: [],
  tags: [],
  bestFor: [],
  composition: {},
})

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function slugify(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'ai-template' }
function cleanList(value, limit = 7) { return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))].slice(0, limit) : [] }
function familyFor(id) { return resolveThemeFamily(id) }

function normalizedComposition(value) {
  return Object.fromEntries(Object.entries(COMPOSITION_OPTIONS)
    .filter(([key]) => typeof value?.[key] === 'string')
    .map(([key]) => [key, value[key]]))
}

export function listTemplateFamilies() {
  return listThemeFamilies()
}

export function auditTemplateCss(css, templateId = '') {
  const value = typeof css === 'string' ? css : ''
  const missing = CSS_QUALITY_HOOKS.filter(([, marker]) => !value.includes(marker)).map(([label]) => label)
  if (templateId && !value.includes(`[data-template-id="${templateId}"]`) && !value.includes(`[data-template-id='${templateId}']`)) missing.unshift('current template scope')
  if (!value.trim()) missing.unshift('independent template CSS')
  return {
    status: missing.length ? 'needs-visual-work' : 'ready-for-browser-review',
    score: Math.max(0, CSS_QUALITY_HOOKS.length - missing.length),
    total: CSS_QUALITY_HOOKS.length,
    bytes: Buffer.byteLength(value, 'utf8'),
    missing,
    instruction: missing.length
      ? '补齐作用域、正文层和打印规则后，用饱满真实简历截图验收。'
      : '候选 CSS 已覆盖核心视觉层；仍必须经过真实浏览器截图与 A4 指标验收。',
  }
}

export function normalizeDesignBrief(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const familyId = Object.hasOwn(raw, 'family') && THEME_FAMILY_IDS.includes(raw.family)
    ? raw.family
    : (!Object.hasOwn(raw, 'family') && (raw.audience === 'engineering' || raw.tone === 'technical')
        ? 'engineering-dense'
        : 'campus-clear')
  const profile = familyFor(familyId)
  const palette = raw.palette && typeof raw.palette === 'object' && !Array.isArray(raw.palette) ? raw.palette : {}
  const moduleOrder = cleanList(raw.moduleOrder).filter((module) => MODULES.has(module))
  const layout = LAYOUTS.has(raw.layout) ? raw.layout : profile.layout.mode
  const density = DENSITIES.has(raw.density) ? raw.density : profile.layout.density
  const tone = TONES.has(raw.tone) ? raw.tone : (profile.visual.variant === 'technical' ? 'technical' : profile.visual.variant === 'editorial' ? 'editorial' : profile.visual.variant === 'terminal' ? 'terminal' : 'clear')
  const result = {
    ...clone(DESIGN_BRIEF_DEFAULTS),
    ...raw,
    schemaVersion: 1,
    id: typeof raw.id === 'string' ? slugify(raw.id) : '',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : DESIGN_BRIEF_DEFAULTS.name,
    description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 160) : '',
    family: familyId,
    audience: AUDIENCES.has(raw.audience) ? raw.audience : 'general',
    layout,
    density,
    tone,
    palette: Object.fromEntries(Object.entries(palette).filter(([key, value]) => ['accentColor', 'textColor', 'mutedColor', 'backgroundColor'].includes(key) && typeof value === 'string' && HEX.test(value))),
    templateCss: typeof raw.templateCss === 'string' ? raw.templateCss : '',
    customCss: typeof raw.customCss === 'string' ? raw.customCss : '',
    moduleOrder: moduleOrder.length ? moduleOrder : [...TEMPLATE_DEFAULTS.layout.moduleOrder],
    moduleTypes: Object.fromEntries(Object.entries(raw.moduleTypes && typeof raw.moduleTypes === 'object' && !Array.isArray(raw.moduleTypes) ? raw.moduleTypes : {}).filter(([module, type]) => MODULES.has(module) && BLOCK_TYPES.has(type))),
    sidebarModules: cleanList(raw.sidebarModules, 4).filter((module) => MODULES.has(module)),
    tags: cleanList(raw.tags, 6),
    bestFor: cleanList(raw.bestFor, 6),
    composition: normalizedComposition(raw.composition),
  }
  if (!Object.hasOwn(raw, 'sidebarModules')) result.sidebarModules = profile.layout.sidebarModules.filter((module) => result.moduleOrder.includes(module))
  else result.sidebarModules = result.sidebarModules.filter((module) => result.moduleOrder.includes(module))
  return result
}

export function validateDesignBrief(input) {
  const value = normalizeDesignBrief(input)
  const errors = []
  if (input && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'family') && !THEME_FAMILY_IDS.includes(input.family)) {
    errors.push(`family is unsupported: ${String(input.family)}`)
  }
  if (!value.name || value.name.length > 40) errors.push('name is required and must be at most 40 characters')
  errors.push(...validateCssText(value.templateCss, { kind: 'templateCss' }).errors)
  errors.push(...validateCssText(value.customCss, { kind: 'customCss' }).errors)
  return { valid: errors.length === 0, errors, value }
}

function pageSpec(brief) {
  const family = brief.family
  const terminal = brief.tone === 'terminal' || family === 'geek-lab' || family === 'mono-terminal'
  const editorial = brief.tone === 'editorial' || family === 'editorial-quiet' || family === 'magazine-editorial' || family === 'heading-stack'
  const timeline = family === 'business-timeline' || family === 'career-chronicle' || brief.tone === 'technical' || brief.audience === 'engineering'
  const projects = family === 'case-study' || family === 'impact-board' ? 'feature-first' : timeline ? 'timeline' : editorial ? 'cards' : 'standard'
  const experience = timeline ? 'timeline' : family === 'case-study' ? 'role-stack' : editorial ? 'feature-first' : 'standard'
  const skills = family === 'operation-block' || family === 'avatar-profile' ? 'grouped-chips' : brief.tone === 'minimal' ? 'inline' : brief.density === 'compact' ? 'rows' : 'list'
  const section = terminal ? 'numbered-rail' : family === 'operation-block' ? 'marker' : editorial ? 'plain' : timeline ? 'numbered-rail' : brief.tone === 'minimal' ? 'rule' : 'badge'
  const header = terminal ? 'command' : family === 'avatar-profile' ? 'centered' : editorial ? 'masthead' : 'masthead'
  const typeScale = brief.density === 'compact' ? 'compact' : brief.density === 'airy' || editorial ? 'display' : 'balanced'
  const margin = brief.density === 'compact' ? 34 : brief.density === 'airy' ? 52 : 42
  return normalizeCompositionPageSpec({
    page: { size: 'A4', column: 'single', density: brief.density, margin: { top: margin, right: margin, bottom: margin, left: margin } },
    header: { variant: header, alignment: family === 'avatar-profile' ? 'center' : 'left', identity: family === 'avatar-profile' ? 'split' : 'stacked', contact: terminal ? 'stacked' : 'inline' },
    flow: { layout: 'balanced-footer', order: brief.moduleOrder, keepEntryTogether: true, avoidSectionOrphans: true },
    modules: { section, experience, projects, skills, education: 'compact', awards: 'compact' },
    visual: { family, typeScale, ruleStyle: brief.tone === 'minimal' ? 'none' : editorial ? 'solid' : 'hairline', accentMode: terminal ? 'text' : editorial ? 'surface' : 'marker' },
  })
}

export function generateTemplateCandidate(input = {}) {
  const validation = validateDesignBrief(input)
  const brief = validation.value
  if (!validation.valid) return { valid: false, errors: validation.errors, brief }
  const family = familyFor(brief.family)
  const technical = brief.audience === 'engineering' || brief.tone === 'technical'
  const timeline = brief.family === 'business-timeline' || brief.tone === 'technical' || brief.audience === 'engineering'
  const composition = {
    page: brief.family === 'portfolio-grid' ? 'grid' : brief.layout === 'two-column' ? 'split' : 'stack',
    header: brief.family === 'avatar-profile' || brief.family === 'business-timeline' || brief.audience === 'design' ? 'hero' : 'standard',
    section: brief.tone === 'minimal' ? 'line' : 'badge',
    entry: timeline ? 'timeline' : 'stack',
    meta: timeline || brief.layout === 'two-column' ? 'split' : 'inline',
    skills: brief.tone === 'minimal' || brief.family === 'business-timeline' ? 'list' : 'chips',
    ...brief.composition,
  }
  if (composition.page === 'stack') composition.pageSpec = pageSpec(brief)
  const defaultModuleTypes = {
    skills: brief.tone === 'minimal' ? 'skills' : 'skill-tags',
    projects: brief.tone === 'editorial' ? 'portfolio-card' : 'project-list',
    experience: brief.tone === 'technical' ? 'timeline' : 'experience',
  }
  const moduleTypes = { ...defaultModuleTypes, ...family.moduleTypes, ...brief.moduleTypes }
  const mainModules = brief.moduleOrder.filter((module) => !brief.sidebarModules.includes(module))
  const sidebarModules = brief.sidebarModules.length ? brief.sidebarModules : family.layout.sidebarModules
  const sideModules = brief.layout === 'two-column' ? brief.moduleOrder.filter((module) => sidebarModules.includes(module)) : []
  const layoutSpec = {
    schemaVersion: 1,
    mode: brief.layout,
    regions: brief.layout === 'two-column' ? { main: mainModules, side: sideModules } : { main: mainModules },
    ir: composition.page === 'grid'
      ? { type: 'grid', columns: 2, gap: 20, items: brief.moduleOrder }
      : brief.layout === 'two-column'
        ? { type: 'split', gap: 22, columns: [{ id: 'main', width: '1fr', items: mainModules }, { id: 'side', width: '0.32fr', items: sideModules }] }
        : { type: 'stack', items: brief.moduleOrder },
    blocks: brief.moduleOrder.map((module) => {
      const type = moduleTypes[module] || module
      return { id: module, type, source: module, options: { preset: blockPreset(type).preset, family: brief.family } }
    }),
  }
  const id = brief.id || slugify(brief.name)
  const { templateCss: _templateCss, ...designBrief } = brief
  const template = normalizeTemplateSpec({
    id,
    name: brief.name,
    description: brief.description || `${brief.name}：面向${brief.audience}场景的${brief.layout === 'two-column' ? '双栏' : '单栏'}模板`,
    family: brief.family,
    renderer: 'composition',
    tags: [...new Set([...brief.tags, brief.layout === 'two-column' ? '双栏' : '单栏', brief.density])].slice(0, 6),
    layout: { ...TEMPLATE_DEFAULTS.layout, mode: brief.layout, density: brief.density, moduleOrder: brief.moduleOrder, sidebarRatio: brief.layout === 'two-column' ? 0.32 : TEMPLATE_DEFAULTS.layout.sidebarRatio, columnGap: brief.layout === 'two-column' ? 22 : TEMPLATE_DEFAULTS.layout.columnGap },
    typography: { ...family.typography, fontFamily: brief.tone === 'editorial' || brief.audience === 'academic' ? 'serif' : technical ? 'modern-sans' : family.typography.fontFamily, fontSize: brief.density === 'compact' ? 13 : brief.density === 'airy' ? 15 : family.typography.fontSize, lineHeight: brief.density === 'compact' ? 1.4 : brief.density === 'airy' ? 1.7 : family.typography.lineHeight },
    spacing: { ...family.spacing, pageMargin: brief.density === 'compact' ? 38 : brief.density === 'airy' ? 58 : family.spacing.pageMargin, sectionGap: brief.density === 'compact' ? 14 : brief.density === 'airy' ? 26 : family.spacing.sectionGap, paragraphGap: brief.density === 'compact' ? 3 : brief.density === 'airy' ? 8 : family.spacing.paragraphGap },
    visual: { ...family.visual, ...brief.palette, variant: brief.tone === 'technical' ? 'technical' : brief.tone === 'editorial' ? 'editorial' : brief.tone === 'terminal' ? 'terminal' : 'standard' },
    composition,
    // Keep the DSH-style layout IR with the template snapshot.  The candidate
    // is still validated by the CVAgent template schema, but the renderer must
    // receive the same structural contract that was shown to the user.
    layoutSpec,
    templateCss: brief.templateCss,
    customCss: brief.customCss,
    metadata: { generatedBy: 'cvagent-template-design', familyName: family.name, audience: brief.audience, tone: brief.tone, bestFor: brief.bestFor, designBrief, immutable: false },
  })
  const result = validateTemplateSpec(template)
  const qualityAudit = auditTemplateCss(brief.templateCss, id)
  return {
    valid: result.valid,
    errors: result.errors,
    brief,
    template: result.value,
    layoutSpec,
    qualityAudit,
    rationale: [`${brief.layout === 'two-column' ? '双栏' : '单栏'}结构，适合${brief.audience}场景`, `${brief.density}密度，优先保证 A4 信息层级`, `${family.name}主题家族与模块预设已映射到 layoutSpec`, `质量闸门：${qualityAudit.status}，需要真实浏览器截图与 A4 指标确认`],
    nextSteps: ['候选仍在内存中，不会写入工作区', '仅当用户明确创建、保存或应用时，调用模板保存流程', '保存后渲染饱满真实简历，并读取当前 renderId 的 A4 指标'],
  }
}
