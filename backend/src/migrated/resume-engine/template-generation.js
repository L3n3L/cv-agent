import { COMPOSITION_OPTIONS, normalizeCompositionPageSpec, normalizeTemplateSpec, TEMPLATE_DEFAULTS, validateCssText, validateTemplateSpec } from './template-schema.js'

// This is deliberately a constrained design language. An Agent may describe a
// template with a Design Brief, but it cannot invent renderer IDs, modules, or
// unsafe CSS. The renderer remains the sole authority for final layout.
const AUDIENCES = new Set(['campus', 'engineering', 'product', 'design', 'academic', 'general'])
const LAYOUTS = new Set(['single-column', 'two-column'])
const DENSITIES = new Set(['compact', 'standard', 'airy'])
const TONES = new Set(['clear', 'technical', 'editorial', 'minimal', 'terminal'])
const MODULES = new Set(['profile', 'education', 'skills', 'projects', 'experience', 'awards', 'links', 'photo', 'summary', 'contact'])
const HEX = /^#[0-9a-f]{6}$/i

const FAMILY_PROFILES = Object.freeze({
  'campus-clear': { name: '校招清晰', layout: 'single-column', density: 'standard', sidebarModules: [], typography: { fontFamily: 'system-sans', fontSize: 14, headingScale: 1.14, lineHeight: 1.55 }, spacing: { pageMargin: 48, sectionGap: 20, paragraphGap: 6 }, visual: { accentColor: '#2563eb', textColor: '#1f2937', mutedColor: '#6b7280', backgroundColor: '#ffffff', divider: 'solid', cornerRadius: 0, variant: 'standard' } },
  'engineering-dense': { name: '工程密集', layout: 'single-column', density: 'compact', sidebarModules: [], typography: { fontFamily: 'modern-sans', fontSize: 13, headingScale: 1.1, lineHeight: 1.4 }, spacing: { pageMargin: 38, sectionGap: 14, paragraphGap: 3 }, visual: { accentColor: '#1e3a5f', textColor: '#172033', mutedColor: '#64748b', backgroundColor: '#ffffff', divider: 'solid', cornerRadius: 0, variant: 'technical' } },
  'split-focus': { name: '双栏侧重', layout: 'two-column', density: 'standard', sidebarModules: ['skills', 'links', 'awards'], typography: { fontFamily: 'system-sans', fontSize: 14, headingScale: 1.12, lineHeight: 1.5 }, spacing: { pageMargin: 42, sectionGap: 17, paragraphGap: 5 }, visual: { accentColor: '#0f766e', textColor: '#1f2937', mutedColor: '#64748b', backgroundColor: '#ffffff', divider: 'solid', cornerRadius: 2, variant: 'standard' } },
  'editorial-quiet': { name: '安静编辑', layout: 'single-column', density: 'airy', sidebarModules: [], typography: { fontFamily: 'serif', fontSize: 15, headingScale: 1.2, lineHeight: 1.7 }, spacing: { pageMargin: 58, sectionGap: 26, paragraphGap: 8 }, visual: { accentColor: '#0f766e', textColor: '#243238', mutedColor: '#718096', backgroundColor: '#fffdf8', divider: 'none', cornerRadius: 6, variant: 'editorial' } },
  'portfolio-grid': { name: '项目作品集', layout: 'two-column', density: 'standard', sidebarModules: ['skills', 'links'], typography: { fontFamily: 'modern-sans', fontSize: 14, headingScale: 1.16, lineHeight: 1.55 }, spacing: { pageMargin: 44, sectionGap: 18, paragraphGap: 5 }, visual: { accentColor: '#7c3aed', textColor: '#2e243d', mutedColor: '#7c6f91', backgroundColor: '#fcfaff', divider: 'solid', cornerRadius: 8, variant: 'editorial' } },
  'business-timeline': { name: '商务时间线', layout: 'single-column', density: 'standard', sidebarModules: [], typography: { fontFamily: 'modern-sans', fontSize: 13, headingScale: 1.12, lineHeight: 1.48 }, spacing: { pageMargin: 42, sectionGap: 18, paragraphGap: 5 }, visual: { accentColor: '#c8a45d', textColor: '#1f2937', mutedColor: '#64748b', backgroundColor: '#ffffff', divider: 'solid', cornerRadius: 0, variant: 'standard' } },
  'magazine-editorial': { name: '杂志开篇', layout: 'single-column', density: 'airy', sidebarModules: [], typography: { fontFamily: 'serif', fontSize: 14, headingScale: 1.3, lineHeight: 1.62 }, spacing: { pageMargin: 48, sectionGap: 20, paragraphGap: 7 }, visual: { accentColor: '#be123c', textColor: '#292524', mutedColor: '#78716c', backgroundColor: '#fffdf7', divider: 'none', cornerRadius: 0, variant: 'editorial' } },
  'geek-lab': { name: '极客实验室', layout: 'single-column', density: 'compact', sidebarModules: [], typography: { fontFamily: 'modern-sans', fontSize: 13, headingScale: 1.08, lineHeight: 1.4 }, spacing: { pageMargin: 40, sectionGap: 14, paragraphGap: 3 }, visual: { accentColor: '#a3e635', textColor: '#ecfccb', mutedColor: '#a7b89a', backgroundColor: '#101610', divider: 'solid', cornerRadius: 2, variant: 'terminal' } },
})

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
  sidebarModules: [],
  tags: [],
  bestFor: [],
  composition: {},
})

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function slugify(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'ai-template' }
function cleanList(value, limit = 7) { return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))].slice(0, limit) : [] }
function familyFor(id) { return FAMILY_PROFILES[id] || FAMILY_PROFILES['campus-clear'] }

function normalizedComposition(value) {
  return Object.fromEntries(Object.entries(COMPOSITION_OPTIONS)
    .filter(([key]) => typeof value?.[key] === 'string')
    .map(([key]) => [key, value[key]]))
}

export function listTemplateFamilies() {
  return Object.entries(FAMILY_PROFILES).map(([id, profile]) => ({ id, ...clone(profile) }))
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
  const familyId = Object.hasOwn(raw, 'family') && FAMILY_PROFILES[raw.family]
    ? raw.family
    : (raw.audience === 'engineering' || raw.tone === 'technical' ? 'engineering-dense' : 'campus-clear')
  const profile = familyFor(familyId)
  const palette = raw.palette && typeof raw.palette === 'object' && !Array.isArray(raw.palette) ? raw.palette : {}
  const moduleOrder = cleanList(raw.moduleOrder).filter((module) => MODULES.has(module))
  const layout = LAYOUTS.has(raw.layout) ? raw.layout : profile.layout
  const density = DENSITIES.has(raw.density) ? raw.density : profile.density
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
    sidebarModules: cleanList(raw.sidebarModules, 4).filter((module) => MODULES.has(module)),
    tags: cleanList(raw.tags, 6),
    bestFor: cleanList(raw.bestFor, 6),
    composition: normalizedComposition(raw.composition),
  }
  if (!Object.hasOwn(raw, 'sidebarModules')) result.sidebarModules = profile.sidebarModules.filter((module) => result.moduleOrder.includes(module))
  else result.sidebarModules = result.sidebarModules.filter((module) => result.moduleOrder.includes(module))
  return result
}

export function validateDesignBrief(input) {
  const value = normalizeDesignBrief(input)
  const errors = []
  if (!value.name || value.name.length > 40) errors.push('name is required and must be at most 40 characters')
  errors.push(...validateCssText(value.templateCss, { kind: 'templateCss' }).errors)
  errors.push(...validateCssText(value.customCss, { kind: 'customCss' }).errors)
  return { valid: errors.length === 0, errors, value }
}

function pageSpec(brief) {
  const editorial = brief.tone === 'editorial' || brief.family === 'magazine-editorial'
  const terminal = brief.tone === 'terminal' || brief.family === 'geek-lab'
  const technical = brief.tone === 'technical' || brief.audience === 'engineering' || brief.family === 'business-timeline'
  const margin = brief.density === 'compact' ? 34 : brief.density === 'airy' ? 52 : 42
  return normalizeCompositionPageSpec({
    page: { size: 'A4', column: 'single', density: brief.density, margin: { top: margin, right: margin, bottom: margin, left: margin } },
    header: { variant: terminal ? 'command' : editorial ? 'masthead' : 'masthead', alignment: 'left', identity: 'stacked', contact: terminal ? 'stacked' : 'inline' },
    flow: { layout: 'balanced-footer', order: brief.moduleOrder, keepEntryTogether: true, avoidSectionOrphans: true },
    modules: { section: terminal || technical ? 'numbered-rail' : brief.tone === 'minimal' ? 'rule' : 'badge', experience: technical ? 'timeline' : 'standard', projects: editorial ? 'cards' : technical ? 'timeline' : 'standard', skills: brief.density === 'compact' ? 'rows' : brief.tone === 'minimal' ? 'inline' : 'grouped-chips', education: 'compact', awards: 'compact' },
    visual: { family: brief.family, typeScale: brief.density === 'compact' ? 'compact' : editorial || brief.density === 'airy' ? 'display' : 'balanced', ruleStyle: brief.tone === 'minimal' ? 'none' : editorial ? 'solid' : 'hairline', accentMode: terminal ? 'text' : editorial ? 'surface' : 'marker' },
  })
}

export function generateTemplateCandidate(input = {}) {
  const validation = validateDesignBrief(input)
  const brief = validation.value
  if (!validation.valid) return { valid: false, errors: validation.errors, brief }
  const family = familyFor(brief.family)
  const technical = brief.audience === 'engineering' || brief.tone === 'technical'
  const composition = {
    page: brief.layout === 'two-column' ? 'split' : brief.family === 'portfolio-grid' ? 'grid' : 'stack',
    header: brief.tone === 'editorial' || brief.family === 'business-timeline' ? 'hero' : 'standard',
    section: brief.tone === 'minimal' ? 'line' : 'badge',
    entry: technical ? 'timeline' : 'stack',
    meta: brief.layout === 'two-column' || technical ? 'split' : 'inline',
    skills: brief.tone === 'minimal' ? 'list' : 'chips',
    ...brief.composition,
  }
  if (composition.page === 'stack') composition.pageSpec = pageSpec(brief)
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
    qualityAudit,
    rationale: [`${brief.layout === 'two-column' ? '双栏' : '单栏'}结构，适合${brief.audience}场景`, `${brief.density}密度，优先保证 A4 信息层级`, `${family.name}主题家族由安全 token 和页面规格表达`, `质量闸门：${qualityAudit.status}，需要真实浏览器截图与 A4 指标确认`],
    nextSteps: ['候选仍在内存中，不会写入工作区', '仅当用户明确创建、保存或应用时，调用模板保存流程', '保存后渲染饱满真实简历，并读取当前 renderId 的 A4 指标'],
  }
}
