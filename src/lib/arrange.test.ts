import { describe, expect, it } from 'vitest'

import {
  customRank,
  mergeVisibleMove,
  reconcileCustomOrder,
} from './arrange'
import type { ArrangeFileLike } from './arrange'

const files = (rows: [string, number][]): ArrangeFileLike[] =>
  rows.map(([relativePath, mtime]) => ({ relativePath, mtime }))

describe('reconcileCustomOrder · 序列对齐与"新卷立于最前"', () => {
  it('新到一卷插入最前，旧序原位不动', () => {
    const prev = ['a.md', 'b.md', 'c.md']
    const prevPaths = new Set(prev)
    const next = files([
      ['b.md', 5],
      ['c.md', 4],
      ['a.md', 3],
      ['d.md', 9], // 新
    ])
    const r = reconcileCustomOrder(prev, next, prevPaths)
    expect(r.order).toEqual(['d.md', 'a.md', 'b.md', 'c.md'])
    expect(r.arrivals).toEqual(['d.md'])
  })

  it('多卷同到：最新者排在序列最前，其余次新依时间先后', () => {
    const prev = ['old1.md', 'old2.md']
    const prevPaths = new Set(prev)
    const next = files([
      ['old2.md', 5],
      ['old1.md', 4],
      ['newOld.md', 10], // 最先到（mtime 最小）
      ['newMid.md', 20],
      ['newest.md', 30], // 最新
    ])
    const r = reconcileCustomOrder(prev, next, prevPaths)
    expect(r.order).toEqual([
      'newest.md',
      'newMid.md',
      'newOld.md',
      'old1.md',
      'old2.md',
    ])
    expect(r.arrivals).toEqual(['newOld.md', 'newMid.md', 'newest.md'])
  })

  it('同库移动（移到分组）：basename 相同 → 原位替换，不立最前', () => {
    const prev = ['a.md', '笔记/静夜思.md', 'c.md']
    const prevPaths = new Set(prev)
    const next = files([
      ['a.md', 1],
      ['c.md', 3],
      ['诗词/静夜思.md', 5], // 从 笔记/ 移到 诗词/
    ])
    const r = reconcileCustomOrder(prev, next, prevPaths)
    expect(r.order).toEqual(['a.md', '诗词/静夜思.md', 'c.md'])
    expect(r.arrivals).toEqual([])
  })

  it('删除路径被剪除', () => {
    const prev = ['a.md', 'b.md', 'c.md']
    const prevPaths = new Set(prev)
    const next = files([
      ['a.md', 1],
      ['c.md', 3],
    ])
    const r = reconcileCustomOrder(prev, next, prevPaths)
    expect(r.order).toEqual(['a.md', 'c.md'])
    expect(r.arrivals).toEqual([])
  })

  it('重名却另有多个变动时，不做 rename 启发（避免误判）', () => {
    const prev = ['x/a.md', 'b.md']
    const prevPaths = new Set(prev)
    const next = files([
      ['y/a.md', 2],
      ['zz.md', 8],
      ['b.md', 1],
    ])
    const r = reconcileCustomOrder(prev, next, prevPaths)
    // 出现两条（y/a.md、zz.md）→ 不满足单条 rename 启发：都作新卷立于最前
    expect(r.order[0]).toBe('zz.md') // 最新者在前
    expect(r.order).not.toContain('x/a.md')
  })

  it('从未排布（空序列）：仅把新到立前，顺序即新到时间倒序', () => {
    const r = reconcileCustomOrder([], files([['a.md', 4], ['b.md', 7]]), new Set())
    expect(r.order).toEqual(['b.md', 'a.md'])
    expect(r.arrivals).toEqual(['a.md', 'b.md'])
  })

  it('重启后首次 refresh（prevPaths 空）：磁盘序原样取回，不复制出重复项', () => {
    // 模拟持久化恢复：prevCustom 已载着全部活文件，而内存刚起、prevPaths 为空。
    const prev = ['c.md', 'a.md', 'b.md'] // 自定义序（不按 mtime，刻意非默认）
    const next = files([
      ['c.md', 5],
      ['a.md', 1],
      ['b.md', 3],
    ])
    const r = reconcileCustomOrder(prev, next, new Set())
    expect(r.order).toEqual(['c.md', 'a.md', 'b.md'])
    expect(r.arrivals).toEqual([])
    expect(new Set(r.order).size).toBe(r.order.length) // 无重复
  })

  it('磁盘序没盖住重启后外部新增：只把真新卷立最前', () => {
    const prev = ['a.md', 'b.md']
    const next = files([
      ['b.md', 5],
      ['a.md', 4],
      ['c.md', 9], // 应用关闭期间由别处新增
    ])
    const r = reconcileCustomOrder(prev, next, new Set())
    expect(r.order).toEqual(['c.md', 'a.md', 'b.md'])
    expect(r.arrivals).toEqual(['c.md'])
  })
})

describe('mergeVisibleMove · 过滤视图位移合并回全库', () => {
  it('移到位 → 紧随前驱可见卷之后', () => {
    const global = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']
    // 可见子序列原 [b,c,e]，把 e 拖到 b 与 c 之间 → 新可见 [b,e,c]
    const merged = mergeVisibleMove(global, ['b.md', 'e.md', 'c.md'], 'e.md')
    expect(merged).toEqual(['a.md', 'b.md', 'e.md', 'c.md', 'd.md'])
  })

  it('移到可见集最前 → 插在首个可见卷之前（分块顶端，非库顶端）', () => {
    const global = ['x.md', 'a.md', 'y.md', 'b.md', 'c.md']
    // 可见 [a,b,c]，c 拖到首位 → c 插在首个可见卷 a 之前
    const merged = mergeVisibleMove(global, ['c.md', 'a.md', 'b.md'], 'c.md')
    expect(merged).toEqual(['x.md', 'c.md', 'a.md', 'y.md', 'b.md'])
  })

  it('无实际变化 → 返回 null（不算一次有效排布）', () => {
    const global = ['a.md', 'b.md', 'c.md']
    // e 在可见中仍紧跟 a（全局本就如此）→ 结构未变
    expect(mergeVisibleMove(global, ['a.md', 'b.md'], 'b.md')).toBeNull()
    expect(mergeVisibleMove(global, ['a.md', 'b.md', 'c.md'], 'b.md')).toBeNull()
  })

  it('仅一项可见 / 未知路径 → null', () => {
    expect(mergeVisibleMove(['a.md', 'b.md'], ['a.md'], 'a.md')).toBeNull()
    expect(mergeVisibleMove(['a.md', 'b.md'], ['a.md', 'x.md'], 'x.md')).toBeNull()
    expect(mergeVisibleMove(['a.md', 'b.md'], ['a.md', 'b.md'], 'nope.md')).toBeNull()
  })

  it('还原数组不被原地复用（无副作用）', () => {
    const global = ['a.md', 'b.md', 'c.md', 'd.md']
    const snap = global.slice()
    const merged = mergeVisibleMove(global, ['a.md', 'c.md', 'b.md', 'd.md'], 'c.md')
    expect(global).toEqual(snap)
    expect(merged).toEqual(['a.md', 'c.md', 'b.md', 'd.md'])
  })
})

describe('customRank', () => {
  it('命中给序号，未知给序列长度（并列后置）', () => {
    const rank = customRank(['a.md', 'b.md'])
    expect(rank('a.md')).toBe(0)
    expect(rank('b.md')).toBe(1)
    expect(rank('zz.md')).toBe(2)
  })
})
