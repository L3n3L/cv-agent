import { createRoot, type Root } from 'react-dom/client'
import { MarkdownPane, type MarkdownPaneOptions } from './features/markdown/MarkdownPane'
import { A4Pane, type A4PaneOptions } from './features/preview/A4Pane'

const roots = new Set<Root>()

export function mountMarkdownPane(container: Element, options: MarkdownPaneOptions) {
  const root = createRoot(container)
  roots.add(root)
  root.render(<MarkdownPane {...options} />)
}

export function unmountLegacyReactPanes() {
  for (const root of roots) root.unmount()
  roots.clear()
}

export function mountA4Pane(container: Element, options: A4PaneOptions) {
  const root = createRoot(container)
  roots.add(root)
  root.render(<A4Pane {...options} />)
}
