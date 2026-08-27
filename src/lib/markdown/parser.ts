import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'
import footnote from 'markdown-it-footnote'

import { sanitizeHtml } from './sanitize'
import { extractStructure, htmlToPlainText } from './structure'

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

// First-line link guard: allow http/https/mailto and relative paths only.
const SAFE_LINK = /^(?:https?:\/\/|mailto:|#|\/|\.{1,2}\/)/i
md.validateLink = (url: string) => SAFE_LINK.test(url)

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
