import { describe, expect, it } from 'vitest'

import {
  folderDropTarget,
  planFolderDrop,
  resolveFolderDrop,
  type FolderRowBox,
} from './folderDrag'

/**
 * 分组拖动的纯判定。这层以前长在 `FolderTree.vue` 的 DOM 事件里，只能靠合成
 * `DragEvent` 间接验；改走指针事件后判定与事件源无关，于是可以整块单测。
 *
 * 三件事各有各的坑：
 * 1. **行内分区**——上/下 1/4 是排序、中段是移入；不可展开的组没有"里面"，整行只表达前/后。
 * 2. **缝隙归位**——行高 32 + 行距 1，指针落在行与行之间时必须归到最近一行，否则
 *    "怎么拖都不动"（真机复验撞到过，见 `doc/sidebar-ux.md`）。
 * 3. **落子折动作**——同层要重排、跨层要搬家、放自己子树里要拒、no-op 要什么都不做。
 */

/** 三行：a 可展开、b 不可展开、c 可展开；行高 32、行距 1（与 motion.css 同源）。 */
const ROW_H = 32
const GAP = 1
const TOP = 100

function boxes(): FolderRowBox[] {
  return [
    { path: 'a', expandable: true, top: TOP, bottom: TOP + ROW_H },
    { path: 'b', expandable: false, top: TOP + ROW_H + GAP, bottom: TOP + 2 * ROW_H + GAP },
    { path: 'c', expandable: true, top: TOP + 2 * (ROW_H + GAP), bottom: TOP + 3 * ROW_H + 2 * GAP },
  ]
}

describe('resolveFolderDrop · 行内分区', () => {
  it('可展开的组：上 1/4 排前、下 1/4 排后、中段移入', () => {
    const box = boxes()[0]
    expect(resolveFolderDrop(boxes(), box.top + 2)).toEqual({ path: 'a', mode: 'before' })
    expect(resolveFolderDrop(boxes(), box.top + ROW_H / 2)).toEqual({ path: 'a', mode: 'inside' })
    expect(resolveFolderDrop(boxes(), box.bottom - 2)).toEqual({ path: 'a', mode: 'after' })
  })

  it('不可展开的组没有「里面」：整行只表达前/后', () => {
    const box = boxes()[1]
    expect(resolveFolderDrop(boxes(), box.top + 2)).toEqual({ path: 'b', mode: 'before' })
    // 中段按上下半场判，而不是 inside
    expect(resolveFolderDrop(boxes(), box.top + ROW_H / 2)).toEqual({ path: 'b', mode: 'after' })
  })
})

describe('resolveFolderDrop · 缝隙与边界归到最近一行', () => {
  it('行距那条 1px 缝隙里也有落点：归到下面那一行的 before（即"插在这两行之间"）', () => {
    const a = boxes()[0]
    expect(resolveFolderDrop(boxes(), a.bottom + 0.5)).toEqual({ path: 'b', mode: 'before' })
  })

  it('压在末行下缘之外几像素：仍归到末行的 after，而不是无处可放', () => {
    const c = boxes()[2]
    expect(resolveFolderDrop(boxes(), c.bottom + 6)).toEqual({ path: 'c', mode: 'after' })
    // 中间那一行之下、下一行之上，同样不能丢——这正是旧实现给"末行之后"的位置
    const b = boxes()[1]
    expect(resolveFolderDrop(boxes(), b.bottom + 6)).toEqual({ path: 'c', mode: 'before' })
  })

  it('列表之上 / 之下：归到首行的 before / 末行的 after', () => {
    expect(resolveFolderDrop(boxes(), TOP - 40)).toEqual({ path: 'a', mode: 'before' })
    expect(resolveFolderDrop(boxes(), boxes()[2].bottom + 40)).toEqual({ path: 'c', mode: 'after' })
  })

  it('一行都没有 → null（调用方据此不发落点）', () => {
    expect(resolveFolderDrop([], 120)).toBeNull()
  })
})

describe('folderDropTarget · 落点折成目标路径', () => {
  it('落点前/后且与自身同父 → null（同层排序，不搬家）', () => {
    expect(folderDropTarget('x', { path: 'y', mode: 'before' })).toBeNull()
    expect(folderDropTarget('MySQL/日志', { path: 'MySQL/锁', mode: 'after' })).toBeNull()
  })

  it('落点前/后但换了父级 → 搬成目标父级下的同名', () => {
    expect(folderDropTarget('x', { path: 'g/y', mode: 'before' })).toBe('g/x')
  })

  it('落点中段 → 搬进那一层；放进当前父级等于没动', () => {
    expect(folderDropTarget('x', { path: 'g', mode: 'inside' })).toBe('g/x')
    expect(folderDropTarget('g/x', { path: 'g', mode: 'inside' })).toBeNull()
  })
})

describe('planFolderDrop · 折成一次动作', () => {
  /** 显示序：根层 [a, b, c]；g 下 [g/x, g/y]。 */
  const childrenOf = (parent: string): string[] =>
    parent === 'g' ? ['g/x', 'g/y'] : ['a', 'b', 'c']

  it('同层：拖 c 到 a 之前 → 重排根层序', () => {
    expect(planFolderDrop('c', { path: 'a', mode: 'before' }, childrenOf)).toEqual({
      kind: 'reorder',
      parent: '',
      order: ['c', 'a', 'b'],
    })
  })

  it('同层：拖 a 到 c 之后 → 重排到末尾', () => {
    expect(planFolderDrop('a', { path: 'c', mode: 'after' }, childrenOf)).toEqual({
      kind: 'reorder',
      parent: '',
      order: ['b', 'c', 'a'],
    })
  })

  it('同层：本来就在目标之前 → 什么都不做（no-op 不污染序）', () => {
    expect(planFolderDrop('a', { path: 'b', mode: 'before' }, childrenOf)).toBeNull()
    expect(planFolderDrop('b', { path: 'a', mode: 'after' }, childrenOf)).toBeNull()
  })

  it('跨层：落点前/后但父级不同 → 搬家', () => {
    expect(planFolderDrop('a', { path: 'g/x', mode: 'before' }, childrenOf)).toEqual({
      kind: 'move',
      from: 'a',
      to: 'g/a',
      parent: 'g',
    })
  })

  it('跨层：落点中段 → 搬进那一层', () => {
    expect(planFolderDrop('a', { path: 'g', mode: 'inside' }, childrenOf)).toEqual({
      kind: 'move',
      from: 'a',
      to: 'g/a',
      parent: 'g',
    })
  })

  it('放进自己或自己的子树 → null（调用方给「不能搬进自己」的提示）', () => {
    expect(planFolderDrop('g', { path: 'g', mode: 'inside' }, childrenOf)).toBeNull()
    expect(planFolderDrop('g', { path: 'g/x', mode: 'inside' }, childrenOf)).toBeNull()
  })

  it('深层同层：MySQL 下挪动子分组，重排的是 MySQL 的序', () => {
    const deep = (parent: string): string[] =>
      parent === 'MySQL' ? ['MySQL/WAL机制', 'MySQL/日志', 'MySQL/索引', 'MySQL/锁'] : ['MySQL']
    expect(
      planFolderDrop('MySQL/锁', { path: 'MySQL/日志', mode: 'before' }, deep),
    ).toEqual({
      kind: 'reorder',
      parent: 'MySQL',
      order: ['MySQL/WAL机制', 'MySQL/锁', 'MySQL/日志', 'MySQL/索引'],
    })
  })

  it('空路径（没有拿起任何组）→ null', () => {
    expect(planFolderDrop('', { path: 'a', mode: 'before' }, childrenOf)).toBeNull()
  })
})
