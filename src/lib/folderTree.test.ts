import { describe, expect, it } from 'vitest'

import type { FolderNode, VaultFile } from '@/types/document'
import {
  TREE_ROOT_KEY,
  buildFolderTree,
  checkFolderName,
  collectFolderPaths,
  findNode,
  flattenVisibleRows,
  folderAncestors,
  folderCrumbs,
  folderNameTaken,
  folderParentOf,
  folderScope,
  inFolderScope,
  mergeFolderOrder,
} from './folderTree'

function file(relativePath: string, mtime = 0): VaultFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `/vault/${relativePath}`,
    relativePath,
    mtime,
  }
}

/**
 * 选中某分组时右侧「寻词递归」所见的那批卷——计数理应与它**恒等**。
 * 刻意走生产谓词而非照抄一遍，否则测的只是我自己写了两遍的同一个想法。
 */
function seenIn(files: VaultFile[], path: string): VaultFile[] {
  return files.filter((f) => inFolderScope(f.relativePath, path, true))
}

function everyNode(nodes: FolderNode[], fn: (n: FolderNode) => void): void {
  for (const n of nodes) {
    fn(n)
    everyNode(n.children, fn)
  }
}

describe('buildFolderTree', () => {
  it('父分组的 count 递归累计子分组的卷数（原「显示 3、出来 13」之 bug）', () => {
    const tree = buildFolderTree([file('a/b/y.md'), file('a/b/z.md')], ['a', 'a/b'])

    expect(tree).toHaveLength(1)
    expect(tree[0].path).toBe('a')
    // a 自己没有直属文件，但子树里有 2 篇——点开 a 确实看得到这 2 篇。
    expect(tree[0].count).toBe(2)
    expect(tree[0].children[0].count).toBe(2)
  })

  it('每个节点的 count 恒等于「选中该分组时所见」的篇数', () => {
    const dirs = ['a', 'a/b', 'ab']
    const files = [
      file('a/x.md'),
      file('a/b/y.md'),
      file('a/b/z.md'),
      file('ab/w.md'),
      file('root.md'),
    ]
    const tree = buildFolderTree(files, dirs)

    everyNode(tree, (n) => {
      expect(n.count).toBe(seenIn(files, n.path).length)
    })

    // 卡住 `/` 边界：裸 startsWith('a') 会把兄弟分组 ab 的卷算进 a。
    expect(findNode(tree, 'a')!.count).toBe(3)
    expect(findNode(tree, 'ab')!.count).toBe(1)
  })

  it('根级文件不入任何分组，也不凭空造出空名节点', () => {
    const tree = buildFolderTree([file('root.md'), file('a/x.md')], ['a'])

    expect(tree.map((n) => n.path)).toEqual(['a'])
    everyNode(tree, (n) => expect(n.name).not.toBe(''))
    // 顶层计数之和是 1（仅 a 里的那篇），而非全库的 2 篇——「书库」行用的是
    // totalCount，有根级文件时两者不等，这是对的。
    expect(tree.reduce((acc, n) => acc + n.count, 0)).toBe(1)
  })

  it('空分组仍现身且计数为 0（恰是可释怀状态）', () => {
    const tree = buildFolderTree([], ['a', 'a/b'])

    expect(findNode(tree, 'a')!.count).toBe(0)
    expect(findNode(tree, 'a/b')!.count).toBe(0)
  })

  it('无分组时为空树', () => {
    expect(buildFolderTree([file('root.md')], [])).toEqual([])
  })

  it('here 只数本层直属，count 仍递归累计（侧栏「N / M」的依据）', () => {
    const tree = buildFolderTree(
      [file('a/x.md'), file('a/b/y.md'), file('a/b/z.md')],
      ['a', 'a/b'],
    )

    expect(findNode(tree, 'a')!.here).toBe(1)
    expect(findNode(tree, 'a')!.count).toBe(3)
    expect(findNode(tree, 'a/b')!.here).toBe(2)
    expect(findNode(tree, 'a/b')!.count).toBe(2)
  })

  it('here 之和等于全库有分组的卷数（不重不漏）', () => {
    const files = [file('a/x.md'), file('a/b/y.md'), file('ab/w.md'), file('root.md')]
    const tree = buildFolderTree(files, ['a', 'a/b', 'ab'])

    let sum = 0
    everyNode(tree, (n) => (sum += n.here))
    expect(sum).toBe(3) // root.md 不属于任何分组
  })

  it('逐层按中文序排列', () => {
    const tree = buildFolderTree([], ['乙', '甲', '甲/丙', '甲/乙'])

    expect(tree.map((n) => n.name)).toEqual(['甲', '乙'])
    expect(tree[0].children.map((n) => n.name)).toEqual(['丙', '乙'])
  })
})

describe('collectFolderPaths', () => {
  it('前序展开，父在子前', () => {
    const tree = buildFolderTree([], ['a', 'a/b', 'c'])

    expect(collectFolderPaths(tree)).toEqual(['a', 'a/b', 'c'])
  })
})

describe('inFolderScope（书库页的核心谓词）', () => {
  it('下钻：只认本层直属，子分组的卷不算', () => {
    expect(inFolderScope('a/x.md', 'a', false)).toBe(true)
    expect(inFolderScope('a/b/y.md', 'a', false)).toBe(false)
    expect(inFolderScope('a/b/c/z.md', 'a', false)).toBe(false)
  })

  it('寻词：递归整棵子树', () => {
    expect(inFolderScope('a/x.md', 'a', true)).toBe(true)
    expect(inFolderScope('a/b/y.md', 'a', true)).toBe(true)
    expect(inFolderScope('a/b/c/z.md', 'a', true)).toBe(true)
  })

  it('不收兄弟分组——裸 startsWith 会把 ab 算进 a', () => {
    expect(inFolderScope('ab/w.md', 'a', true)).toBe(false)
    expect(inFolderScope('ab/w.md', 'a', false)).toBe(false)
    // 反过来也一样：a 的卷不该落进 ab
    expect(inFolderScope('a/x.md', 'ab', true)).toBe(false)
  })

  it('不收他处的卷', () => {
    expect(inFolderScope('other/w.md', 'a', true)).toBe(false)
    expect(inFolderScope('root.md', 'a', true)).toBe(false)
  })

  it('空路径即书库根，恒真——根就是整个书库', () => {
    expect(inFolderScope('root.md', '', false)).toBe(true)
    expect(inFolderScope('a/b/c/z.md', '', false)).toBe(true)
  })

  it('下钻与递归两档的差集恰是子树内其余部分', () => {
    const all = ['a/x.md', 'a/b/y.md', 'a/b/c/z.md', 'ab/w.md', 'root.md']
    const deep = all.filter((p) => inFolderScope(p, 'a', true))
    const here = all.filter((p) => inFolderScope(p, 'a', false))
    expect(here).toEqual(['a/x.md'])
    expect(deep).toEqual(['a/x.md', 'a/b/y.md', 'a/b/c/z.md'])
  })
})

describe('flattenVisibleRows', () => {
  const tree = () => buildFolderTree([], ['a', 'a/b', 'a/b/c', 'd'])

  it('根收起则一行不剩', () => {
    expect(flattenVisibleRows(tree(), { [TREE_ROOT_KEY]: false })).toEqual([])
  })

  it('默认（无展开记录）只显顶层，子层不外泄', () => {
    expect(flattenVisibleRows(tree(), {}).map((r) => r.node.path)).toEqual(['a', 'd'])
  })

  it('展开谁就显谁的下一层，且只显一层', () => {
    const rows = flattenVisibleRows(tree(), { a: true })
    expect(rows.map((r) => r.node.path)).toEqual(['a', 'a/b', 'd'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0])
  })

  it('逐层展开时按前序排列', () => {
    const rows = flattenVisibleRows(tree(), { a: true, 'a/b': true })
    expect(rows.map((r) => r.node.path)).toEqual(['a', 'a/b', 'a/b/c', 'd'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 0])
  })

  it('expandable 只在真有子分组时为真', () => {
    const rows = flattenVisibleRows(tree(), { a: true, 'a/b': true })
    expect(rows.find((r) => r.node.path === 'a/b/c')!.expandable).toBe(false)
    expect(rows.find((r) => r.node.path === 'a')!.expandable).toBe(true)
  })
})

describe('folderAncestors', () => {
  it('顶层分组无祖先（其父就是书库根）', () => {
    expect(folderAncestors('a')).toEqual([])
  })

  it('由外及内，不含自身', () => {
    expect(folderAncestors('a/b/c')).toEqual(['a', 'a/b'])
  })
})

describe('folderCrumbs', () => {
  it('空路径（书库根）得空数组', () => {
    expect(folderCrumbs('')).toEqual([])
  })

  it('逐级累计 path', () => {
    expect(folderCrumbs('a/b/c')).toEqual([
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
      { name: 'c', path: 'a/b/c' },
    ])
  })

  it('容忍多余与重复的分隔符', () => {
    expect(folderCrumbs('/a//b/')).toEqual([
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
    ])
  })
})

describe('folderScope', () => {
  it('拆出本层直属与子树其余', () => {
    const files = [file('a/x.md'), file('a/b/y.md'), file('a/b/c/z.md'), file('other.md')]

    expect(folderScope(files, 'a')).toEqual({ here: 1, below: 2 })
  })

  it('无子分组时 below 为 0', () => {
    expect(folderScope([file('a/x.md')], 'a')).toEqual({ here: 1, below: 0 })
  })

  it('空分组两项皆 0', () => {
    expect(folderScope([], 'a')).toEqual({ here: 0, below: 0 })
  })

  it('不把同前缀的兄弟分组算进来', () => {
    expect(folderScope([file('ab/w.md')], 'a')).toEqual({ here: 0, below: 0 })
  })

  it('根级文件不计入任何分组', () => {
    expect(folderScope([file('root.md')], 'a')).toEqual({ here: 0, below: 0 })
  })
})

describe('分组顺序（拖动排序 / 拖拽移动的落点）', () => {
  const paths = (nodes: FolderNode[]): string[] => collectFolderPaths(nodes)

  it('给了分组序就按它排，未记录的分组按名字补在其后', () => {
    const tree = buildFolderTree([], ['zeta', 'alpha', 'mu'], ['mu', 'zeta'])

    expect(paths(tree)).toEqual(['mu', 'zeta', 'alpha'])
  })

  it('分组序只在**同层**内比较，跨层的记录不影响本层', () => {
    // alpha 子层有 b/a，父层有 x/y：父层顺序不该被子层的记录干扰。
    const tree = buildFolderTree([], ['y', 'x', 'y/a', 'y/b'], ['y/b', 'y/a', 'x', 'y'])

    expect(tree.map((n) => n.path)).toEqual(['x', 'y'])
    expect(findNode(tree, 'y')?.children.map((c) => c.path)).toEqual(['y/b', 'y/a'])
  })

  it('没给分组序时退回名字序', () => {
    expect(paths(buildFolderTree([], ['b', 'a']))).toEqual(['a', 'b'])
  })

  it('mergeFolderOrder：同层重排写回全序', () => {
    const order = ['a', 'b', 'c']
    const next = mergeFolderOrder(order, new Map([['', ['c', 'a', 'b']]]))

    expect(next).toEqual(['c', 'a', 'b'])
  })

  it('mergeFolderOrder：序没变则返回 null（调用方据此跳过落盘）', () => {
    expect(mergeFolderOrder(['a', 'b'], new Map([['', ['a', 'b']]]))).toBeNull()
  })

  it('mergeFolderOrder：父在前、其子紧随——旧数据里交错也自愈', () => {
    // x 的子混在了 x 前面，重写后必须收拢到 x 之后。
    const order = ['x/a', 'x', 'y', 'x/b']
    const next = mergeFolderOrder(order, new Map([['x', ['x/b', 'x/a']]]))

    expect(next).toEqual(['x', 'x/b', 'x/a', 'y'])
  })

  it('mergeFolderOrder：根层与子层可以在一次提交里一起改（拖拽移动的源/目标两级）', () => {
    // 真实场景：b 的孩子本就在序里，只是跟着 b 一起换到最前。
    const order = ['a', 'b', 'b/1', 'b/2']
    const next = mergeFolderOrder(
      order,
      new Map([
        ['', ['b', 'a']],
        ['b', ['b/2', 'b/1']],
      ]),
    )

    expect(next).toEqual(['b', 'b/2', 'b/1', 'a'])
  })
})

describe('分组名校验', () => {
  it('空名与含分隔符的名字各有各的缘由', () => {
    expect(checkFolderName('   ')).toBe('empty')
    expect(checkFolderName('a/b')).toBe('separator')
    expect(checkFolderName('a\\b')).toBe('separator')
    expect(checkFolderName('  正常名字  ')).toBeNull()
  })

  it('同级重名照当前树判，大小写不敏感', () => {
    const dirs = ['Java', 'MySQL/索引']

    expect(folderNameTaken(dirs, '', 'Java')).toBe(true)
    expect(folderNameTaken(dirs, '', 'java')).toBe(true) // Windows/macOS 上是同一个目录
    expect(folderNameTaken(dirs, 'MySQL', '索引')).toBe(true)
    expect(folderNameTaken(dirs, 'Redis', '索引')).toBe(false) // 不同父级，同名无妨
    expect(folderNameTaken(dirs, '', 'SpringBoot')).toBe(false)
  })

  it('改自身的大小写不算重名（Java → java 得放行）', () => {
    expect(folderNameTaken(['Java'], '', 'java', 'Java')).toBe(false)
    expect(folderNameTaken(['Java'], '', 'JVM', 'Java')).toBe(false)
  })

  it('取同级父分组：根层为空串', () => {
    expect(folderParentOf('Java')).toBe('')
    expect(folderParentOf('a/b/c')).toBe('a/b')
  })
})
