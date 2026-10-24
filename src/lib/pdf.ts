export function clampPdfPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, total))
}

/** Progress remains compatible with the existing 0..1 library card indicator. */
export function pdfProgress(page: number, total: number): number {
  return total <= 1 ? 1 : (clampPdfPage(page, total) - 1) / (total - 1)
}

export function pageFromProgress(ratio: number, total: number): number {
  return clampPdfPage(Math.round(ratio * Math.max(0, total - 1)) + 1, total)
}
