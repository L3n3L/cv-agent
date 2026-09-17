import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const frontendRoot = path.resolve(import.meta.dirname, '..', '..', 'frontend')

test('frontend keeps the editor, resize handle, and preview in three tracks with Agent open', async () => {
  const css = await fs.readFile(path.join(frontendRoot, 'styles.css'), 'utf8')
  assert.match(css, /\.assistant-open \.workbench-split \{ grid-template-columns:minmax\(260px,\.9fr\) 8px minmax\(280px,1\.1fr\); \}\s*\.assistant-open \.direct-preview-frame-wrap/)
  assert.match(css, /\.app-shell\.sidebar-collapsed\.assistant-open \{ grid-template-columns:0 0 minmax\(0,1fr\) 8px var\(--assistant-width\); \}/)
})

test('frontend route changes reset scroll and SSE proxy tolerates client disconnects', async () => {
  const app = await fs.readFile(path.join(frontendRoot, 'app.js'), 'utf8')
  const proxy = await fs.readFile(path.join(frontendRoot, 'server.mjs'), 'utf8')
  assert.match(app, /function renderRoute\(route\) \{[\s\S]*?\$\('#routeView'\)\.scrollTop = 0/)
  assert.match(app, /async function renderTemplates\(\) \{[\s\S]*?view\.scrollTop = 0/)
  assert.match(proxy, /if \(response\.headersSent \|\| response\.destroyed \|\| response\.writableEnded \|\| request\.aborted\)/)
  assert.match(proxy, /proxyLog\('info', 'api_proxy_client_closed'/)
})
