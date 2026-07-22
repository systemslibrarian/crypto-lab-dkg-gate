/** Tiny DOM helpers — no framework, just typed element construction. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else node.setAttribute(k, v)
  }
  node.append(...children)
  return node
}

/** Abbreviate a hex string for display; the full value stays in the transcript. */
export function shortHex(hex: string, head = 6, tail = 2): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`
}

export function scalarHex(s: bigint): string {
  return s.toString(16).padStart(64, '0')
}

/** ✓/✗-style mark plus screen-reader words — state is never color alone. */
export function mark(kind: 'ok' | 'bad' | 'warn', srText: string): HTMLElement {
  const glyph = kind === 'ok' ? '✓' : kind === 'bad' ? '✗' : '⚠'
  const span = el('span', { class: `mark mark-${kind}` })
  span.append(el('span', { 'aria-hidden': 'true' }, glyph), el('span', { class: 'sr-only' }, ` ${srText}`))
  return span
}

/** A labeled, keyboard-reachable scroll region (axe: scrollable-region-focusable). */
export function scrollRegion(label: string, ...children: Array<Node | string>): HTMLElement {
  const region = el('div', { class: 'scroll-region', tabindex: '0', role: 'region', 'aria-label': label })
  region.append(...children)
  return region
}
