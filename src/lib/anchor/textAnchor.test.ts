import { describe, expect, it } from 'vitest'

import { locateQuoteOffset } from './textAnchor'
import type { HighlightAnchor } from '@/types/note'

const anchor = (p: Partial<HighlightAnchor>): HighlightAnchor => ({
  quote: '',
  prefix: '',
  suffix: '',
  occurrence: 0,
  ...p,
})

describe('locateQuoteOffset · 引文定位（与 applyAnchors 同源）', () => {
  const full = 'aaaXbbbXccc'

  it('按 occurrence 命中同名第 n 次出现', () => {
    expect(locateQuoteOffset(full, anchor({ quote: 'X', occurrence: 0 }))).toBe(3)
    expect(locateQuoteOffset(full, anchor({ quote: 'X', occurrence: 1 }))).toBe(7)
  })

  it('occurrence 失效时按前后文重叠回退到最相似处', () => {
    // X 出现两次；occurrence=2 已越界 → 用 prefix/suffix 判定应落到"bbbXccc"那处。
    const a = anchor({ quote: 'X', occurrence: 2, prefix: 'bbb', suffix: 'ccc' })
    expect(locateQuoteOffset(full, a)).toBe(7)
  })

  it('引文已漂移/不存在 → -1', () => {
    expect(locateQuoteOffset(full, anchor({ quote: 'Z' }))).toBe(-1)
    expect(locateQuoteOffset(full, anchor({ quote: 'ccc' }))).toBe(8)
    expect(locateQuoteOffset('', anchor({ quote: 'X' }))).toBe(-1)
  })
})
