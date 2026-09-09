/**
 * HTML 纯文本/标题抽取——供书库索引（excerpt/字数/搜索）与库卡标题回退。
 *
 * 一律走 `DOMParser`（只解析、不执行 `<script>`/`<img src>`），因此对不信任
 * 的 HTML 源码做静态分析是安全的；真正的执行发生在阅读期沙箱 iframe 里。
 * body 为空或无法解析时静默降级为空串/null，绝不让坏 HTML 击穿索引。
 */

/** Parse arbitrary HTML source into a document, or null when it fails. */
function parseHtml(source: string): Document | null {
  try {
    return new DOMParser().parseFromString(source, 'text/html')
  } catch {
    return null
  }
}

const IGNORE_SELECTOR = 'script,style,noscript,template,head,title'

/** Body inner text with `<script>/<style>/<noscript>/<template>` removed. */
export function extractHtmlText(source: string): string {
  const doc = parseHtml(source)
  if (!doc) return ''
  const body = doc.body
  if (!body) return ''
  const clone = body.cloneNode(true) as HTMLElement
  clone.querySelectorAll(IGNORE_SELECTOR).forEach((n) => n.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** The document's own `<title>` text, trimmed, or null when absent/empty. */
export function extractHtmlTitle(source: string): string | null {
  const doc = parseHtml(source)
  if (!doc) return null
  const title = doc.querySelector('title')?.textContent?.trim()
  return title ? title : null
}
