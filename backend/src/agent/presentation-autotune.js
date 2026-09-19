import { getPresentationOverride } from '../migrated/resume-engine/presentation.js'
import { TASK_STATES } from '../core/workflow.js'

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
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

function assertCurrentMeasurement(task, roundNumber) {
  if (![TASK_STATES.MEASURED, TASK_STATES.NEEDS_REVISION, TASK_STATES.ACCEPTED].includes(task?.state)) {
    throw Object.assign(new Error('template autotune requires a current browser measurement'), { code: 'MEASUREMENT_REQUIRED' })
  }
  if (!task.measurements || task.measurements.renderId !== task?.context?.renderId) {
    throw Object.assign(new Error('template autotune requires metrics for the current renderId'), { code: 'MEASUREMENT_REQUIRED' })
  }
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 3) {
    throw Object.assign(new Error('autotune round must be an integer from 1 to 3'), { code: 'AUTOTUNE_ROUND_INVALID' })
  }
}

/**
 * DSH-compatible bounded tuning adapted to CVAgent's per-resume presentation.
 * It returns a patch; the caller owns persistence and workflow invalidation.
 */
export function autoTunePresentation({ task, template, presentation, resumePath, round: roundNumber = 1 }) {
  assertCurrentMeasurement(task, roundNumber)
  const measurement = task.measurements
  const layout = currentLayout(template, presentation, resumePath)
  const occupancy = Array.isArray(measurement.occupancy) ? measurement.occupancy : []
  const minimum = occupancy.length ? Math.min(...occupancy) : 0
  const maximum = occupancy.length ? Math.max(...occupancy) : 0
  const spread = occupancy.length > 1 ? maximum - minimum : 0
  const sparse = minimum < numberOr(task.acceptance?.minOccupancy, 0.9)
  const tooManyPages = Number(measurement.pageCount) > Number(task.targetPages || 1) || occupancy.length > Number(task.targetPages || 1)
  const changes = []
  const patch = { layout: {} }

  if (tooManyPages || measurement.overflow || maximum > 1) {
    const pageMargin = Math.max(24, round(layout.pageMargin - 2))
    patch.layout.pageMargin = pageMargin
    changes.push(`页边距 ${layout.pageMargin}px → ${pageMargin}px`)
    if (roundNumber >= 2) {
      const sectionGap = Math.max(6, Math.round(layout.sectionGap - 2))
      patch.layout.sectionGap = sectionGap
      changes.push(`模块间距 ${layout.sectionGap}px → ${sectionGap}px`)
    }
    if (roundNumber >= 3) {
      const fontSize = Math.max(11, round(layout.fontSize - 0.5, 1))
      patch.layout.fontSize = fontSize
      changes.push(`字号 ${layout.fontSize}px → ${fontSize}px`)
    }
  } else if (sparse) {
    const fontSize = Math.min(18, round(layout.fontSize + 0.5, 1))
    patch.layout.fontSize = fontSize
    changes.push(`字号 ${layout.fontSize}px → ${fontSize}px`)
    if (roundNumber >= 2) {
      const sectionGap = Math.min(30, Math.round(layout.sectionGap + 2))
      patch.layout.sectionGap = sectionGap
      changes.push(`模块间距 ${layout.sectionGap}px → ${sectionGap}px`)
    }
    if (roundNumber >= 3) {
      const pageMargin = Math.min(72, Math.round(layout.pageMargin + 2))
      patch.layout.pageMargin = pageMargin
      changes.push(`页边距 ${layout.pageMargin}px → ${pageMargin}px`)
    }
  } else if (occupancy.length > 1 && spread > numberOr(task.acceptance?.maxSpread, 0.08)) {
    const sectionGap = Math.max(6, Math.round(layout.sectionGap - 1))
    patch.layout.sectionGap = sectionGap
    changes.push(`模块间距 ${layout.sectionGap}px → ${sectionGap}px`)
  }

  if (!changes.length) {
    return {
      changed: false,
      round: roundNumber,
      measurement,
      patch: null,
      changes: [],
      reason: '当前真实测量已经满足排版密度和页面平衡要求，不需要自动调参。',
    }
  }

  return {
    changed: true,
    round: roundNumber,
    measurement,
    patch,
    changes,
    reason: tooManyPages || measurement.overflow || maximum > 1
      ? '检测到溢出，按 DSH 规则逐轮收紧排版参数。'
      : sparse
        ? '检测到页面密度不足，按 DSH 规则逐轮增加可读密度。'
        : '检测到多页密度差异，先收紧模块间距。',
  }
}
