import type { DocumentStructure, TocItem } from '@/types/document'

/** 剔除 KaTeX 的无障碍 MathML 层（.katex-mathml）：它藏在 1px 裁剪盒里，
    只供读屏；其文本（符号拼写 + 源码注解）若计入纯文本/目录，会造成
    同一公式重复计字、目录里带原始 TeX 源码。 */
function stripMathML(doc: Document): void {
  doc.querySelectorAll('.katex-mathml').forEach((el) => el.remove())
}

/** Strip HTML to visible text（`visible` 专指视觉层：KaTeX 的 MathML 无障碍
    层与 `.zen-prose` 的实时 textContent 略有出入，锚点系统不依赖本函数，
    见 lib/anchor/textAnchor.ts 的实时 textContent 自足定位）。 */
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  stripMathML(doc)
  return doc.body.textContent ?? ''
}

/** Extract the table of contents (headings with ids) and code-block presence. */
export function extractStructure(html: string): DocumentStructure {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  stripMathML(doc)
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6')

  const toc: TocItem[] = Array.from(headings).map((h) => ({
    level: Number(h.tagName.charAt(1)),
    text: (h.textContent ?? '').trim(),
    id: h.id,
  }))

  const hasCodeBlocks = doc.querySelectorAll('pre code').length > 0

  return { toc, hasCodeBlocks }
}

/** Word count: CJK chars individually, latin/number runs as words. */
export function countWords(plainText: string): number {
  const cjkRanges = /[一-鿿぀-ヿ가-힯]/g
  const cjk = (plainText.match(cjkRanges) ?? []).length

  const nonCjk = plainText.replace(cjkRanges, ' ')
  const latin = nonCjk.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []

  return cjk + latin.length
}

/** Estimated reading time in minutes (~300 chars/min for mixed text). */
export function computeReadingTime(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 300))
}

/** First `length` chars of plain text, whitespace-collapsed. */
export function makeExcerpt(plainText: string, length = 160): string {
  const clean = plainText.replace(/\s+/g, ' ').trim()
  return clean.length > length ? `${clean.slice(0, length)}…` : clean
}
