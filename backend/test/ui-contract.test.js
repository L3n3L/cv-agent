import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

test('workbench has one source for visible controls and no legacy layout overrides', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8')
  const css = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8')
  const workbenchCss = await fs.readFile(path.join(root, 'public/workbench.css'), 'utf8')
  const app = await fs.readFile(path.join(root, 'public/app.js'), 'utf8')
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  assert.deepEqual(duplicates, [])
  for (const className of ['cj-workbench', 'cj-workbenchBody', 'cj-nav', 'cj-mainBar', 'cj-previewWorkspace', 'cj-editorText', 'cj-editorPreviewFrame']) {
    assert.match(html, new RegExp(`class="[^"]*${className}`))
  }
  assert.match(app, /setView\('workbench'\)\s*\n\s*setPreview\(\)/)
  assert.match(app, /function syncTemplateLabels\(\)/)
  assert.match(app, /async function loadSessions\(\)/)
  assert.match(app, /async function restoreSession\(id\)/)
  assert.match(html, /id="sessionSelect"/)
  assert.match(app, /const renderId = payload\?\.renderId \|\| payload\?\.metrics\?\.renderId/)
  assert.match(app, /body: JSON\.stringify\(\{\s*sessionId,\s*renderId,/)
  assert.match(workbenchCss, /\.cj-workbench\s*\{[\s\S]*font-family:\s*-apple-system/)
})

test('legacy selectors cannot override the parity editor and preview panes', async () => {
  const css = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8')
  assert.doesNotMatch(css, /\.workbench-grid\s*\{/)
  assert.doesNotMatch(css, /#markdownContent\s*\{/)
  assert.doesNotMatch(css, /\.preview-stage\s*\{/)
  assert.doesNotMatch(css, /#previewFrame\s*\{/)
  assert.match(css, /:where\(\.cj-workbench\) \[hidden\]\s*\{\s*display:\s*none\s*!important/)
})

test('workspace entry is selection-first and does not expose absolute path inputs', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8')
  const app = await fs.readFile(path.join(root, 'public/app.js'), 'utf8')
  assert.match(html, /id="chooseWorkspace"/)
  assert.match(html, /id="workspaceFolderInput"[^>]*webkitdirectory/)
  assert.match(html, /id="workspaceRecentList"/)
  assert.doesNotMatch(html, /id="workspaceRoot"/)
  assert.doesNotMatch(html, /id="resumePath"/)
  assert.match(app, /window\.showDirectoryPicker/)
  assert.match(app, /workspaceId: activeWorkspace\?\.id/)
  assert.doesNotMatch(app, /workspaceRoot:\s*\$\('#workspaceRoot'\)/)
})
