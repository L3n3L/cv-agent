export async function readJsonBody(request, limit = 512 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('request body is too large'), { code: 'REQUEST_TOO_LARGE' })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw Object.assign(new Error('request body must be valid JSON'), { code: 'INVALID_JSON' })
  }
}

export function parseJsonBody(schema, body, code = 'REQUEST_INVALID') {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  const message = result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
  throw Object.assign(new Error(message), { code })
}

export function sendJson(response, status, body) {
  if (status >= 400) response.__cvagentErrorCode = String(body?.errorCode || body?.error || `HTTP_${status}`)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

export function requestRoute(url = '/') {
  try {
    return new URL(url, 'http://127.0.0.1').pathname
  } catch {
    return '/invalid-url'
  }
}
