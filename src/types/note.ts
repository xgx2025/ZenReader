/** Serialized anchor: text + surrounding context + occurrence index. */
export interface HighlightAnchor {
  quote: string
  prefix: string
  suffix: string
  /** 0-based index of this quote among identical occurrences in plainText. */
  occurrence: number
}

export type NoteKind = 'highlight' | 'note'

/** A 觉悟笔记 always wraps a highlight; kind `highlight` means no note text yet. */
export interface Note {
  id: string
  documentId: string
  kind: NoteKind
  /** The selected / highlighted rendered text. */
  quote: string
  /** The user's own-words reflection. */
  note: string
  anchor: HighlightAnchor
  createdAt: string
  updatedAt: string
}
