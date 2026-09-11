/**
 * 书库分组的纯算法：建树、计数、路径展开、面包屑与作用域统计。全部无副作用、
 * 可单测；状态接线见 stores/library.ts。
 */
import { folderPathFromRelative } from './vault'
import type { FolderNode, VaultFile } from '@/types/document'

/** 面包屑片段：该级显示名 + 累计到该级的完整路径。 */
export interface FolderCrumb {
  name: string
  path: string
}

/** 一个分组的作用域：`here` 本层直属，`below` 子树内其余（不含本层）。 */
export interface FolderScope {
  here: number
  below: number
}

function sortNodes(nodes: FolderNode[]): void {
  nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  for (const n of nodes) sortNodes(n.children)
}

/**
 * 自底向上把子分组的卷数累加进父分组，使 count 即**整棵子树**的卷数。
 *
 * 这既让侧栏计数与右侧所见一致，也让 `count === 0` 恰好等价于后端的可释怀判定
 * （remove_folder 要求整个子树无文件）。返回子树内的总数，供上层继续累加。
 */
function rollUp(nodes: FolderNode[]): number {
  let total = 0
  for (const n of nodes) {
    n.count += rollUp(n.children)
    total += n.count
  }
  return total
}

export function buildFolderTree(files: VaultFile[], dirs: string[]): FolderNode[] {
  const root: FolderNode[] = []
  const map = new Map<string, FolderNode>()

  const ensureNode = (path: string): FolderNode => {
    let node = map.get(path)
    if (node) return node
    const name = path.split('/').pop() ?? path
    node = { name, path, children: [], count: 0 }
    map.set(path, node)
    return node
  }

  // Establish all directory nodes first, so empty folders still show up.
  for (const dir of dirs) {
    const parts = dir.split('/').filter(Boolean)
    let siblings = root
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const node = ensureNode(currentPath)
      if (!siblings.includes(node)) siblings.push(node)
      siblings = node.children
    }
  }

  // Count files directly under each folder. 根级文件不属于任何分组——漏掉这道守卫会
  // 用空字符串 mint 出一个空名节点，故必须保留。
  for (const f of files) {
    const folder = folderPathFromRelative(f.relativePath)
    if (!folder) continue
    ensureNode(folder).count += 1
  }

  rollUp(root)
  sortNodes(root)
  return root
}

/** 分组路径的前序展开（父在子前）——「移到分组」与导入落点下拉共用。 */
export function collectFolderPaths(nodes: FolderNode[]): string[] {
  const acc: string[] = []
  const walk = (ns: FolderNode[]): void => {
    for (const n of ns) {
      acc.push(n.path)
      walk(n.children)
    }
  }
  walk(nodes)
  return acc
}

/** 按路径取节点；未命中返回 null。 */
export function findNode(nodes: FolderNode[], path: string): FolderNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    const hit = findNode(n.children, path)
    if (hit) return hit
  }
  return null
}

/** 分组路径 → 逐级面包屑片段；空路径（书库根）得空数组。 */
export function folderCrumbs(path: string): FolderCrumb[] {
  const out: FolderCrumb[] = []
  let cur = ''
  for (const part of path.split('/').filter(Boolean)) {
    cur = cur ? `${cur}/${part}` : part
    out.push({ name: part, path: cur })
  }
  return out
}

/**
 * 分组归属谓词：某卷是否落在该分组的作用域内。
 *
 * - `recursive` 为真 → 含整棵子树（寻词时用：要找东西，不必先猜它在哪一层）；
 * - `recursive` 为假 → 只认本层直属（下钻时用：子分组交给左树与面包屑导航）。
 *
 * 空路径即书库根，恒真（根就是整个书库）。
 * 边界靠 `${folder}/` 收口——裸 startsWith(folder) 会把兄弟分组 `ab` 算进 `a`。
 */
export function inFolderScope(
  relativePath: string,
  folder: string,
  recursive: boolean,
): boolean {
  if (!folder) return true
  const dir = folderPathFromRelative(relativePath)
  if (dir === folder) return true
  return recursive && dir.startsWith(`${folder}/`)
}

/**
 * 统计某分组的作用域拆分，供「本层 N 篇 · 子分组内另有 M 篇」提示行使用。
 * 入参应是**已按卷式过滤**的列表，好让数字与用户接下来看到的相符。
 */
export function folderScope(
  files: { relativePath: string }[],
  folderPath: string,
): FolderScope {
  const prefix = `${folderPath}/`
  let here = 0
  let below = 0
  for (const f of files) {
    const folder = folderPathFromRelative(f.relativePath)
    if (folder === folderPath) here += 1
    else if (folder.startsWith(prefix)) below += 1
  }
  return { here, below }
}
