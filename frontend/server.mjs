import { createServer } from 'node:http'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.CVAGENT_DEMO_PORT || 3191)
const apiOrigin = String(process.env.CVAGENT_API_ORIGIN || 'http://127.0.0.1:3180').replace(/\/+$/, '')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

function proxyLog(level, event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event, component: 'cvagent-demo-proxy', ...fields })}\n`)
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function proxyApi(request, response, url) {
  const requestId = String(request.headers['x-cvagent-request-id'] || `proxy_${crypto.randomUUID()}`)
  const startedAt = Date.now()
  const target = `${apiOrigin}${url.pathname}${url.search}`
  const headers = new Headers()
  for (const name of ['accept', 'content-type', 'if-none-match']) {
    const value = request.headers[name]
    if (typeof value === 'string' && value) headers.set(name, value)
  }
  headers.set('x-cvagent-request-id', requestId)
  try {
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readRequestBody(request)
    const upstream = await fetch(target, { method: request.method, headers, body })
    const responseHeaders = { 'cache-control': 'no-store', 'x-cvagent-request-id': requestId }
    const contentType = upstream.headers.get('content-type')
    if (contentType) responseHeaders['content-type'] = contentType
    response.writeHead(upstream.status, responseHeaders)
    response.end(Buffer.from(await upstream.arrayBuffer()))
    proxyLog('info', 'api_proxy_finished', { requestId, method: request.method, route: url.pathname, statusCode: upstream.status, durationMs: Date.now() - startedAt })
  } catch (error) {
    response.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-cvagent-request-id': requestId })
    response.end(JSON.stringify({ ok: false, error: 'api_unavailable', requestId }))
    proxyLog('error', 'api_proxy_failed', { requestId, method: request.method, route: url.pathname, durationMs: Date.now() - startedAt, errorCode: String(error?.code || 'API_PROXY_FAILED'), errorMessage: String(error?.message || error).slice(0, 500) })
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    await proxyApi(request, response, url)
    return
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname
  const file = normalize(join(root, requested))
  if (!file.startsWith(root)) { response.writeHead(403); response.end('Forbidden'); return }
  try { const body = await readFile(file); response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(body) }
  catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not Found') }
}).listen(port, '127.0.0.1', () => console.log(`CVAgent Demo v2: http://127.0.0.1:${port}/`))
