import { getPresentationOverride } from '../migrated/resume-engine/presentation.js'
import { TASK_STATES } from '../core/workflow.js'

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function currentLayout(template, presentation, resumePath) {
  const override = getPresentationOverride(presentation, template.id, resumePath)
  return {
    fontSize: numberOr(override.layout?.fontSize, numberOr(template.typography?.fontSize, 14)),
    lineHeight: numberOr(override.layout?.lineHeight, numberOr(template.typography?.lineHeight, 1.55)),
    sectionGap: numberOr(override.layout?.sectionGap, numberOr(template.spacing?.sectionGap, 20)),
    pageMargin: numberOr(override.layout?.pageMargin, numberOr(template.spacing?.pageMargin, 48)),
  }
}

// A suggestion is deliberately bounded and explainable. It never writes a
// presentation override; the agent must show it and explicitly call
// presentation_update only after the user agrees.
export function suggestPresentationAdjustment({ task, template, presentation, resumePath, round = 1 }) {
  const measurement = task?.measurements
  if (![TASK_STATES.MEASURED, TASK_STATES.NEEDS_REVISION, TASK_STATES.ACCEPTED].includes(task?.state)) {
    const error = new Error('presentation suggestions are available only after a current measurement')
    error.code = 'MEASUREMENT_REQUIRED'
    throw error
  }
  if (!measurement || measurement.renderId !== task?.context?.renderId) {
    const error = new Error('a current browser measurement is required before proposing layout changes')
    error.code = 'MEASUREMENT_REQUIRED'
    throw error
  }
  const layout = currentLayout(template, presentation, resumePath)
  const occupancy = Array.isArray(measurement.occupancy) ? measurement.occupancy : []
  const minimum = occupancy.length ? Math.min(...occupancy) : 0
  const maximum = occupancy.length ? Math.max(...occupancy) : 0
  const patch = { layout: {} }
  const reasons = []

  if (measurement.overflow || maximum > 1) {
    patch.layout = {
      fontSize: Math.max(11, Number((layout.fontSize - 0.4).toFixed(1))),
      lineHeight: Math.max(1.2, Number((layout.lineHeight - 0.05).toFixed(2))),
      sectionGap: Math.max(6, Math.round(layout.sectionGap - 2)),
      pageMargin: Math.max(24, Math.round(layout.pageMargin - 2)),
    }
    reasons.push('真实测量显示溢出，先收紧排版而不删减核心证据。')
  } else if (minimum < task.acceptance.minOccupancy) {
    patch.layout = {
      fontSize: Math.min(18, Number((layout.fontSize + 0.3).toFixed(1))),
      lineHeight: Math.min(2, Number((layout.lineHeight + 0.04).toFixed(2))),
      sectionGap: Math.min(30, Math.round(layout.sectionGap + 2)),
      pageMargin: Math.min(72, Math.round(layout.pageMargin + 2)),
    }
    reasons.push('真实测量显示页面密度不足，先放宽排版而不是添加装饰性内容。')
  } else if (occupancy.length > 1 && maximum - minimum > task.acceptance.maxSpread) {
    patch.layout = { sectionGap: Math.max(6, Math.round(layout.sectionGap - 1)) }
    reasons.push('多页密度不均，建议先微调段落间距；仍不均衡时再审查内容分配。')
  } else {
    return { needsAdjustment: false, round, measurement, patch: null, reasons: ['当前真实测量已满足页数、密度、溢出和均衡要求，不建议继续微调。'] }
  }
  return { needsAdjustment: true, round, measurement, patch, reasons, requiresUserConfirmation: true }
}
