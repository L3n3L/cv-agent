(() => {
  const endpoint = '/api/client-events'
  const limit = (value, max) => String(value || '').slice(0, max)
  const scrub = (value) => limit(value, 4000)
    .replace(/\b[A-Za-z]:\\[^\s)]+/g, '[PATH]')
    .replace(/\/(?:Users|home|private|tmp)\/[^\s)]+/g, '[PATH]')
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/\bbearer\s+[^\s,;)]+/gi, 'Bearer [REDACTED]')
  const id = () => globalThis.crypto?.randomUUID?.() || `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

  function reportClientEvent(event, details = {}) {
    const payload = {
      event,
      message: limit(details.message || 'Unknown client error', 500),
      source: limit(details.source, 300),
      stack: scrub(details.stack),
      route: limit(location.pathname, 200),
      clientEventId: id(),
      line: Number.isInteger(details.line) ? details.line : undefined,
      column: Number.isInteger(details.column) ? details.column : undefined,
      userAgent: limit(navigator.userAgent, 300),
    }
    const body = JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== '')))
    try {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon?.(endpoint, blob)) return
      void fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
    } catch {}
  }

  globalThis.CVAgent = globalThis.CVAgent || {}
  globalThis.CVAgent.reportClientEvent = reportClientEvent

  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) {
      const target = event.target
      reportClientEvent('resource_error', { message: `Failed to load ${target.tagName || 'resource'}`, source: target.currentSrc || target.src || target.href })
      return
    }
    reportClientEvent('client_error', { message: event.message, source: event.filename, stack: event.error?.stack, line: event.lineno, column: event.colno })
  }, true)
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    reportClientEvent('unhandled_rejection', { message: reason?.message || String(reason || 'Unhandled promise rejection'), stack: reason?.stack })
  })
})()
