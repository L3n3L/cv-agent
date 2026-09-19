(() => {
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {})
    headers.set('accept', 'application/json')
    if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
    const response = await fetch(path, { ...options, headers })
    const requestId = response.headers.get('x-cvagent-request-id') || ''
    const contentType = response.headers.get('content-type') || ''
    const body = contentType.includes('application/json') ? await response.json() : await response.text()
    if (!response.ok || (body && typeof body === 'object' && body.ok === false)) {
      const error = new Error(body?.errorMessage || body?.error || `请求失败（${response.status}）`)
      error.code = body?.errorCode || `HTTP_${response.status}`
      error.requestId = requestId
      error.status = response.status
      throw error
    }
    return { body, requestId }
  }

  window.cvAgentApi = Object.freeze({
    get: (path) => request(path),
    post: (path, payload) => request(path, { method: 'POST', body: JSON.stringify(payload) }),
  })
})()
