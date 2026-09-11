/** A markdown file on disk under the vault folder (from `read_vault`). */
export interface VaultFile {
  /** File name (e.g. `静夜思.md`). */
  name: string
  /** Absolute path on disk. */
  path: string
  /** Path relative to the vault root, `/`-separated. */
  relativePath: string
  /** Last-modified time in milliseconds since the Unix epoch. */
  mtime: number
}

/** Result of scanning the vault: files + directories (empty ones included). */
export interface VaultListing {
  files: VaultFile[]
  dirs: string[]
}

/**
 * The two document families ZenReader reads: `.md`/`.markdown` (typeset by
 * ZenReader) and `.html`/`.htm` (read in their original styling).
 */
export type DocumentFormat = 'markdown' | 'html'

/** Library 卷式 lens: one family, or everything. */
export type FormatFilter = 'all' | DocumentFormat

/**
 * A document rendered for reading — a transient view model built on open
 * by parsing the file's source; not persisted anywhere.
 */
export interface Document {
  title: string
  /** Which renderer serves this document: `.md` renders zen-prose from
   *  `source`; `.html/.htm` displays the original in a sandboxed iframe. */
  format: DocumentFormat
  /** Raw source on disk (markdown including frontmatter, or the HTML bytes
   *  decoded to text) — the source of truth. */
  source: string
  /** Rendered + sanitized HTML cache for this open session. */
  html: string
  /** textContent of `html` — shared domain for word count, search, anchors. */
  plainText: string
  /** Hash of `source`, for staleness detection. */
  sourceHash: string
  frontmatter: Record<string, unknown>
  excerpt: string
  wordCount: number
  /** Estimated reading minutes. */
  readingTime: number
  fileName: string
  /** Relative folder path (e.g. `notes/philosophy`); empty string at root. */
  folderPath: string
  /** Path relative to the vault root, `/`-separated. */
  relativePath: string
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
  /**
   * 整棵子树内的卷数（递归累计）。让侧栏计数与「寻词时递归所见」一致，且
   * `count === 0` 恰好等价于后端的可释怀判定（整个子树无文件）。
   */
  count: number
}
