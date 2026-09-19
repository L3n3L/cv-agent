import { createRoot, type Root } from 'react-dom/client'
import { MarkdownPane, type MarkdownPaneOptions } from './features/markdown/MarkdownPane'
import { A4Pane, type A4PaneOptions } from './features/preview/A4Pane'

const roots = new Set<Root>()
const rootsByContainer = new Map<Element, Root>()

function renderInto(container: Element, render: (root: Root) => void) {
  let root = rootsByContainer.get(container)
  if (!root) {
    root = createRoot(container)
    rootsByContainer.set(container, root)
    roots.add(root)
  }
  render(root)
}

export function mountMarkdownPane(container: Element, options: MarkdownPaneOptions) {
  renderInto(container, (root) => root.render(<MarkdownPane {...options} />))
}

export function unmountReactPanes() {
  for (const root of roots) root.unmount()
  roots.clear()
  rootsByContainer.clear()
}

export function mountA4Pane(container: Element, options: A4PaneOptions) {
  renderInto(container, (root) => root.render(<A4Pane {...options} />))
}
