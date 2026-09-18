import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const frontendRoot = path.resolve(import.meta.dirname, '..', '..', 'frontend')

test('frontend keeps Markdown/A4 in the workbench and Agent as a full-height peer', async () => {
  const html = await fs.readFile(path.join(frontendRoot, 'index.html'), 'utf8')
  const css = await fs.readFile(path.join(frontendRoot, 'styles.css'), 'utf8')
  assert.match(html, /<section class="route-view" id="routeView"[\s\S]*?<div class="route-content" id="routeContent"><\/div><\/section>[\s\S]*?<\/main>[\s\S]*?class="resize-handle resize-assistant"[\s\S]*?id="assistantDrawer"/)
  assert.match(css, /\.app-shell\.assistant-open \{ grid-template-columns:var\(--sidebar-width\) 1px minmax\(0,1fr\) 1px var\(--assistant-width\); \}/)
  assert.match(css, /\.app-shell\.assistant-open \.assistant-drawer \{ position:static; grid-column:5; grid-row:1; width:auto; height:100%;/)
  assert.match(css, /\.app-shell\.assistant-open \.resize-assistant \{ grid-column:4; grid-row:1; display:block; \}/)
  assert.match(css, /\.app-shell \{ border:1px solid #e2e5e9; border-radius:10px;/)
  assert.match(css, /\.editor-pane \{ border-right:1px solid var\(--workbench-seam\); background:#fff; \}/)
  assert.match(css, /\.editor-pane \.editor-layout \{ padding:0 0 10px; \}/)
  assert.match(css, /\.editor-layout textarea \{ margin:0; padding:16px; border:0; border-radius:0;/)
  assert.match(css, /\.editor-foot \{ padding:8px 16px 0; border-top:1px solid var\(--workbench-weak\); \}/)
  assert.match(css, /\.direct-preview-stage \{ padding:8px; background:var\(--canvas\); \}/)
  assert.match(css, /\.direct-preview-foot \{ padding:8px 16px; border-top-color:var\(--workbench-weak\); \}/)
  assert.match(css, /@media \(min-width:901px\) \{[\s\S]*?\.app-shell:not\(\.assistant-open\) \.workbench-view \{ padding-right:0; padding-bottom:0; padding-left:0; \}[\s\S]*?\.app-shell:not\(\.assistant-open\) \.workbench-split \{ height:calc\(100dvh - 85px\); \}/)
  assert.match(css, /@media \(min-width:901px\) \{[\s\S]*?\.app-shell\.assistant-open \.workbench-split \{ height:calc\(100dvh - 71px\); \}/)
  assert.match(css, /\.resize-handle \{[\s\S]*?width:1px; min-width:1px;/)
  assert.match(css, /\.resize-handle::before \{[\s\S]*?left:0; width:1px;[\s\S]*?opacity:1;/)
  assert.match(css, /\.resize-handle::after \{[\s\S]*?left:-4px; width:9px;/)
  assert.match(css, /\.assistant-drawer \.drawer-header \{[\s\S]*?display:flex;[\s\S]*?border-bottom:1px solid #e8eaed;/)
  assert.match(css, /\.assistant-drawer \.assistant-context \{ display:none; \}/)
  assert.match(css, /\.assistant-drawer #assistantContent \{ height:calc\(100% - 51px\); \}/)
})

test('frontend moves the full-height Agent below the workbench on narrow screens', async () => {
  const css = await fs.readFile(path.join(frontendRoot, 'styles.css'), 'utf8')
  assert.match(css, /\.app-shell\.assistant-open \.main-stage \{ grid-column:3; grid-row:1; height:auto; min-height:100vh; \}/)
  assert.match(css, /\.app-shell\.assistant-open \.assistant-drawer \{ grid-column:1 \/ -1; grid-row:2; width:auto; height:min\(680px,70dvh\);/)
  assert.match(css, /\.app-shell\.assistant-open \.resize-assistant \{ display:none; \}/)
})

test('frontend keeps three columns for desktop-sized 961-1100px viewports', async () => {
  const css = await fs.readFile(path.join(frontendRoot, 'styles.css'), 'utf8')
  assert.match(css, /@media \(min-width:961px\) and \(max-width:1100px\) \{[\s\S]*?grid-template-columns:var\(--sidebar-width\) 1px minmax\(0,1fr\) 1px minmax\(280px,min\(var\(--assistant-width\),32vw\)\);/)
  assert.match(css, /@media \(min-width:961px\) \{[\s\S]*?\.app-shell\.assistant-open \.workbench-split \{ display:grid; width:100%; min-width:0; grid-template-columns:minmax\(280px,var\(--editor-width,1fr\)\) 1px minmax\(280px,1fr\); \}/)
  assert.match(css, /\.app-shell\.assistant-open \.direct-preview-pane \{ grid-column:auto; grid-row:auto; \}/)
  assert.match(css, /@media \(min-width:961px\) and \(max-width:1100px\) \{[\s\S]*?\.app-shell\.assistant-open \.workbench-split \{ grid-template-columns:minmax\(0,1fr\) 1px minmax\(0,1fr\); \}/)
  assert.match(css, /\.app-shell\.assistant-open \.workbench-split \{ width:100%; height:calc\(100dvh - 122px\); grid-template-columns:minmax\(0,var\(--editor-width,1fr\)\) 1px minmax\(0,1fr\); \}/)
})

test('frontend keeps the measured A4 fit when Agent is open on desktop widths', async () => {
  const css = await fs.readFile(path.join(frontendRoot, 'styles.css'), 'utf8')
  const app = await fs.readFile(path.join(frontendRoot, 'app.js'), 'utf8')
  assert.match(css, /@media \(min-width:961px\) \{[\s\S]*?\.app-shell\.assistant-open \.workbench-split \{ display:grid; width:100%; min-width:0; grid-template-columns:minmax\(280px,var\(--editor-width,1fr\)\) 1px minmax\(280px,1fr\); \}/)
  assert.match(css, /\.app-shell\.assistant-open \.direct-preview-frame-wrap,[\s\S]*?width:var\(--preview-width,429px\); height:var\(--preview-height,607px\); transform:none;/)
  assert.match(css, /\.app-shell\.assistant-open \.direct-preview-frame-wrap iframe,[\s\S]*?transform:scale\(var\(--preview-scale,.54\)\);/)
  assert.match(app, /const WORKBENCH_MIN_PANE_WIDTH = 280/)
  assert.match(app, /const WORKBENCH_SCROLLBAR_RESERVE = 10/)
  assert.match(app, /function normalizeDesktopLayoutPrefs\(\)/)
  assert.match(app, /normalizeDesktopLayoutPrefs\(\)[\s\S]*?applyLayoutPrefs\(\)/)
})

test('frontend route changes reset scroll and SSE proxy tolerates client disconnects', async () => {
  const app = await fs.readFile(path.join(frontendRoot, 'app.js'), 'utf8')
  const proxy = await fs.readFile(path.join(frontendRoot, 'server.mjs'), 'utf8')
  assert.match(app, /function renderRoute\(route\) \{[\s\S]*?\$\('#routeView'\)\.scrollTop = 0/)
  assert.match(app, /async function renderTemplates\(\) \{[\s\S]*?const viewport = \$\('#routeView'\)[\s\S]*?viewport\.scrollTop = 0/)
  assert.match(proxy, /if \(response\.headersSent \|\| response\.destroyed \|\| response\.writableEnded \|\| request\.aborted\)/)
  assert.match(proxy, /proxyLog\('info', 'api_proxy_client_closed'/)
})

test('React/Vite shell preserves the legacy DOM contract while migration is staged', async () => {
  const reactRoot = path.join(frontendRoot, 'react')
  const packageJson = JSON.parse(await fs.readFile(path.join(reactRoot, 'package.json'), 'utf8'))
  const source = await fs.readFile(path.join(reactRoot, 'src', 'main.tsx'), 'utf8')
  const viteConfig = await fs.readFile(path.join(reactRoot, 'vite.config.ts'), 'utf8')
  const proxy = await fs.readFile(path.join(frontendRoot, 'server.mjs'), 'utf8')
  assert.equal(packageJson.scripts.build, 'tsc --noEmit && vite build')
  assert.equal(packageJson.scripts.typecheck, 'tsc --noEmit')
  assert.match(source, /id="appShell"/)
  assert.match(source, /id="routeContent"/)
  assert.match(source, /id="assistantDrawer"/)
  assert.match(source, /className="workbench|className="resize-handle resize-sidebar"/)
  assert.match(source, /const scripts = \['api-client\.js', 'client-events\.js', 'agent-chat\.js', 'app\.js'\]/)
  assert.match(viteConfig, /base: '\/react\/'/)
  assert.match(proxy, /const reactDist = join\(root, 'react', 'dist'\)/)
  assert.match(proxy, /const reactRequest = url\.pathname === '\/react' \|\| url\.pathname\.startsWith\('\/react\/'\)/)
})
