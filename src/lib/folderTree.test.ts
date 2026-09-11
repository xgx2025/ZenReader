import { describe, expect, it } from 'vitest'

import type { FolderNode, VaultFile } from '@/types/document'
import {
  buildFolderTree,
  collectFolderPaths,
  findNode,
  folderCrumbs,
  folderScope,
  inFolderScope,
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
