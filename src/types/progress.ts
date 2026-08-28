/** Persisted reading position for one document in the vault. */
export interface ProgressEntry {
  /** Scroll ratio through the document, 0 (top) .. 1 (end). */
  ratio: number
  /** Hash of the source at the time of recording; mismatch = stale. */
  hash: string
  /** Last-recorded time, ISO string - drives pruning and display. */
  at: string
}

/** `{ [relativePath]: ProgressEntry }` - reading positions across the vault. */
export type ProgressIndex = Record<string, ProgressEntry>

/** Beyond this ratio a document counts as finished (已读毕). */
export const FINISHED_RATIO = 0.97

/** Restore is only meaningful once the reader has moved into the text. */
export const RESUME_MIN_RATIO = 0.03

export function isReading(e: ProgressEntry): boolean {
  return e.ratio >= RESUME_MIN_RATIO && e.ratio < FINISHED_RATIO
}
