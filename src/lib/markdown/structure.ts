import type { DocumentStructure, TocItem } from '@/types/document'

/** Strip HTML to visible text — must equal the live `.zen-prose` textContent. */
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent ?? ''
}

/** Extract the table of contents (headings with ids) and code-block presence. */
export function extractStructure(html: string): DocumentStructure {
  const doc = new DOMParser().parseFromString(html, 'text/html')
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
