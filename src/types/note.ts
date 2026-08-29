/** Serialized anchor: text + surrounding context + occurrence index. */
export interface HighlightAnchor {
  quote: string
  prefix: string
  suffix: string
  /** 0-based index of this quote among identical occurrences in plainText. */
  occurrence: number
}

export type NoteKind = 'highlight' | 'note' | 'free'

/**
 * A 觉悟笔记 wraps a highlight; `highlight` means no note text yet, `note` has
 * a reflection, and `free` is a standalone reflection without a highlight.
 */
export interface Note {
  id: string
  /** Path relative to the vault root of the owning document. */
  relativePath: string
  kind: NoteKind
  /** The selected / highlighted rendered text; `''` for free notes. */
  quote: string
  /** The user's own-words reflection. */
  note: string
  /** `null` for free notes (no highlighted text). */
  anchor: HighlightAnchor | null
  createdAt: string
  updatedAt: string
}
