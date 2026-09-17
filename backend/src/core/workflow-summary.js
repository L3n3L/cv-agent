const SUMMARY_STRING_KEYS = new Set([
  'fileName',
  'templateId',
  'templateRevision',
  'state',
  'contentVersion',
  'renderId',
])

const SUMMARY_NUMBER_KEYS = new Set([
  'targetPages',
  'fileCount',
  'bytes',
  'headingCount',
  'score',
  'warningCount',
  'templateCount',
  'pageCount',
  'blockerCount',
])

const SUMMARY_BOOLEAN_KEYS = new Set([
  'prepared',
  'truncated',
  'passed',
  'sourcePreserved',
  'createdAsCopy',
])

const MAX_SUMMARY_STRING_LENGTH = 120
const MAX_OCCUPANCY_VALUES = 10

function safeSummaryString(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_SUMMARY_STRING_LENGTH)
}

function safeFileName(value) {
  const normalized = safeSummaryString(value).replace(/\\/g, '/')
  return normalized.split('/').at(-1) || ''
}

/**
 * Keep workflow details useful for the UI without persisting arbitrary tool
 * output, resume content, absolute paths, or nested model payloads.
 */
export function safeWorkflowSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const result = {}
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'path') {
      const fileName = safeFileName(value)
      if (fileName) result.fileName = fileName
      continue
    }
    if (SUMMARY_STRING_KEYS.has(key)) {
      const safe = safeSummaryString(value)
      if (safe) result[key] = safe
      continue
    }
    if (SUMMARY_NUMBER_KEYS.has(key)) {
      const number = Number(value)
      if (Number.isFinite(number)) result[key] = number
      continue
    }
    if (SUMMARY_BOOLEAN_KEYS.has(key) && typeof value === 'boolean') {
      result[key] = value
      continue
    }
    if (key === 'occupancy' && Array.isArray(value)) {
      const values = value
        .slice(0, MAX_OCCUPANCY_VALUES)
        .map(Number)
        .filter((item) => Number.isFinite(item))
      if (values.length) result[key] = values
    }
  }
  return Object.keys(result).length ? result : null
}
