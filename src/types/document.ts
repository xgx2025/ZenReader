/** A single imported markdown document (a "书卷" in the library). */
export interface Document {
  id: string
  title: string
  /** Raw markdown including frontmatter — the source of truth for re-parsing. */
  source: string
  /** Rendered + sanitized HTML cache. */
  html: string
  /** textContent of `html` — shared domain for word count, search, anchors. */
  plainText: string
  /** Hash of `source`, for dedupe / staleness detection on re-import. */
  sourceHash: string
  frontmatter: Record<string, unknown>
  excerpt: string
  wordCount: number
  /** Estimated reading minutes. */
  readingTime: number
  fileName: string
  /** Relative folder path (e.g. `notes/philosophy`); empty string for single import. */
  folderPath: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export interface TocItem {
  level: number
  text: string
  id: string
}

export interface DocumentStructure {
  toc: TocItem[]
  hasCodeBlocks: boolean
}

export interface FolderNode {
  name: string
  path: string
  children: FolderNode[]
  /** Number of documents directly under this folder. */
  count: number
}
