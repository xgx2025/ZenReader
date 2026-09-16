/**
 * 书库分组的纯算法：建树、计数、路径展开、面包屑与作用域统计。全部无副作用、
 * 可单测；状态接线见 stores/library.ts。
 */
import { folderPathFromRelative } from './vault'
import type { FolderNode, VaultFile } from '@/types/document'

/** 书库根的展开键：根不是真实分组，用一个不会与路径相撞的哨兵值占位。 */
export const TREE_ROOT_KEY = '__vault_root__'

/** 树里的一行（展平后交侧栏渲染）：节点 + 层级 + 是否有子分组。 */
export interface FolderRow {
  node: FolderNode
  depth: number
  expandable: boolean
}

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

function sortNodes(nodes: FolderNode[], order?: Record<string, number>): void {
  nodes.sort((a, b) => {
    if (order) {
      const ra = order[a.path]
      const rb = order[b.path]
      // 未记录的分组排在已记录之后，内部仍按名字——用户显式排过的位置最优先。
      if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb
      if (ra !== undefined && rb === undefined) return -1
      if (ra === undefined && rb !== undefined) return 1
    }
    return a.name.localeCompare(b.name, 'zh')
  })
  for (const n of nodes) sortNodes(n.children, order)
}

/** 把「分组路径的全序」压成 rank 表，供 `buildFolderTree` 排同层先后。 */
export function folderRank(order: string[]): Record<string, number> {
  const rank: Record<string, number> = {}
  order.forEach((path, i) => {
    if (!(path in rank)) rank[path] = i
  })
  return rank
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

export function buildFolderTree(
  files: VaultFile[],
  dirs: string[],
  folderOrder: string[] = [],
): FolderNode[] {
  const root: FolderNode[] = []
  const map = new Map<string, FolderNode>()

  const ensureNode = (path: string): FolderNode => {
    let node = map.get(path)
    if (node) return node
    const name = path.split('/').pop() ?? path
    node = { name, path, children: [], count: 0, here: 0 }
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
    const node = ensureNode(folder)
    node.count += 1
    node.here += 1
  }

  rollUp(root)
  sortNodes(root, folderOrder.length ? folderRank(folderOrder) : undefined)
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

/**
 * 把树按展开态**展平**成可见行（前序）。侧栏据此渲染一个扁平列表而非递归组件：
 * 键盘上下移动、`role="tree"` 的层级语义、错峰入场都只需在一条序列上做。
 *
 * 根层由 `expanded[TREE_ROOT_KEY]` 统辖——收起根即收起全部分组，留下「书库」一行。
 * 「选中」与「展开」是两件事：本函数只看展开态，绝不因选中而展开任何一层。
 */
export function flattenVisibleRows(
  nodes: FolderNode[],
  expanded: Record<string, boolean>,
): FolderRow[] {
  const rows: FolderRow[] = []
  const walk = (ns: FolderNode[], depth: number): void => {
    for (const n of ns) {
      const expandable = n.children.length > 0
      rows.push({ node: n, depth, expandable })
      if (expandable && expanded[n.path]) walk(n.children, depth + 1)
    }
  }
  if (expanded[TREE_ROOT_KEY] !== false) walk(nodes, 0)
  return rows
}

/** 某分组的祖先链（由外及内，不含自身）——展开定位与聚焦回退共用。 */
export function folderAncestors(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const part of parts.slice(0, -1)) {
    cur = cur ? `${cur}/${part}` : part
    out.push(cur)
  }
  return out
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

/** 新建 / 重命名分组时，名字本身的合法性问题（与盘上状态无关）。 */
export type FolderNameIssue = 'empty' | 'separator'

/**
 * 校验一个分组名。只回答「这个名字本身能不能用」——重名要另看盘上的兄弟，
 * 那是 `folderNameTaken` 的事。
 *
 * 分隔符必须拒绝：名字里带 `/` 会被当成路径，等于偷偷换了一层。
 */
export function checkFolderName(name: string): FolderNameIssue | null {
  const clean = name.trim()
  if (!clean) return 'empty'
  if (clean.includes('/') || clean.includes('\\')) return 'separator'
  return null
}

/**
 * 目标路径是否已被**别的**分组占用（同级重名）。用于重命名与拖拽移动的前置校验：
 * 让用户当场看到「已有同名分组」，而不是提交后收一条 toast。
 *
 * 大小写不敏感——Windows / macOS 上 `Java` 与 `java` 是同一个目录，提前拦住比让
 * `fs::rename` 在盘上抛错更好解释。`self` 传原路径：改自身的大小写不算冲突。
 */
export function folderNameTaken(
  dirs: string[],
  parent: string,
  name: string,
  self = '',
): boolean {
  const target = (parent ? `${parent}/${name.trim()}` : name.trim()).toLowerCase()
  const own = self.toLowerCase()
  return dirs.some((d) => d.toLowerCase() === target && d.toLowerCase() !== own)
}

/** 取路径的同级父分组（根层返回空串）。 */
export function folderParentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
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

/**
 * 把「某些父分组下、按当前显示序排列的子分组」重写回**全序**。
 *
 * 拖动排序与拖拽移动共用它。存储里是一份分组路径的全局全序，而侧栏只看得见同层
 * 兄弟，所以做法是**规范化重建**：按「父在前、其子紧随其后」的次序重新走一遍，
 * 走到某个父分组时就地把它在本次重写范围内的子分组按显示序铺开。
 *
 * `parents` 是「父分组路径 → 该父下子分组的**完整**显示序」（父为空串即根层），
 * 只需给出本次拖动影响到的父级。未被提到的分组只在自己被轮到时落座，故它们的
 * **相对先后**不变（绝对位置可能前移，因为父与子被收拢了）。
 *
 * 由此得到一个不变量：同一父的子分组在序里必定连成一段、紧跟在父之后。旧数据里
 * 若曾交错，读一次就自愈。
 *
 * 返回 null 表示全序没变，调用方据此跳过落盘。
 */
export function mergeFolderOrder(
  order: string[],
  parents: Map<string, string[]>,
): string[] | null {
  if (!parents.size) return null

  const out: string[] = []
  const seen = new Set<string>()

  /**
   * 放下一张牌：先它自己、再它的子分组（按显示序）。
   * 本函数只做**去重**，绝不把已经放过的分组再挪一次——否则「已发过」与
   * 「已落对位置」就被混为一谈，交错序会原样漏过去（`x/a` 先于 `x` 出现时，
   * 轮到 `x` 只是把它标记为已见，子分组一个都没归位）。
   */
  const walk = (p: string) => {
    if (seen.has(p)) return
    // 轮到子分组时，若它的父也在本次重写范围里却还没落座，先把父走完——否则会写出
    // 「子在前、父在后」的序（`x/a` 先于 `x` 出现时正是如此）。
    const cut = p.lastIndexOf('/')
    const parent = cut === -1 ? '' : p.slice(0, cut)
    if (parent && parents.has(parent) && !seen.has(parent)) walk(parent)
    if (seen.has(p)) return
    seen.add(p)
    out.push(p)
    const kids = parents.get(p)
    if (kids) kids.forEach(walk)
  }

  // 根层先走：书库根没有父元素，但它的子分组必须排在最前。
  ;(parents.get('') ?? []).forEach(walk)
  // 其余分组按原序轮到：本次没提到的原样穿过，被提到的带着子树就地就位。
  //
  // 漏在 `order` 之外、但出现在本次拖动结果里的路径（比如刚搬过去、父级还没
  // 记录过的分组）：补在末尾，让它在下次读入时仍可解释。
  for (const p of order) walk(p)
  for (const kids of parents.values()) kids.forEach(walk)

  return out.join('\u0000') === order.join('\u0000') ? null : out
}
