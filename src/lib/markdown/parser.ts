import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'
import footnote from 'markdown-it-footnote'
import texmath from 'markdown-it-texmath'
import katex from 'katex'

import { sanitizeHtml } from './sanitize'
import { extractStructure, htmlToPlainText } from './structure'
import { cjkEmphasis } from './cjkEmphasis'

// Deterministic heading ids (`h-0`, `h-1`, …) reset per render.
const headingCounter = { n: 0 }

const md = new MarkdownIt({
  html: true, // allow embedded HTML; sanitized after render
  linkify: true,
  typographer: true, // smart quotes/dashes — a zen-typography win
})
  .use(anchor, { slugify: () => `h-${headingCounter.n++}` })
  .use(taskLists)
  .use(footnote)
  .use(cjkEmphasis)
  .use(texmath, {
    engine: katex,
    // `$…$` / `$$…$$` / `\begin{…}…\end{…}` / `\(…\)` / `\[…\]` 一网打尽。
    delimiters: ['dollars', 'beg_end', 'brackets'],
    katexOptions: { throwOnError: false, strict: false },
  })

/** KaTeX 渲染公式，错误降级为红字源码而非抛异常；strict 关掉 LaTeX 兼容性
    告警，中文文档里偶发的「伪公式」不再向控制台刷警告。 */
function renderKatex(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false })
}

// texmath 默认用 <eq>/<eqn> 包裹，这两个自定义标签会被 DOMPurify 剥掉——
// 换成与 .mermaid-figure 同构的标准元素：行内 span / 行间 div。
md.renderer.rules.math_inline = (tokens, idx) =>
  `<span class="zen-math-inline">${renderKatex(tokens[idx].content, false)}</span>`
md.renderer.rules.math_inline_double = (tokens, idx) =>
  `<span class="zen-math-inline">${renderKatex(tokens[idx].content, true)}</span>`
md.renderer.rules.math_block = (tokens, idx) =>
  `<div class="zen-math-block">${renderKatex(tokens[idx].content, true)}</div>`
md.renderer.rules.math_block_eqno = (tokens, idx) =>
  `<div class="zen-math-block zen-math-block-eqno">${renderKatex(
    tokens[idx].content,
    true,
  )}<span class="zen-math-eqno">(${tokens[idx].info})</span></div>`

// First-line link guard: allow http/https/mailto and relative paths only.
const SAFE_LINK = /^(?:https?:\/\/|mailto:|#|\/|\.{1,2}\/)/i
md.validateLink = (url: string) => SAFE_LINK.test(url)

// 外链开新页：浏览器 dev 走新标签；Tauri 下点击被 ReaderView 拦截、
// 转交系统浏览器，target 不会生效，仅作语义兜底。
const EXTERNAL_LINK = /^(?:https?:\/\/|mailto:)/i
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') ?? ''
  if (EXTERNAL_LINK.test(href)) {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export interface RenderedMarkdown {
  html: string
  plainText: string
  structure: ReturnType<typeof extractStructure>
}

/** Render markdown to sanitized HTML + derived structure, in one deterministic pass. */
export function renderMarkdown(source: string): RenderedMarkdown {
  headingCounter.n = 0
  const html = sanitizeHtml(md.render(source))
  const plainText = htmlToPlainText(html)
  const structure = extractStructure(html)
  return { html, plainText, structure }
}
