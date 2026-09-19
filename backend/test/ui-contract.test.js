import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..')

test('React is the only web entry and backend does not serve a page copy', async () => {
  const shell = await fs.readFile(path.join(root, 'frontend/react/src/main.tsx'), 'utf8')
  const proxy = await fs.readFile(path.join(root, 'frontend/server.mjs'), 'utf8')
  const backend = await fs.readFile(path.join(root, 'backend/src/server.js'), 'utf8')

  assert.match(shell, /createRoot\(document\.getElementById\('root'\)!\)/)
  assert.match(shell, /function loadRuntimeModules\(\)/)
  assert.doesNotMatch(shell, /loadLegacyScripts|加载旧业务模块|legacyBase/)
  assert.match(proxy, /if \(url\.pathname === '\/'\) \{[\s\S]*?location: '\/react\/'/)
  assert.match(proxy, /const publicRoot = reactDist/)
  assert.doesNotMatch(proxy, /const rootRequest|publicRoot = reactRequest \|\| rootRequest \? reactDist : root/)
  assert.doesNotMatch(backend, /serveStatic|const publicRoot/)
  await assert.rejects(fs.access(path.join(root, 'backend/public')), { code: 'ENOENT' })
  await assert.rejects(fs.access(path.join(root, 'frontend/index.html')), { code: 'ENOENT' })
})

test('React runtime owns the migrated shared modules and styles', async () => {
  const shell = await fs.readFile(path.join(root, 'frontend/react/src/main.tsx'), 'utf8')
  for (const file of ['api-client.js', 'client-events.js', 'agent-chat.js', 'workbench-runtime.js']) {
    await fs.access(path.join(root, 'frontend/react/src/runtime', file))
    assert.match(shell, new RegExp(`runtime/${file.replace('.', '\\.')}`))
  }
  await fs.access(path.join(root, 'frontend/react/src/styles.css'))
  assert.match(shell, /import '\.\/styles\.css'/)
  assert.doesNotMatch(shell, /unmountLegacyReactPanes|legacy-bridge/)
})
