import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createApp, h, type App } from 'vue'

import FolderTree from './FolderTree.vue'
import { TREE_ROOT_KEY, buildFolderTree, flattenVisibleRows } from '@/lib/folderTree'
import type { FolderRow } from '@/lib/folderTree'

/**
 * 侧栏分组树的交互契约。这里守的是「选中」与「展开」两件事的边界——早期实现把它们
 * 压成同一个开关（点自己 = 回书库），既收不起子树、又静默丢位置。
 *
 * 刻意不引 @vue/test-utils：真 DOM + 真事件冒泡才验得出「点折页不该冒到行上」。
 */

let app: App | null = null
let host: HTMLElement | null = null

interface Emitted {
  select: string[]
  toggle: string[]
  remove: string[]
  menu: Array<{ path: string; count: number }>
}

/**
 * 造一份「展平行 + 展开记录」——两者在真实调用处同源（都出自 useFolderExpansion），
 * 测试里也必须一起给，否则组件的 aria-expanded 会与行序列自相矛盾。
 */
function treeOf(
  files: { relativePath: string }[],
  dirs: string[],
  expanded: Record<string, boolean> = {},
): { rows: FolderRow[]; expanded: Record<string, boolean> } {
  const record = { [TREE_ROOT_KEY]: true, ...expanded }
  const nodes = buildFolderTree(
    files.map((f) => ({
      name: f.relativePath.split('/').pop() ?? f.relativePath,
      path: `/vault/${f.relativePath}`,
      relativePath: f.relativePath,
      mtime: 0,
    })),
    dirs,
  )
  return { rows: flattenVisibleRows(nodes, record), expanded: record }
}

function mountTree(options: {
  rows: FolderRow[]
  expanded?: Record<string, boolean>
  selected?: string
}) {
  const emitted: Emitted = { select: [], toggle: [], remove: [], menu: [] }
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () =>
      h(FolderTree, {
        rows: options.rows,
        selected: options.selected ?? '',
        expanded: options.expanded ?? {},
        activePath: options.selected ?? '',
        onSelect: (p: string) => emitted.select.push(p),
        onToggle: (p: string) => emitted.toggle.push(p),
        onRemove: (p: string) => emitted.remove.push(p),
        onMenu: (e: { path: string; count: number }) => emitted.menu.push(e),
      }),
  })
  app.mount(host)
  return emitted
}

function rowOf(path: string): HTMLElement {
  const el = host?.querySelector<HTMLElement>(`[data-folder-row="${path}"]`)
  if (!el) throw new Error(`row not found: ${path}`)
  return el
}

/** 折页 / 行名 / 行操作各有类名——不用「第几个按钮」猜，空分组的折页是占位 span。 */
function chevron(path: string): HTMLElement {
  const el = rowOf(path).querySelector<HTMLElement>('.folder-chevron-btn')
  if (!el) throw new Error(`chevron not found: ${path}`)
  return el
}

function name(path: string): HTMLElement {
  const el = rowOf(path).querySelector<HTMLElement>('.folder-name')
  if (!el) throw new Error(`name not found: ${path}`)
  return el
}

function action(path: string): HTMLElement {
  const el = rowOf(path).querySelector<HTMLElement>('.folder-action')
  if (!el) throw new Error(`action button not rendered: ${path}`)
  return el
}

/** a 本层 1 篇、子树共 2 篇（a/b 里另有 1 篇）——多处用例共用这一份形状。 */
const A_B = treeOf(
  [{ relativePath: 'a/x.md' }, { relativePath: 'a/b/y.md' }],
  ['a', 'a/b'],
  { a: true },
)

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  app?.unmount()
  app = null
  host = null
})

describe('FolderTree · 选中与展开是两件事', () => {
  it('点行名只选中，不折叠、不改变任何展开态', () => {
    const emitted = mountTree({ ...A_B, selected: '' })

    name('a').click()

    expect(emitted.select).toEqual(['a'])
    expect(emitted.toggle).toEqual([]) // 关键：选中不再顺带折叠
  })

  it('点折页只开合，绝不动选中（收起内含当前选中的分组时主区不该换内容）', () => {
    const emitted = mountTree({ ...A_B, selected: 'a/b' })

    chevron('a').click()

    expect(emitted.toggle).toEqual(['a'])
    expect(emitted.select).toEqual([])
  })

  it('折页的点击不冒泡到行上（否则一次点击会同时开合与选中）', () => {
    const emitted = mountTree({ ...A_B, selected: '' })

    chevron('a').click()

    expect(emitted.select).toEqual([])
    expect(emitted.toggle).toEqual(['a'])
  })

  it('已选中的分组仍可再次点击选中，不会被当成「回书库」', () => {
    const emitted = mountTree({ ...A_B, selected: 'a' })

    name('a').click()

    expect(emitted.select).toEqual(['a'])
  })
})

describe('FolderTree · 行上的可见操作', () => {
  it('空分组露出「释怀」，点的就是它', () => {
    const emitted = mountTree(treeOf([], ['空的']))

    action('空的').click()

    expect(emitted.remove).toEqual(['空的'])
    expect(emitted.menu).toEqual([])
  })

  it('非空分组的行操作是「⋯」（唤菜单），且带上子树计数', () => {
    const emitted = mountTree(A_B)

    action('a').click()

    expect(emitted.menu.map((m) => m.path)).toEqual(['a'])
    expect(emitted.menu[0].count).toBe(2) // 整棵子树
    expect(emitted.remove).toEqual([])
  })

  it('计数列显本层数（点进去真正会看到的），子树总数留给 title', () => {
    mountTree(A_B)

    // a 本层 1 篇、子树 2 篇 → 行内显 1
    expect(name('a').textContent).toContain('1')
    expect(name('a').getAttribute('title')).toContain('共 2 篇')
    expect(name('a').getAttribute('title')).toContain('本层 1 篇')
  })

  it('本层与子树不等时，行内同时给出两个刻度：「本层/全部」', () => {
    mountTree(A_B)

    // a 本层 1 篇、子树共 2 篇 → 「1/2」。只显一个数必然与主区自相矛盾：
    // 显本层，看数字的人以为点进去有 1 篇却发现总数不止；显总数，点进去又对不上。
    const count = rowOf('a').querySelector('.folder-count')
    expect(count?.textContent?.replace(/\s/g, '')).toBe('1/2')
    expect(count?.querySelector('.side-count-alt')?.textContent).toBe('/2')
  })

  it('本层与子树相等时只显一个数（相同就不必念两遍）', () => {
    mountTree(treeOf([{ relativePath: 'a/x.md' }], ['a']))

    const count = rowOf('a').querySelector('.folder-count')
    expect(count?.textContent?.trim()).toBe('1')
    expect(count?.querySelector('.side-count-alt')).toBeNull()
  })

  it('空分组的计数降到零档（0 卷的行视觉权重低一级）', () => {
    mountTree(treeOf([], ['空的']))

    expect(rowOf('空的').querySelector('.folder-count')?.classList.contains('side-count-zero')).toBe(
      true,
    )
  })
})

describe('FolderTree · 缩进只推折页与名称', () => {
  it('深层级渲染缩进占位，顶层不渲染', () => {
    mountTree(A_B)

    expect(rowOf('a').querySelector('.folder-indent')).toBeNull()
    expect(rowOf('a/b').querySelector('.folder-indent')).not.toBeNull()
  })

  it('缩进宽度按层级递增（16px/级），折页槽宽度不随层数变', () => {
    mountTree(treeOf([{ relativePath: 'a/b/y.md' }], ['a', 'a/b'], { a: true }))

    const indent = rowOf('a/b').querySelector<HTMLElement>('.folder-indent')
    expect(indent?.style.width).toBe('16px')
    // 折页槽自身宽度恒定，故尾列（计数）不会随层数漂移
    expect(rowOf('a/b').querySelector('.folder-tail')?.classList.contains('side-tail')).toBe(true)
  })
})

describe('FolderTree · 树语义', () => {
  it('折页控件的折叠状态同时反映在 aria-expanded 上', () => {
    mountTree(treeOf([{ relativePath: 'a/b/y.md' }], ['a', 'a/b'], { a: false }))

    expect(rowOf('a').getAttribute('aria-expanded')).toBe('false')
    expect(rowOf('a').getAttribute('aria-level')).toBe('1')
  })

  it('折叠后子行整行退场，不再参与 Tab 序', () => {
    mountTree(treeOf([{ relativePath: 'a/b/y.md' }], ['a', 'a/b'], { a: false }))

    expect(host?.querySelector('[data-folder-row="a/b"]')).toBeNull()
  })

  it('只有 activePath 那一行在 Tab 序里（roving tabindex）', () => {
    mountTree({
      ...treeOf([{ relativePath: 'a/x.md' }, { relativePath: 'b/y.md' }], ['a', 'b']),
      selected: 'b',
    })

    expect(rowOf('a').getAttribute('tabindex')).toBe('-1')
    expect(rowOf('b').getAttribute('tabindex')).toBe('0')
  })

  it('行与「书库」行同族：都用 .side-row 这一套行样式（间距/列宽/竖条共源）', () => {
    mountTree(A_B)

    const line = rowOf('a').querySelector('.folder-line')
    expect(line?.classList.contains('side-row')).toBe(true)
    // 未选中的行不该带 side-row-on（竖条与底色都挂在这上面）
    expect(line?.classList.contains('side-row-on')).toBe(false)
    expect(
      rowOf('a').querySelector('.folder-name .folder-tail .side-count')?.textContent,
    ).toContain('1')
  })

  it('选中行带 side-row-on（底色 + 竖条的唯一开关）', () => {
    mountTree({ ...A_B, selected: 'a' })

    expect(rowOf('a').querySelector('.folder-line')?.classList.contains('side-row-on')).toBe(
      true,
    )
  })
})
