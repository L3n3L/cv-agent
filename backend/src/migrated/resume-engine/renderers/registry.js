const RENDERER_IDS = Object.freeze(['composition'])

function itemClass(item) {
  const type = String(item?.type || 'custom-section').replace(/[^a-z0-9-]/gi, '-')
  return `cvagent-renderer-item cvagent-renderer-item-${type}`
}

function renderItem(item, extraClass = '') {
  return `<div class="${itemClass(item)}${extraClass ? ` ${extraClass}` : ''}">${item.html}</div>`
}

function renderSplitSidebar({ renderer, header, ordered, layout, rootClass = '' }) {
  const split = layout?.ir?.type === 'split' ? layout.ir : null
  const splitColumns = split?.columns || []
  const sideColumn = splitColumns.find((column) => column.id === 'side') || splitColumns[1]
  const sideIds = new Set((sideColumn?.items || layout?.regions?.side || []).map(String))
  const fallbackSideTypes = new Set(['skills', 'links', 'awards', 'skill-tags'])
  const side = ordered.filter((item) => sideIds.has(item.sourceId) || (!sideIds.size && fallbackSideTypes.has(item.type)))
  const sideSet = new Set(side.map((item) => item.id))
  const main = ordered.filter((item) => !sideSet.has(item.id)).map((item) => renderItem(item, 'cvagent-column-main-item')).join('\n')
  const sideHtml = side.map((item) => renderItem(item, 'cvagent-column-side-item')).join('\n')
  const gap = Number.isFinite(split?.gap) ? split.gap : Number(layout?.columnGap) || 24
  return `<div class="cvagent-resume-root cvagent-renderer-${renderer}${rootClass ? ` ${rootClass}` : ''}" data-layout-ir="split">${header}<div class="cvagent-layout-split" data-layout-type="split" style="--layout-gap:${gap}px"><div class="cvagent-layout-column cvagent-layout-column-main" data-region="main">${main}</div><aside class="cvagent-layout-column cvagent-layout-column-side" data-region="side">${sideHtml}</aside></div></div>`
}

function renderPortfolioGrid({ renderer, header, ordered, layout }) {
  const grid = layout?.ir?.type === 'grid' ? layout.ir : null
  const columns = Number.isInteger(grid?.columns) ? grid.columns : 2
  const gap = Number.isFinite(grid?.gap) ? grid.gap : Number(layout?.columnGap) || 20
  const items = ordered.map((item) => renderItem(item, item.sourceId === 'projects' ? 'cvagent-renderer-featured' : '')).join('\n')
  return `<div class="cvagent-resume-root cvagent-renderer-${renderer}" data-layout-ir="grid">${header}<div class="cvagent-layout-grid" data-layout-type="grid" style="--layout-grid-columns:${columns};--layout-gap:${gap}px">${items}</div></div>`
}

function pageSpecItems(ordered, pageSpec = {}) {
  const order = Array.isArray(pageSpec.flow?.order) ? pageSpec.flow.order : []
  if (!order.length) return ordered
  const bySource = new Map(ordered.map((item) => [String(item.sourceId || item.id || item.type), item]))
  const result = []
  const seen = new Set()
  for (const id of order) {
    const item = bySource.get(String(id))
    if (item && !seen.has(item)) {
      result.push(item)
      seen.add(item)
    }
  }
  for (const item of ordered) if (!seen.has(item)) result.push(item)
  return result
}

function pageSpecVariant(pageSpec, item) {
  const key = String(item?.sourceId || item?.type || '')
  const value = pageSpec?.modules?.[key] || pageSpec?.modules?.[item?.type]
  return typeof value === 'string' ? value.replace(/[^a-z0-9-]/gi, '-') : ''
}

function renderSingleColumnItem(item, pageSpec) {
  const variant = pageSpecVariant(pageSpec, item)
  const className = ['cvagent-single-column-module', variant ? `cvagent-single-column-module-${variant}` : ''].filter(Boolean).join(' ')
  const variantAttr = variant ? ` data-module-variant="${variant}"` : ''
  const moduleType = String(item.type || 'custom-section').replace(/[^a-z0-9-]/gi, '-')
  return `<div class="${className}" data-module-source="${String(item.sourceId || item.type || '').replace(/[^a-z0-9-]/gi, '-')}" data-module-type="${moduleType}"${variantAttr}>${renderItem(item)}</div>`
}

function renderComposedModules(ordered, composition = {}) {
  const pageSpec = composition.pageSpec || null
  const items = pageSpecItems(ordered, pageSpec || {})
  return items.map((item, index) => {
    const variant = pageSpecVariant(pageSpec, item)
    const rail = pageSpec
      ? ['timeline', 'role-stack'].includes(variant)
      : composition.entry === 'timeline'
    if (!rail) return renderSingleColumnItem(item, pageSpec)
    const variantClass = variant ? ` cvagent-single-column-module-${variant}` : ''
    const variantAttr = variant ? ` data-module-variant="${variant}"` : ''
    return `<article class="cvagent-entry-rail cvagent-entry-rail-timeline${variantClass} ${itemClass(item)}" data-entry-index="${index + 1}" data-module-source="${String(item.sourceId || item.type || '').replace(/[^a-z0-9-]/gi, '-')}"${variantAttr}><span class="cvagent-entry-rail-marker" aria-hidden="true"></span><div class="cvagent-entry-rail-content">${item.html}</div></article>`
  }).join('\n')
}

function pageSpecAttributes(pageSpec = {}) {
  if (!pageSpec || typeof pageSpec !== 'object') return ''
  const attrs = [
    ['data-page-spec-version', pageSpec.schemaVersion],
    ['data-page-size', pageSpec.page?.size],
    ['data-page-column', pageSpec.page?.column],
    ['data-page-density', pageSpec.page?.density],
    ['data-page-family', pageSpec.visual?.family],
    ['data-page-type-scale', pageSpec.visual?.typeScale],
    ['data-page-header', pageSpec.header?.variant],
    ['data-page-flow-layout', pageSpec.flow?.layout],
    ['data-page-section', pageSpec.modules?.section],
    ['data-page-rule', pageSpec.visual?.ruleStyle],
    ['data-page-accent-mode', pageSpec.visual?.accentMode],
  ]
  return attrs
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ` ${key}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}` + '"')
    .join('')
}

function renderComposedLayout({ renderer, template, header, ordered, layout }) {
  const composition = template.composition || {}
  const pageSpec = composition.pageSpec || null
  const specAttrs = pageSpecAttributes(pageSpec)
  const page = composition.page || (layout?.ir?.type === 'split' ? 'split' : layout?.ir?.type === 'grid' ? 'grid' : 'stack')
  if (page === 'split') {
    const splitHtml = renderSplitSidebar({ renderer, header, ordered, layout, rootClass: 'cvagent-composed-layout' })
    return splitHtml.replace(/<div class="cvagent-layout-split"/, '<div class="cvagent-composed-modules cvagent-layout-split"')
  }
  if (page === 'grid') {
    const gridHtml = renderPortfolioGrid({ renderer, header, ordered, layout })
    return gridHtml
      .replace(/class="cvagent-resume-root cvagent-renderer-composition"/, 'class="cvagent-resume-root cvagent-renderer-composition cvagent-composed-layout"')
      .replace(/<div class="cvagent-layout-grid"/, '<div class="cvagent-composed-modules cvagent-layout-grid"')
  }
  const modules = renderComposedModules(ordered, composition)
  const flowLayout = pageSpec?.flow?.layout || 'stack'
  return `<div class="cvagent-resume-root cvagent-renderer-${renderer} cvagent-composed-layout${pageSpec ? ' cvagent-single-column-page' : ''}"${specAttrs}>${header}<div class="cvagent-composed-modules cvagent-layout-stack" data-layout-type="stack" data-flow-layout="${flowLayout}">${modules}</div></div>`
}

const RENDERERS = new Map([
  ['composition', renderComposedLayout],
])

export function resolveRendererId() {
  return 'composition'
}

export function listRendererIds() {
  return [...RENDERER_IDS]
}

export function renderTemplateLayout({ template = {}, layout = {}, header = '', ordered = [] }) {
  const renderer = resolveRendererId(template, layout)
  const render = RENDERERS.get(renderer)
  const html = render({ renderer, template, layout, header, ordered })
  if (!template.composition || typeof template.composition !== 'object') return html
  const attrs = Object.entries(template.composition)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => ` data-composition-${key}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`)
    .join('')
  return attrs
    ? html.replace(/^(<div\b[^>]*class="[^"]*cvagent-resume-root[^"]*"[^>]*)>/i, `$1${attrs}>`)
    : html
}
