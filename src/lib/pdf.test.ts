import { describe, expect, it } from 'vitest'
import { clampPdfPage, pageFromProgress, pdfProgress } from './pdf'

describe('PDF reader paths and progress', () => {
  it('round trips page progress and bounds user input', () => {
    expect(clampPdfPage(999, 20)).toBe(20)
    expect(clampPdfPage(Number.NaN, 20)).toBe(1)
    expect(pdfProgress(10, 20)).toBeCloseTo(9 / 19)
    expect(pageFromProgress(pdfProgress(10, 20), 20)).toBe(10)
  })
})
