import { createHash } from 'node:crypto'
import MarkdownIt from 'markdown-it'
import { assertTemplateSpec, validateCssText } from './template-schema.js'
import { assertLayoutSpec } from './layout-schema.js'
import { renderTemplateLayout, resolveRendererId } from './renderers/registry.js'
import { getIconDefinition } from './icons/registry.js'
import { inferResumeModule } from './semantics.js'

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
  typographer: false,
})

const defaultLinkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noreferrer')
  return defaultLinkOpen(tokens, index, options, env, self)
}

/** Markdown → safe HTML. Raw HTML is disabled so resume.md cannot inject scripts. */
export function markdownToHtml(md) {
  return markdown.render(String(md || '').replace(/\r\n/g, '\n'))
}

/** Assemble Markdown sections into the plugin's own semantic resume tree. */
function sectionHeading(part) {
  return /<h2>([^<]*)<\/h2>/.exec(part)?.[1]?.trim() || ''
}

function inferModuleFromHeading(heading) {
  return inferResumeModule(heading)
}

function moduleClass(type) {
  return `cvagent-module-${String(type || 'custom-section').replace(/[^a-z0-9-]/gi, '-')}`
}

function presetClass(options = {}) {
  const preset = options?.preset
  if (!preset) return ''
  return `cvagent-preset-${String(preset).replace(/[^a-z0-9-]/gi, '-')}`
}

function safeImageSource(source, context = {}) {
  const value = String(source || '').trim()
  if (!value) return ''
  if (/^https:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith('/api/asset?')) return value
  const relative = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!relative || relative.split('/').some((part) => part === '..')) return ''
  return context.root
    ? `/api/asset?workspaceRoot=${encodeURIComponent(context.root)}&path=${encodeURIComponent(relative)}`
    : relative
}

// Keep the DSH renderer contract for inline Markdown images as well as the
// dedicated photo module. The CVAgent host uses a different asset route, but
// the source rewriting and traversal rejection are intentionally identical.
export function rewriteImageSources(html, context = {}) {
  return String(html || '').replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (_match, prefix, source, suffix) => `${prefix}${escapeHtml(safeImageSource(source, context))}${suffix}`)
}

function photoShape(value) {
  return ['circle', 'square', 'rounded'].includes(value) ? value : 'rounded'
}

function photoSize(value) {
  const size = Number(value)
  return Number.isFinite(size) ? Math.min(180, Math.max(40, Math.round(size))) : 88
}

function renderPhoto(html, options = {}, context = {}) {
  const sourceFromMarkup = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/i.exec(html)?.[1] || ''
  const altFromMarkup = /<img\b[^>]*\balt="([^"]*)"[^>]*>/i.exec(html)?.[1] || ''
  const source = safeImageSource(options.source || sourceFromMarkup, context)
  const alt = escapeHtml(String(options.alt || altFromMarkup || '头像'))
  const shape = photoShape(options.shape)
  const size = photoSize(options.size)
  if (!source) return `<div class="cvagent-photo cvagent-photo-missing cvagent-photo-${shape}" data-placement="${escapeHtml(String(options.placement || 'header'))}"><span>暂无头像</span></div>`
  return `<figure class="cvagent-photo cvagent-photo-${shape}" data-placement="${escapeHtml(String(options.placement || 'header'))}" style="--photo-size:${size}px"><img src="${escapeHtml(source)}" alt="${alt}" loading="lazy" /></figure>`
}

function renderSkillGroups(html) {
  const list = /<ul>([\s\S]*?)<\/ul>/.exec(html)
  if (!list) return `<div class="cvagent-skill-groups">${html}</div>`
  const items = list[1].match(/<li>[\s\S]*?<\/li>/g) || []
  return html.replace(list[0], `<div class="cvagent-skill-groups">${items.map((item) => `<div class="cvagent-skill-group">${item.replace(/^<li>|<\/li>$/g, '')}</div>`).join('')}</div>`)
}

function renderIconTokens(html, iconState = { next: 0 }) {
  // Consume only horizontal whitespace after a token. Markdown examples use
  // `[icon:github] GitHub`; keeping that source space in addition to the
  // icon's box margin creates a visibly loose gap in headings and contacts.
  return String(html || '').replace(/\[icon:([a-z0-9_-]+)\][ \t]*/gi, (match, rawName) => {
    const name = rawName.toLowerCase()
    const index = iconState.next++
    const definition = getIconDefinition(name)
    if (definition?.svg) {
      const svg = definition.svg
      const fill = svg.hex || 'currentColor'
      return `<span class="cvagent-icon cvagent-icon-${name}" data-icon-name="${name}" data-icon-index="${index}" role="img" aria-label="${definition.label}"><svg viewBox="${svg.viewBox}" width="1em" height="1em" aria-hidden="true" focusable="false"><path d="${svg.d}" fill="${fill}"/></svg></span>`
    }
    if (definition) {
      return `<span class="cvagent-icon cvagent-icon-${name}" data-icon-name="${name}" data-icon-index="${index}" role="img" aria-label="${definition.label}"><span aria-hidden="true">${definition.glyph}</span></span>`
    }
    // Never expose private token syntax in an exported resume. The quality
    // check and write gate report the exact unknown slug separately.
    return `<span class="cvagent-icon cvagent-icon-unknown" data-icon-name="${name}" data-icon-index="${index}" role="img" aria-label="未注册图标"><span aria-hidden="true">•</span></span>`
  })
}

function renderModuleBody(type, html, options = {}, context = {}) {
  if (type === 'photo') return renderPhoto(html, options, context)
  if (type === 'summary') return `<div class="cvagent-summary">${html}</div>`
  if (type === 'contact') return `<div class="cvagent-contact">${html}</div>`
  if (type === 'skill-groups') return renderSkillGroups(html)
  if (type === 'skill-tags') {
    const list = /<ul>([\s\S]*?)<\/ul>/.exec(html)
    if (!list) return html
    const tags = list[1]
      .replaceAll(/<li>/g, '<span class="cvagent-skill-tag">')
      .replaceAll(/<\/li>/g, '</span>')
    return html.replace(list[0], `<div class="cvagent-skill-tags">${tags}</div>`)
  }
  if (type === 'timeline') return `<div class="cvagent-timeline">${html}</div>`
  if (type === 'metric-row') return `<div class="cvagent-metric-row">${html}</div>`
  if (type === 'portfolio-card') return `<div class="cvagent-portfolio-card">${html}</div>`
  if (type === 'project-list') return `<div class="cvagent-project-list">${html}</div>`
  if (type === 'qr-code') return `<div class="cvagent-qr-code">${html}</div>`
  return html
}

function entryMetaText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

function addClassToOpeningTag(open, className) {
  if (/\bclass="/i.test(open)) return open.replace(/class="([^"]*)"/i, `class="$1 ${className}"`)
  return open.replace(/>$/, ` class="${className}">`)
}

function classifyHeroContact(value) {
  const text = entryMetaText(value).toLowerCase()
  if (/\b(?:github|gitlab|gitee)\b/.test(text)) return 'github'
  if (/@/.test(text)) return 'email'
  if (/(?:个人网站|网站|https?:\/\/|www\.)/.test(text)) return 'website'
  if (/(?:电话|手机|1[3-9]\d{9}|\+?\d[\d\s-]{7,})/.test(text)) return 'phone'
  return 'general'
}

function renderHeroSegments(segments, kind) {
  return segments.map((segment, index) => {
    const segmentKind = kind === 'contact' ? classifyHeroContact(segment) : 'identity'
    const itemClass = kind === 'contact' ? `cvagent-contact-item cvagent-contact-${segmentKind}` : 'cvagent-hero-identity-item'
    const divider = index ? '<span class="cvagent-hero-separator" aria-hidden="true">｜</span>' : ''
    return `${divider}<span class="cvagent-hero-segment ${itemClass}">${segment.trim()}</span>`
  }).join('')
}

function decorateHeroHeader(html) {
  let result = String(html || '')
  result = result.replace(/<h1(?![^>]*\bclass=)([^>]*)>/i, '<h1 class="cvagent-hero-name"$1>')
  result = result.replace(/<p(?![^>]*\bclass=)([^>]*)>([\s\S]*?)<\/p>/i, (match, attrs, body) => {
    // Accept both ASCII and full-width separators. Chinese resumes commonly
    // use `｜`, and missing this variant silently collapses the whole hero
    // into one paragraph instead of the semantic identity/contact layers.
    if (/<img\b/i.test(body) || !/\s*[|｜]\s*/.test(body)) return match
    const segments = body.split(/\s*[|｜]\s*/).map((segment) => segment.trim()).filter(Boolean)
    if (segments.length < 4) return match
    const identity = renderHeroSegments(segments.slice(0, 2), 'identity')
    const contact = renderHeroSegments(segments.slice(2), 'contact')
    return `<p class="cvagent-hero-line cvagent-hero-identity"${attrs}>${identity}</p><p class="cvagent-hero-line cvagent-hero-contact"${attrs}>${contact}</p>`
  })
  result = result.replace(/<p(?![^>]*\bclass=)([^>]*)>\s*<img\b/i, (match, attrs) => {
    let opening = addClassToOpeningTag(`<p${attrs}>`, 'cvagent-hero-line')
    opening = addClassToOpeningTag(opening, 'cvagent-hero-avatar')
    return `${opening}${match.slice(match.indexOf('>') + 1)}`
  })
  result = result.replace(/<p(?![^>]*\bclass=)([^>]*)>/gi, (open) => addClassToOpeningTag(open, 'cvagent-hero-line'))
  return result
}

function entryMetaClasses(body) {
  const text = entryMetaText(body)
  const classes = []
  if (/(?:19|20)\d{2}|至今|present|current|\u2014|\||~|～/.test(text)) classes.push('cvagent-entry-meta')
  if (/<code\b/i.test(body) || /(?:技术栈|tech(?:nology)?\s*stack|stack)\s*[:：]/i.test(text)) classes.push('cvagent-entry-tech')
  if (!classes.includes('cvagent-entry-tech') && /(?:公司|岗位|职位|工程师|开发|产品|设计|实习|负责人|经理)\s*[^。]{0,28}/i.test(text)) classes.push('cvagent-entry-role')
  return classes
}

function decorateEntryMarkup(html) {
  let result = String(html || '')
  result = result.replace(/<h2(?![^>]*\bclass=)([^>]*)>/gi, '<h2 class="cvagent-section-heading"$1>')
  result = result.replace(/<h3(?![^>]*\bclass=)([^>]*)>/gi, '<h3 class="cvagent-entry-title"$1>')
  result = result.replace(/(<h3[^>]*>[\s\S]*?<\/h3>)([\s\S]*?)(?=<h3\b|$)/gi, (match, heading, tail) => {
    // Only classify top-level paragraphs after an entry heading. Paragraphs
    // inside the entry bullet list are resume content, not entry metadata;
    // classifying them by words such as “产品” or numbers such as “2000”
    // gives different bullets different font rules.
    const decoratedTail = tail.split(/(<ul\b[\s\S]*?<\/ul>)/gi).map((segment, index) => {
      if (index % 2 === 1) return segment
      return segment.replace(/(<p(?:\s[^>]*)?>)([\s\S]*?)(<\/p>)/gi, (paragraph, open, body, close) => {
        const classes = entryMetaClasses(body)
        if (!classes.length) return paragraph
        const decoratedOpen = classes.reduce((value, className) => addClassToOpeningTag(value, className), open)
        return `${decoratedOpen}${body}${close}`
      })
    }).join('')
    return `${heading}${decoratedTail}`
  })
  result = result.replace(/<ul(?![^>]*\bclass=)([^>]*)>/i, '<ul class="cvagent-entry-bullets"$1>')
  return result
}

function composeEntryRows(html, composition = {}, moduleId = '') {
  const pageSpec = composition.pageSpec || {}
  const moduleVariant = pageSpec.modules?.[moduleId]
  const entryLayout = moduleVariant || composition.entry
  if (!['timeline', 'role-stack', 'feature-first'].includes(entryLayout) || !/<h3\b/i.test(html)) return html
  return String(html).replace(/(<h3[^>]*>[\s\S]*?<\/h3>)([\s\S]*?)(?=<h3\b|$)/gi, (_match, title, tail) => {
    const semanticParagraphs = tail.match(/<p[^>]*class="[^"]*cvagent-entry-(?:meta|role|tech)[^"]*"[^>]*>[\s\S]*?<\/p>/gi) || []
    const meta = semanticParagraphs.find((paragraph) => /cvagent-entry-meta/.test(paragraph)) || ''
    const context = semanticParagraphs.filter((paragraph) => /cvagent-entry-(?:role|tech)/.test(paragraph)).join('')
    const detail = semanticParagraphs.reduce((value, paragraph) => value.replace(paragraph, ''), tail)
    const titleParts = title.match(/^(<h3[^>]*>)([\s\S]*?)(<\/h3>)$/i)
    const titleBody = titleParts && titleParts[2].split(/\s+·\s+/)
    const titleMarkup = titleParts
      ? `${titleParts[1]}<span class="cvagent-entry-project">${titleBody[0]}</span>${titleBody.length > 1 ? `<span class="cvagent-entry-role-label">${titleBody.slice(1).join(' · ')}</span>` : ''}${titleParts[3]}`
      : title
    const metaParts = meta.match(/^(<p[^>]*>)([\s\S]*?)(<\/p>)$/i)
    const metaBody = metaParts && metaParts[2].split(/\s+\|\s+/)
    const metaMarkup = metaParts && metaBody?.length > 1
      ? `${metaParts[1]}<span class="cvagent-entry-date">${metaBody[0]}</span><span class="cvagent-entry-tech-label">${metaBody.slice(1).join(' | ')}</span>${metaParts[3]}`
      : meta
    return `<div class="cvagent-entry-row cvagent-entry-row-${escapeHtml(entryLayout)}" data-entry-layout="${escapeHtml(composition.meta || 'split')}" data-entry-variant="${escapeHtml(entryLayout)}"><div class="cvagent-entry-main">${titleMarkup}${context}</div><div class="cvagent-entry-meta-slot">${metaMarkup}</div><div class="cvagent-entry-detail">${detail}</div></div>`
  })
}

export function assembleResumeSections(html, layoutSpec, templateLayout = null, templateSpec = {}, context = {}) {
  context = { ...context, iconState: context.iconState || { next: 0 } }
  // Structural combine without DOM: split by h2 boundaries.
  const parts = html.split(/(?=<h2>)/g).filter(Boolean)
  // Even a short resume with only a name and contact line still needs the
  // HeroHeader contract. Returning early here bypassed header decoration and
  // made the same content appear as one unstructured paragraph.
  if (!html.trim()) return '<div class="cvagent-resume-root"></div>'

  const layout = layoutSpec ? assertLayoutSpec(layoutSpec) : null
  const blocks = layout ? layout.blocks : []
  const byHeading = new Map(blocks.map((block) => [block.source || block.id, block]))
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const sectionParts = []
  let headerDone = false
  for (const [index, part] of parts.entries()) {
    if (part.startsWith('<h2>')) {
      const heading = sectionHeading(part)
      const inferredModule = inferModuleFromHeading(heading)
      const block = byHeading.get(heading) || byId.get(heading) || (inferredModule && byId.get(inferredModule)) || {
        id: inferredModule || `section-${index + 1}`,
        type: inferredModule || 'custom-section',
        source: heading,
      }
      const id = sectionParts.some((item) => item.id === block.id) ? `${block.id}-${index + 1}` : block.id
      const timelineSources = new Set(['projects', 'project-list', 'experience', 'portfolio-card'])
      const blockSource = [block.source, block.type].find((value) => timelineSources.has(String(value)))
      const pageSpec = templateSpec.composition?.pageSpec || {}
      const pageSpecModule = blockSource === 'project-list' || blockSource === 'portfolio-card' ? 'projects' : blockSource
      const moduleVariant = pageSpec.modules?.[pageSpecModule] || pageSpec.modules?.[block.id] || ''
      const shouldComposeEntries = (templateSpec.composition?.entry === 'timeline'
        || ['timeline', 'role-stack', 'feature-first'].includes(moduleVariant))
        && Boolean(blockSource)
      const sectionBody = shouldComposeEntries
        ? renderModuleBody(block.type, composeEntryRows(decorateEntryMarkup(renderIconTokens(part, context.iconState)), templateSpec.composition, blockSource || block.id), block.options, context)
        : decorateEntryMarkup(renderIconTokens(renderModuleBody(block.type, part, block.options, context), context.iconState))
      const sectionVariant = pageSpec.modules?.section || templateSpec.composition?.section
      const compositionSection = sectionVariant
        ? `cvagent-section-composition-${String(sectionVariant).replace(/[^a-z0-9-]/gi, '-')}`
        : ''
      const skillsVariant = pageSpec.modules?.skills || templateSpec.composition?.skills
      const compositionSkills = [block.id, block.source, block.type].some((value) => value === 'skills') && skillsVariant
        ? `cvagent-skills-composition-${String(skillsVariant).replace(/[^a-z0-9-]/gi, '-')}`
        : ''
      const compositionModule = moduleVariant
        ? `cvagent-module-composition-${String(moduleVariant).replace(/[^a-z0-9-]/gi, '-')}`
        : ''
      const classes = [moduleClass(block.type), presetClass(block.options), compositionSection, compositionSkills, compositionModule].filter(Boolean).join(' ')
      const family = block.options?.family ? ` data-theme-family="${escapeHtml(String(block.options.family))}"` : ''
      const variantAttribute = moduleVariant ? ` data-module-variant="${escapeHtml(String(moduleVariant))}"` : ''
      const section = `<section class="cvagent-resume-section ${classes}" data-module-id="${escapeHtml(block.id)}" data-module-type="${escapeHtml(block.type)}"${variantAttribute}${family}>${sectionBody}</section>`
      sectionParts.push({ id, sourceId: block.id, type: block.type, html: section })
      headerDone = true
    } else if (!headerDone) {
      const hero = layout?.ir?.hero || null
      const pageSpec = templateSpec.composition?.pageSpec || {}
      const headerVariant = pageSpec.header?.variant || templateSpec.composition?.header
      const compositionHeader = headerVariant
        ? `cvagent-header-composition-${String(headerVariant).replace(/[^a-z0-9-]/gi, '-')}`
        : ''
      const headerClass = ['header-block', 'cvagent-hero-header', compositionHeader, /<img\b/i.test(part) ? 'cvagent-header-with-image' : ''].filter(Boolean).join(' ')
      const heroLayout = hero ? ` data-hero-layout="${escapeHtml(hero.layout)}" data-hero-avatar="${escapeHtml(hero.avatar)}"` : ''
      const headerSpecAttributes = pageSpec.header
        ? ` data-page-header="${escapeHtml(String(pageSpec.header.variant))}" data-page-header-align="${escapeHtml(String(pageSpec.header.alignment))}" data-page-identity="${escapeHtml(String(pageSpec.header.identity))}" data-page-contact="${escapeHtml(String(pageSpec.header.contact))}"`
        : ''
      sectionParts.header = `<header class="${headerClass}"${heroLayout}${headerSpecAttributes}>${decorateHeroHeader(renderIconTokens(part, context.iconState))}</header>`
      headerDone = true
    }
  }
  const regionValues = layout?.regions || {}
  const orderIds = [...Object.values(regionValues).flat(), ...(templateLayout?.moduleOrder || [])]
  const ordered = []
  const used = new Set()
  for (const id of orderIds) {
    const section = sectionParts.find((item) => item.sourceId === id || item.id === id)
    if (section && !used.has(section.id)) {
      ordered.push(section)
      used.add(section.id)
    }
  }
  for (const section of sectionParts) {
    if (!used.has(section.id)) ordered.push(section)
  }
  const irOrder = layout?.ir?.type === 'split'
    ? layout.ir.columns.flatMap((column) => column.items || [])
    : (layout?.ir?.type === 'stack' || layout?.ir?.type === 'grid' ? layout.ir.items || [] : [])
  if (irOrder.length) {
    const bySourceId = new Map(ordered.map((section) => [section.sourceId, section]))
    const reordered = []
    const seen = new Set()
    for (const id of irOrder) {
      const section = bySourceId.get(id)
      if (section && !seen.has(section.id)) {
        reordered.push(section)
        seen.add(section.id)
      }
    }
    for (const section of ordered) if (!seen.has(section.id)) reordered.push(section)
    ordered.splice(0, ordered.length, ...reordered)
  }
  const header = sectionParts.header || ''
  const resolvedTemplate = { ...templateSpec, layout: templateLayout || templateSpec.layout || {} }
  const renderer = resolveRendererId(resolvedTemplate, { ...templateLayout, ...layout })
  return renderTemplateLayout({ template: { ...resolvedTemplate, renderer }, layout: { ...layout, regions: regionValues }, header, ordered })
}

function hashRenderInput(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function scopedCustomCss(templateId, customCss) {
  if (!customCss) return ''
  return `@scope (.resume-document[data-template-id="${templateId}"]) {\n${customCss}\n}`
}

export function buildPreviewDocument({ title, bodyHtml, cssText, templateCssText = '', sourcePath, templatePath, previewPath, previewRoot, renderId, contentHash, templateSpec, layoutSpec = null, initialIconTuning = {} }) {
  const normalizedTemplate = assertTemplateSpec(templateSpec)
  const templateCss = typeof templateCssText === 'string' && templateCssText ? templateCssText : normalizedTemplate.templateCss || ''
  const templateCssResult = validateCssText(templateCss, { kind: 'templateCss' })
  if (!templateCssResult.valid) throw new Error(`invalid templateCss: ${templateCssResult.errors.join('; ')}`)
  const resolvedRenderer = resolveRendererId(normalizedTemplate, layoutSpec || {})
  const rendererClasses = [...new Set([resolvedRenderer, normalizedTemplate.renderer])]
    .map((renderer) => `renderer-${escapeHtml(renderer)}`)
    .join(' ')
  const compositionAttributes = Object.entries(normalizedTemplate.composition || {})
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => ` data-composition-${key}="${escapeHtml(value)}"`)
    .join('')
  const pageSpec = normalizedTemplate.composition?.pageSpec || null
  const pageSpecAttributes = pageSpec
    ? [
        ['data-page-spec-version', pageSpec.schemaVersion],
        ['data-page-size', pageSpec.page?.size],
        ['data-page-column', pageSpec.page?.column],
        ['data-page-density', pageSpec.page?.density],
        ['data-page-family', pageSpec.visual?.family],
        ['data-page-type-scale', pageSpec.visual?.typeScale],
        ['data-page-rule', pageSpec.visual?.ruleStyle],
        ['data-page-accent-mode', pageSpec.visual?.accentMode],
      ]
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
        .join('')
    : ''
  const { templateCss: _templateCss, ...runtimeTemplate } = normalizedTemplate
  const serializedTemplate = JSON.stringify(runtimeTemplate).replace(/</g, '\\u003c')
  const customCss = scopedCustomCss(normalizedTemplate.id, normalizedTemplate.customCss)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || 'Resume Preview')}</title>
  <style data-template-base-css>
${cssText}
  </style>
${templateCss ? `  <style data-template-css>\n${templateCss}\n  </style>` : ''}
${customCss ? `  <style data-template-custom-css>\n${customCss}\n  </style>` : ''}
</head>
<body>
  <main class="resume-document template-${escapeHtml(normalizedTemplate.visual.variant)} ${rendererClasses}" data-renderer="${escapeHtml(resolvedRenderer)}" data-template-renderer="${escapeHtml(normalizedTemplate.renderer)}" data-source="${escapeHtml(sourcePath)}" data-template="${escapeHtml(templatePath)}" data-preview-root="${escapeHtml(previewRoot || '')}" data-preview-path="${escapeHtml(previewPath || '')}" data-render-id="${escapeHtml(renderId || '')}" data-content-hash="${escapeHtml(contentHash || '')}" data-template-id="${escapeHtml(normalizedTemplate.id)}" data-template-family="${escapeHtml(normalizedTemplate.family)}"${compositionAttributes}${pageSpecAttributes}>
    <div class="resume-content">
${bodyHtml}
    </div>
  </main>
  <script>
  (() => {
    const query = new URLSearchParams(window.location.search);
    const isThumbnail = query.get('thumbnail') === '1';
    const rootStyle = document.documentElement.style;
    const template = ${serializedTemplate};
    const fontFamilies = {
      'system-sans': '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      'modern-sans': 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      serif: 'Georgia, "Songti SC", "SimSun", serif',
    };
    const templateFont = fontFamilies[template.typography.fontFamily] || fontFamilies['system-sans'];
    const requestedFontFamily = query.get('fontFamily');
    const activeFont = fontFamilies[requestedFontFamily] || templateFont;
    const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
    const safeNumber = (value, min, max, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
    };
    const applyVisualTokens = (tokens = {}) => {
      const accentColor = safeColor(tokens.accentColor, template.visual.accentColor);
      const textColor = safeColor(tokens.textColor, template.visual.textColor);
      const mutedColor = safeColor(tokens.mutedColor, template.visual.mutedColor);
      const backgroundColor = safeColor(tokens.backgroundColor, template.visual.backgroundColor);
      const cornerRadius = safeNumber(tokens.cornerRadius, 0, 16, template.visual.cornerRadius);
      const divider = ['none', 'solid', 'dashed'].includes(tokens.divider) ? tokens.divider : template.visual.divider;
      rootStyle.setProperty('--resume-accent-color', accentColor);
      rootStyle.setProperty('--resume-text-color', textColor);
      rootStyle.setProperty('--resume-muted-color', mutedColor);
      rootStyle.setProperty('--resume-background-color', backgroundColor);
      rootStyle.setProperty('--bg', backgroundColor);
      rootStyle.setProperty('--resume-corner-radius', cornerRadius + 'px');
      rootStyle.setProperty('--resume-divider', divider);
    };
    const applyIconTuning = (icons = {}) => {
      const defaults = { scale: 1, offsetY: 0 };
      const wildcard = icons['*'] && typeof icons['*'] === 'object' ? icons['*'] : {};
      for (const icon of document.querySelectorAll('.cvagent-icon')) {
        const name = icon.dataset.iconName || [...icon.classList].find((className) => className.startsWith('cvagent-icon-'))?.slice('cvagent-icon-'.length) || '';
        const tuning = { ...defaults, ...wildcard, ...(icons[name] || {}) };
        const scale = safeNumber(tuning.scale, 0.7, 1.5, defaults.scale);
        const offsetY = safeNumber(tuning.offsetY, -0.25, 0.25, defaults.offsetY);
        icon.style.setProperty('--cvagent-icon-scale', String(scale));
        icon.style.setProperty('--cvagent-icon-offset-y', String(offsetY));
      }
    };
    const applyLayoutPreview = (layout = {}) => {
      const fontSize = safeNumber(layout.fontSize, 11, 18, template.typography.fontSize);
      const lineHeight = safeNumber(layout.lineHeight, 1.2, 2, template.typography.lineHeight);
      const sectionGap = safeNumber(layout.sectionGap, 6, 30, template.spacing.sectionGap);
      const pageMargin = safeNumber(layout.pageMargin, 24, 72, template.spacing.pageMargin);
      const fontFamily = fontFamilies[layout.fontFamily] || templateFont;
      const previewUrl = new URL(window.location.href);
      const layoutQuery = {
        fontFamily: layout.fontFamily || '',
        fontSize: String(fontSize),
        lineHeight: String(lineHeight),
        sectionGap: String(sectionGap),
        pageMargin: String(pageMargin),
      };
      const needsRepagination = Object.entries(layoutQuery).some(([key, value]) => previewUrl.searchParams.get(key) !== value);
      if (needsRepagination) {
        for (const [key, value] of Object.entries(layoutQuery)) {
          if (value) previewUrl.searchParams.set(key, value);
          else previewUrl.searchParams.delete(key);
        }
        // DSH's editor reopens a fresh preview for every layout draft. The
        // fresh document is important: pagination must run after the new CSS
        // values are applied, otherwise a second page created at the old font
        // size can never be merged back into page one.
        window.history.replaceState(null, '', previewUrl);
      }
      rootStyle.setProperty('--resume-font-size', fontSize + 'px');
      rootStyle.setProperty('--resume-line-height', String(lineHeight));
      rootStyle.setProperty('--resume-section-gap', sectionGap + 'px');
      rootStyle.setProperty('--resume-page-margin', pageMargin + 'px');
      rootStyle.setProperty('--resume-font-family', fontFamily);
      const manualStyle = document.querySelector('[data-cvagent-manual-tokens]');
      if (manualStyle) manualStyle.textContent = [
        'body{font-family:var(--resume-font-family) !important;line-height:' + lineHeight + ' !important;color:var(--resume-text-color) !important;}',
        '.cvagent-resume-page-content{padding:' + pageMargin + 'px !important;}',
        '.cvagent-resume-section{margin-bottom:' + sectionGap + 'px !important;}',
        'p,li{font-size:' + fontSize + 'px;margin-bottom:' + template.spacing.paragraphGap + 'px;}',
      ].join('');
      if (needsRepagination) window.location.reload();
    };
    rootStyle.setProperty('--resume-font-size', template.typography.fontSize + 'px');
    rootStyle.setProperty('--resume-line-height', template.typography.lineHeight);
    rootStyle.setProperty('--resume-font-family', activeFont);
    rootStyle.setProperty('--resume-section-gap', template.spacing.sectionGap + 'px');
    rootStyle.setProperty('--resume-page-margin', template.spacing.pageMargin + 'px');
    rootStyle.setProperty('--resume-paragraph-gap', template.spacing.paragraphGap + 'px');
    rootStyle.setProperty('--resume-heading-scale', template.typography.headingScale);
    // The active workspace may provide an older template CSS that does not
    // declare the page-height contract. Keep the preview renderer authoritative
    // so an A4 page cannot silently grow into a long canvas.
    rootStyle.setProperty('--page-width', '794px');
    rootStyle.setProperty('--page-height', '1123px');
    applyIconTuning(${JSON.stringify(initialIconTuning)});
    applyVisualTokens({
      accentColor: query.get('accentColor'),
      textColor: query.get('textColor'),
      mutedColor: query.get('mutedColor'),
      backgroundColor: query.get('backgroundColor'),
      cornerRadius: query.get('cornerRadius'),
      divider: query.get('divider'),
    });
    const settingMap = [
      ['fontSize', '--resume-font-size', 'px', 11, 18],
      ['lineHeight', '--resume-line-height', '', 1.2, 2],
      ['sectionGap', '--resume-section-gap', 'px', 6, 30],
      ['pageMargin', '--resume-page-margin', 'px', 24, 72],
    ];
    for (const [key, variable, unit, min, max] of settingMap) {
      const value = Number(query.get(key));
      if (Number.isFinite(value) && value >= min && value <= max) rootStyle.setProperty(variable, value + unit);
    }
    const visualStyle = document.createElement('style');
    const fontSize = rootStyle.getPropertyValue('--resume-font-size').trim() || '14px';
    const lineHeight = rootStyle.getPropertyValue('--resume-line-height').trim() || '1.55';
    const sectionGap = rootStyle.getPropertyValue('--resume-section-gap').trim() || '20px';
    const pageMargin = rootStyle.getPropertyValue('--resume-page-margin').trim() || '48px';
    visualStyle.textContent = [
      'html,body{background:#fff !important;overflow-x:hidden !important;}',
      '.resume-document{min-height:0 !important;padding:0 !important;background:#fff !important;}',
      '.cvagent-resume-pages{display:flex !important;flex-direction:column !important;align-items:center !important;gap:18px !important;width:100% !important;}',
      '.cvagent-resume-page{box-sizing:border-box !important;width:794px !important;height:1123px !important;min-height:1123px !important;flex:0 0 1123px !important;margin:0 !important;overflow:hidden !important;box-shadow:0 8px 30px rgba(15,23,42,.08) !important;}',
      '.cvagent-resume-page-content{box-sizing:border-box !important;width:100% !important;height:100% !important;overflow:hidden !important;}',
      'body{font-family:var(--resume-font-family) !important;line-height:' + lineHeight + ' !important;color:var(--resume-text-color);}',
      '.cvagent-resume-page-content{padding:' + pageMargin + ' !important;}',
      '.cvagent-resume-page{background:var(--bg) !important;border-radius:var(--resume-corner-radius);}',
      '.cvagent-resume-page-content{background-color:var(--bg) !important;border-radius:var(--resume-corner-radius);}',
      '.cvagent-resume-section{margin-bottom:' + sectionGap + ' !important;}',
      '.cvagent-resume-section{border-radius:var(--resume-corner-radius);}',
      'p,li{font-size:' + fontSize + ' !important;margin-bottom:' + template.spacing.paragraphGap + 'px;}',
      '.header-block{border-bottom-color:var(--resume-accent-color) !important;border-radius:var(--resume-corner-radius);}',
      '.header-block p,.meta{color:var(--resume-muted-color);}',
      '.cvagent-resume-section > h2{color:var(--resume-accent-color);font-size:calc(' + fontSize + ' * ' + template.typography.headingScale + ');border-bottom-color:var(--resume-accent-color);border-bottom-style:var(--resume-divider);}',
      '.cvagent-layout-split{display:grid !important;grid-template-columns:minmax(0,' + Math.max(0.55, 1 - template.layout.sidebarRatio) + 'fr) minmax(0,' + template.layout.sidebarRatio + 'fr) !important;gap:var(--layout-gap,' + template.layout.columnGap + 'px) !important;align-items:start;}',
      '.cvagent-layout-column{min-width:0;min-height:0;overflow:hidden;}',
      '.cvagent-column-main-item,.cvagent-column-side-item{min-width:0;}',
      '.cvagent-layout-grid{display:grid;grid-template-columns:repeat(var(--layout-grid-columns,2),minmax(0,1fr));gap:var(--layout-gap,20px);align-items:start;}',
      '.cvagent-skill-tags{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px;}',
      '.cvagent-skill-tag{display:inline-flex;align-items:center;padding:3px 8px;border:1px solid color-mix(in srgb,var(--resume-accent-color) 26%,#dbe3ef);border-radius:999px;font-size:.92em;line-height:1.35;}',
      '.cvagent-timeline{border-left:2px solid color-mix(in srgb,var(--resume-accent-color) 28%,transparent);padding-left:14px;}',
      '.cvagent-metric-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}',
      '.cvagent-portfolio-card{padding:10px 12px;border:1px solid color-mix(in srgb,var(--resume-accent-color) 20%,#e2e8f0);border-radius:var(--resume-corner-radius);background:color-mix(in srgb,var(--resume-background-color) 92%,#f8fafc);}',
      '.cvagent-project-list > ul{padding-left:1.2em;}',
      '.cvagent-qr-code{display:flex;justify-content:flex-end;}',
      '.resume-document img{max-width:100%;height:auto;}',
      '.cvagent-photo{display:flex;align-items:center;justify-content:center;width:var(--photo-size,88px);height:var(--photo-size,88px);margin:0 0 var(--resume-paragraph-gap) 0;overflow:hidden;background:#f1f5f9;color:var(--resume-muted-color);}',
      '.cvagent-photo img{display:block;width:100%;height:100%;object-fit:cover;}',
      '.cvagent-photo-circle,.cvagent-photo-circle img{border-radius:50%;}',
      '.cvagent-photo-rounded,.cvagent-photo-rounded img{border-radius:var(--resume-corner-radius,8px);}',
      '.cvagent-photo-square,.cvagent-photo-square img{border-radius:0;}',
      '.cvagent-photo-missing{border:1px dashed color-mix(in srgb,var(--resume-muted-color) 45%,#e2e8f0);font-size:11px;}',
      '.cvagent-header-with-image{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;}',
      '.cvagent-header-with-image img{width:var(--photo-size,72px);height:var(--photo-size,72px);object-fit:cover;border-radius:var(--resume-corner-radius,8px);}',
      '.cvagent-summary{padding:10px 12px;border-left:3px solid color-mix(in srgb,var(--resume-accent-color) 55%,transparent);background:color-mix(in srgb,var(--resume-accent-color) 6%,transparent);}',
      '.cvagent-contact{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--resume-muted-color);}',
      '.cvagent-contact p{margin:0 0 var(--resume-paragraph-gap) 0;}',
      '.cvagent-skill-groups{display:grid;gap:6px;}',
      '.cvagent-skill-group{padding:6px 8px;border:1px solid color-mix(in srgb,var(--resume-accent-color) 18%,#e2e8f0);border-radius:var(--resume-corner-radius,4px);}',
      'h3{font-size:calc(' + fontSize + ' * 1.08) !important;}',
      '.resume-document.template-technical .cvagent-resume-page-content{border-left:8px solid var(--resume-accent-color) !important;}',
      '.resume-document.template-technical .header-block{padding-left:14px;border-bottom:0 !important;}',
      '.resume-document.template-editorial .header-block{padding:16px 18px;background:color-mix(in srgb,var(--resume-accent-color) 8%,transparent);border-bottom:0 !important;border-left:3px solid var(--resume-accent-color) !important;}',
      '.resume-document.template-editorial .cvagent-resume-section > h2{display:inline-block;padding:4px 10px;border:0 !important;background:color-mix(in srgb,var(--resume-accent-color) 7%,transparent);}',
      '.resume-document.template-terminal .cvagent-resume-page-content{background:linear-gradient(90deg,var(--resume-background-color) 0,var(--resume-background-color) 96%,#f1f5f9 96%) !important;}',
      '.resume-document.template-terminal .header-block{border-bottom:2px solid var(--resume-accent-color) !important;}',
      '.resume-document.template-terminal .cvagent-resume-section > h2{letter-spacing:.08em;text-transform:uppercase;border-bottom:0 !important;}',
      '@media print{.cvagent-resume-page{background:var(--bg) !important;}}',
    ].join('').replace(/\s*!important/g, '');
    const templateStyle = document.querySelector('[data-template-css]');
    const customStyle = document.querySelector('[data-template-custom-css]');
    document.head.insertBefore(visualStyle, templateStyle || customStyle || null);
    const manualTokenStyle = document.createElement('style');
    manualTokenStyle.setAttribute('data-cvagent-manual-tokens', 'true');
    manualTokenStyle.textContent = [
      'body{font-family:var(--resume-font-family) !important;line-height:' + lineHeight + ' !important;color:var(--resume-text-color) !important;}',
      '.cvagent-resume-page-content{padding:' + pageMargin + ' !important;}',
      '.cvagent-resume-section{margin-bottom:' + sectionGap + 'px !important;}',
      'p,li{font-size:' + fontSize + 'px;margin-bottom:' + template.spacing.paragraphGap + 'px;}',
    ].join('');
    document.head.append(manualTokenStyle);
    const contractStyle = document.createElement('style');
    contractStyle.setAttribute('data-cvagent-layout-contract', 'true');
    contractStyle.textContent = [
      'html,body{overflow-x:hidden !important;}',
      '.resume-document{min-height:0 !important;padding:0 !important;}',
      '.cvagent-resume-pages{display:flex !important;flex-direction:column !important;align-items:center !important;gap:18px !important;width:100% !important;}',
      '.cvagent-resume-page{box-sizing:border-box !important;width:794px !important;height:1123px !important;min-height:1123px !important;flex:0 0 1123px !important;margin:0 !important;overflow:hidden !important;}',
      '.cvagent-resume-page-content{box-sizing:border-box !important;width:100% !important;height:100% !important;overflow:hidden !important;}',
    ].join('');
    document.head.append(contractStyle);
    window.addEventListener('message', (event) => {
      if (event.data?.source === 'cvagent-resume-icon-tuning') {
        applyIconTuning(event.data.icons || {});
        return;
      }
      if (event.data?.source === 'cvagent-resume-layout-preview') {
        applyLayoutPreview(event.data.layout || {});
        return;
      }
      if (event.data?.source !== 'cvagent-resume-token-preview') return;
      applyVisualTokens(event.data.tokens || {});
      const css = typeof event.data.templateCss === 'string' ? event.data.templateCss : '';
      let workshopStyle = document.querySelector('[data-cvagent-workshop-css]');
      if (!css) {
        workshopStyle?.remove();
      } else {
        if (!workshopStyle) {
          workshopStyle = document.createElement('style');
          workshopStyle.setAttribute('data-cvagent-workshop-css', 'true');
          document.head.append(workshopStyle);
        }
        workshopStyle.textContent = css;
      }
    });
    const source = document.querySelector('.resume-content');
    if (!source) return;
    const root = source.querySelector('.cvagent-resume-root');
    const rootChildren = [...root?.children || []];
    const splitLayout = root?.querySelector(':scope > .cvagent-layout-split[data-layout-type="split"]');
    const gridLayout = root?.querySelector(':scope > .cvagent-layout-grid[data-layout-type="grid"]');
    const stackLayout = root?.querySelector(':scope > .cvagent-layout-stack[data-layout-type="stack"]');
    const splitMeta = splitLayout ? {
      headers: rootChildren.filter((node) => node !== splitLayout),
      columns: [...splitLayout.children].map((column) => ({
        id: column.dataset.region || column.className,
        prototype: column.cloneNode(false),
        items: [...column.children],
      })),
    } : null;
    const gridMeta = gridLayout ? {
      headers: rootChildren.filter((node) => node !== gridLayout),
      prototype: gridLayout.cloneNode(false),
      items: [...gridLayout.children],
    } : null;
    const stackMeta = stackLayout ? {
      headers: rootChildren.filter((node) => node !== stackLayout),
      prototype: stackLayout.cloneNode(false),
      items: [...stackLayout.children],
    } : null;
    const host = document.createElement('div');
    host.className = 'cvagent-resume-pages';
    source.replaceWith(host);
    const pages = [];
    let paginationOverflow = false;
    const makePage = (kind = 'single', includeHeaders = false, meta = null) => {
      const page = document.createElement('section');
      page.className = 'cvagent-resume-page';
      page.setAttribute('aria-label', '简历第 ' + (pages.length + 1) + ' 页');
      const content = document.createElement('div');
      content.className = 'cvagent-resume-page-content';
      page.append(content);
      host.append(page);
      const record = { page, content };
      if (kind === 'split' && meta) {
        if (includeHeaders) for (const header of meta.headers) content.append(header.cloneNode(true));
        const layout = splitLayout.cloneNode(false);
        layout.innerHTML = '';
        const columns = new Map();
        for (const column of meta.columns) {
          const clone = column.prototype.cloneNode(false);
          clone.innerHTML = '';
          layout.append(clone);
          columns.set(column.id, clone);
        }
        content.append(layout);
        const contentStyle = getComputedStyle(content);
        const paddingTop = Number.parseFloat(contentStyle.paddingTop) || 0;
        const paddingBottom = Number.parseFloat(contentStyle.paddingBottom) || 0;
        const headerHeight = includeHeaders ? content.querySelector('.header-block')?.getBoundingClientRect().height || 0 : 0;
        const columnHeight = Math.max(1, content.clientHeight - paddingTop - paddingBottom - headerHeight);
        for (const column of columns.values()) {
          column.style.height = columnHeight + 'px';
          column.style.maxHeight = columnHeight + 'px';
          column.style.overflow = 'hidden';
        }
        record.columns = columns;
      } else if ((kind === 'grid' || kind === 'stack') && meta) {
        if (includeHeaders) for (const header of meta.headers) content.append(header.cloneNode(true));
        const layout = meta.prototype.cloneNode(false);
        layout.innerHTML = '';
        content.append(layout);
        record.layout = layout;
      }
      pages.push(record);
      return record;
    };
    if (splitMeta) {
      if (!pages.length) makePage('split', true, splitMeta);
      const ensurePage = (index) => {
        while (pages.length <= index) makePage('split', pages.length === 0, splitMeta);
        return pages[index];
      };
      for (const columnMeta of splitMeta.columns) {
        let pageIndex = 0;
        for (const item of columnMeta.items) {
          let pageRecord = ensurePage(pageIndex);
          let column = pageRecord.columns.get(columnMeta.id);
          column.append(item);
          if (column.scrollHeight > column.clientHeight + 1 && column.children.length > 1) {
            column.removeChild(item);
            pageIndex += 1;
            pageRecord = ensurePage(pageIndex);
            column = pageRecord.columns.get(columnMeta.id);
            column.append(item);
          }
          if (column.scrollHeight > column.clientHeight + 1) paginationOverflow = true;
        }
      }
    } else if (gridMeta || stackMeta) {
      const flowMeta = gridMeta || stackMeta;
      const flowKind = gridMeta ? 'grid' : 'stack';
      let pageIndex = 0;
      const ensurePage = (index) => {
        while (pages.length <= index) makePage(flowKind, pages.length === 0, flowMeta);
        return pages[index];
      };
      if (!pages.length) makePage(flowKind, true, flowMeta);
      for (const item of flowMeta.items) {
        let pageRecord = ensurePage(pageIndex);
        pageRecord.layout.append(item);
        if (pageRecord.content.scrollHeight > pageRecord.content.clientHeight + 1 && pageRecord.layout.children.length > 1) {
          pageRecord.layout.removeChild(item);
          pageIndex += 1;
          pageRecord = ensurePage(pageIndex);
          pageRecord.layout.append(item);
        }
        if (pageRecord.content.scrollHeight > pageRecord.content.clientHeight + 1) paginationOverflow = true;
      }
    } else {
      const items = rootChildren;
      let content = makePage().content;
      for (const item of items) {
        content.append(item);
        if (content.scrollHeight > content.clientHeight + 1 && content.children.length > 1) {
          content.removeChild(item);
          content = makePage().content;
          content.append(item);
        }
        if (content.scrollHeight > content.clientHeight + 1) paginationOverflow = true;
      }
    }
    const fitSheets = () => {
      const availableWidth = Math.max(280, document.documentElement.clientWidth - 24);
      const baseWidth = 794;
      const scale = Math.min(1, availableWidth / baseWidth);
      for (const { page } of pages) {
        page.style.transformOrigin = 'top center';
        page.style.transform = 'scale(' + scale + ')';
        page.style.marginBottom = '-' + Math.round(page.offsetHeight * (1 - scale)) + 'px';
      }
    };
    fitSheets();
    window.addEventListener('resize', fitSheets);
    const overflow = paginationOverflow || pages.some(({ content }) => content.scrollHeight > content.clientHeight + 1);
      const pageMetrics = pages.map(({ content, page }, index) => {
        const contentRect = content.getBoundingClientRect();
        const contentStyle = getComputedStyle(content);
      const paddingTop = Number.parseFloat(contentStyle.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(contentStyle.paddingBottom) || 0;
      const availableHeight = Math.max(1, content.clientHeight - paddingTop - paddingBottom);
        // The preview sheet is scaled down when the iframe is narrower than
        // A4. getBoundingClientRect() then reports scaled pixels, while
        // clientHeight is still in the document's layout pixels. Normalize
        // all rect-based measurements back to the unscaled A4 coordinate
        // system before calculating blank space or occupancy.
        const layoutScale = content.offsetHeight ? Math.max(0.01, content.getBoundingClientRect().height / content.offsetHeight) : 1;
        const measuredNodes = [...content.querySelectorAll('.header-block,.cvagent-resume-section,.cvagent-business-entry')];
        const fallbackNodes = measuredNodes.length ? measuredNodes : [...content.children].filter((node) => !node.matches('.cvagent-layout-stack,.cvagent-layout-grid,.cvagent-layout-split'));
        const bottoms = fallbackNodes.map((node) => node.getBoundingClientRect().bottom).filter(Number.isFinite);
        const tops = fallbackNodes.map((node) => node.getBoundingClientRect().top).filter(Number.isFinite);
        const usedHeight = bottoms.length
          ? Math.max(0, (Math.max(...bottoms) - contentRect.top) / layoutScale - paddingTop)
          : 0;
        const topWhitespace = tops.length
          ? Math.max(0, (Math.min(...tops) - contentRect.top) / layoutScale - paddingTop)
          : availableHeight;
        const moduleNames = [...content.querySelectorAll('.cvagent-resume-section > h2')].map((node) => node.textContent?.trim()).filter(Boolean);
        const moduleDetails = [...content.querySelectorAll('.cvagent-resume-section')].map((node) => {
          const heading = node.querySelector(':scope > h2');
          return {
            id: node.dataset.moduleId || '',
            type: node.dataset.moduleType || 'custom-section',
            name: heading?.textContent?.trim() || node.dataset.moduleId || '未命名模块',
            top: Math.max(0, Math.round((node.getBoundingClientRect().top - contentRect.top) / layoutScale - paddingTop)),
            height: Math.max(0, Math.round(node.getBoundingClientRect().height / layoutScale)),
          };
        });
        return {
          page: index + 1,
          usedHeight,
          availableHeight,
          topWhitespace: Math.round(topWhitespace),
          bottomWhitespace: Math.max(0, Math.round(availableHeight - usedHeight)),
          occupancyRatio: Number((Math.min(usedHeight, availableHeight) / availableHeight).toFixed(3)),
          blankRatio: Math.max(0, Number((1 - Math.min(usedHeight, availableHeight) / availableHeight).toFixed(3))),
          modules: moduleNames,
          moduleDetails,
          overflow: content.scrollHeight > content.clientHeight + 1,
          width: page.offsetWidth,
          height: page.offsetHeight,
        };
      });
      const primaryPage = pageMetrics[0];
      // A resume that merely fits is not necessarily ready to submit. Keep a
      // small breathing margin, but reject visibly sparse one-page layouts.
      const targetBlankRatio = { min: 0.04, max: 0.10 };
      const maxAcceptableBlankRatio = targetBlankRatio.max;
      const occupancy = pageMetrics.map((page) => page.occupancyRatio);
      const visualWarnings = [];
      if (primaryPage?.bottomWhitespace > primaryPage.availableHeight * 0.18) visualWarnings.push({ code: 'bottom-whitespace', message: '页面底部留白偏多' });
      if (primaryPage?.topWhitespace > primaryPage.availableHeight * 0.12) visualWarnings.push({ code: 'top-whitespace', message: '页面顶部留白偏多' });
      if (pages.length > 1 && pageMetrics.some((page) => page.moduleDetails.length === 1)) visualWarnings.push({ code: 'isolated-module', message: '存在只有一个模块的页面，建议检查分页' });
      const balanceState = overflow
        ? 'overflow'
        : pages.length > 1
          ? 'multi-page'
          : (primaryPage?.blankRatio || 0) > maxAcceptableBlankRatio
            ? 'sparse'
            : visualWarnings.length
              ? 'needs-review'
              : 'balanced';
      const visualAudit = {
        state: balanceState,
        occupancy,
        warnings: visualWarnings,
        moduleCount: pageMetrics.reduce((count, page) => count + page.moduleDetails.length, 0),
        pageBalance: pages.length === 1 ? Number((1 - Math.abs((primaryPage?.occupancyRatio || 0) - 0.92)).toFixed(3)) : null,
      };
      const sparse = !overflow && pages.length === 1 && (primaryPage?.blankRatio || 0) > maxAcceptableBlankRatio;
    if (!isThumbnail) {
      const resumeDocument = document.querySelector('.resume-document');
      const metricPayload = {
        source: 'cvagent-resume-preview',
        previewRoot: resumeDocument?.dataset.previewRoot || '',
        previewPath: resumeDocument?.dataset.previewPath || '',
        renderId: resumeDocument?.dataset.renderId || '',
        contentHash: resumeDocument?.dataset.contentHash || '',
        metrics: {
          pageCount: pages.length,
          overflow,
          sparse,
          fit: !overflow && pages.length === 1 && !sparse,
          targetBlankRatio,
          visualAudit,
          pageWidth: 794,
          pageHeight: 1123,
          pages: pageMetrics,
        },
      };
      window.__cvagentMetrics = metricPayload;
      // The parent workbench owns the session and persists measurements after
      // verifying that this renderId is still current.
      window.parent?.postMessage(metricPayload, '*');
    }
    document.documentElement.dataset.pageCount = String(pages.length);
    document.documentElement.dataset.pageOverflow = String(overflow);
  })();
  </script>
</body>
</html>
`
}
