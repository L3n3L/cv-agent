/**
 * Deterministic resume semantics shared by the quality gate and renderer.
 *
 * Markdown headings are user/model authored, but the meaning of a section is
 * product data. Keeping this mapping in one place prevents the renderer and
 * the acceptance gate from disagreeing about sections such as “荣誉奖项”.
 */

const SECTION_PATTERNS = Object.freeze([
  { module: 'education', patterns: [/教育/, /学历/, /academic/i, /education/i, /school/i, /university/i] },
  { module: 'experience', patterns: [/实习/, /工作经历/, /工作经验/, /任职/, /experience/i, /employment/i, /intern/i, /work/i] },
  { module: 'projects', patterns: [/项目/, /作品/, /project/i, /portfolio/i, /case study/i] },
  { module: 'skills', patterns: [/技能/, /技术栈/, /专业能力/, /skill/i, /technology/i, /tech stack/i] },
  { module: 'awards', patterns: [/获奖/, /荣誉/, /奖项/, /证书/, /award/i, /honor/i, /certificate/i] },
  { module: 'links', patterns: [/链接/, /link/i, /github/i, /website/i] },
  { module: 'summary', patterns: [/简介/, /自我评价/, /个人总结/, /summary/i, /profile/i, /about/i, /objective/i] },
  { module: 'photo', patterns: [/头像/, /照片/, /photo/i, /avatar/i] },
])

const ICON_MODULES = Object.freeze({
  school: 'education',
  work: 'experience',
  code: 'skills',
  trophy: 'awards',
})

const CANONICAL_ORDER = Object.freeze(['summary', 'education', 'experience', 'projects', 'skills', 'awards'])

function stripMarkdown(value) {
  return String(value || '')
    .replace(/\[icon:[a-z0-9_-]+\]/gi, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function inferResumeModule(heading) {
  const value = stripMarkdown(heading)
  return SECTION_PATTERNS.find(({ patterns }) => patterns.some((pattern) => pattern.test(value)))?.module || null
}

export function extractResumeSections(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
  return lines.flatMap((line, index) => {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (!match) return []
    const heading = match[1].trim()
    const icons = [...heading.matchAll(/\[icon:([a-z0-9_-]+)\]/gi)].map((item) => item[1].toLowerCase())
    return [{ line: index + 1, rawHeading: heading, heading: stripMarkdown(heading), module: inferResumeModule(heading), icons }]
  })
}

export function analyzeResumeStructure(content) {
  const sections = extractResumeSections(content)
  const recognized = sections.filter((section) => section.module)
  const errors = []
  const warnings = []

  for (const section of sections) {
    const mismatchedIcons = section.icons.filter((icon) => ICON_MODULES[icon] && ICON_MODULES[icon] !== section.module)
    if (mismatchedIcons.length) {
      const expectedModule = ICON_MODULES[mismatchedIcons[0]]
      errors.push({
        id: 'section.semantic-icon',
        line: section.line,
        message: `“${section.heading}”被识别为${section.module}模块，却使用了属于${expectedModule}模块的图标：${mismatchedIcons.map((icon) => `[icon:${icon}]`).join('、')}`,
        detail: '图标不能改变模块语义；请使用对应图标，或删除装饰性图标。',
      })
    }
    if (!section.module && section.heading) {
      warnings.push({
        id: 'section.unrecognized',
        line: section.line,
        message: `未识别简历模块“${section.heading}”，将按自定义模块渲染。`,
        detail: '建议使用教育经历、实习经历、项目经历、技能、荣誉奖项等明确标题。',
      })
    }
  }

  const positions = new Map()
  recognized.forEach((section, index) => {
    if (!positions.has(section.module)) positions.set(section.module, { index, line: section.line })
  })
  const presentOrder = recognized.map((section) => section.module)
  for (let left = 0; left < presentOrder.length; left += 1) {
    for (let right = left + 1; right < presentOrder.length; right += 1) {
      const leftModule = presentOrder[left]
      const rightModule = presentOrder[right]
      const leftRank = CANONICAL_ORDER.indexOf(leftModule)
      const rightRank = CANONICAL_ORDER.indexOf(rightModule)
      if (leftRank >= 0 && rightRank >= 0 && leftRank > rightRank) {
        errors.push({
          id: 'section.order',
          line: recognized[left].line,
          message: `简历模块顺序不符合标准投递版：${leftModule} 应位于 ${rightModule} 之后。`,
          detail: `建议顺序：${CANONICAL_ORDER.join(' → ')}。缺失模块可以跳过。`,
        })
      }
    }
  }

  return {
    passed: errors.length === 0,
    sections,
    recognizedModules: recognized.map((section) => section.module),
    canonicalOrder: [...CANONICAL_ORDER],
    errors,
    warnings,
  }
}
