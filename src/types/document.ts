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
 * A document rendered for reading — a transient view model built on open
 * by parsing the file's source; not persisted anywhere.
 */
export interface Document {
  title: string
  /** Raw markdown including frontmatter — the source of truth on disk. */
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
  /** Number of files directly under this folder. */
  count: number
}
