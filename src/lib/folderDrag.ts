/**
 * 侧栏分组拖动的**纯逻辑**：从指针位置解出落点、把落点折成「要不要动、怎么动」。
 *
 * 为什么把它从组件里拔出来：原先这套判定长在 `FolderTree.vue` 的 DOM 事件里，只能靠
 * 合成 `DragEvent` 间接验；而这次的病根正是 HTML5 拖放协议本身不稳（详见
 * `doc/sidebar-ux.md` 第六、七轮）。改走指针事件后，判定与「哪来的事件」再无关系，
 * 于是可以整块拿出来单测。
 */
import { folderParentOf } from './folderTree'

/** 落点：目标分组路径 + 落在其前 / 后 / 内部。 */
export interface FolderDropSpot {
  path: string
  mode: 'before' | 'after' | 'inside'
}

/** 参与命中的一行：路径 + 它在视口里的盒（拖拽中每帧重新量）。 */
export interface FolderRowBox {
  path: string
  /** 该行能否接住子分组（不可展开的组「放进去」等于把它改名，故整行只表达前/后）。 */
  expandable: boolean
  top: number
  bottom: number
}

/** 行内纵向分区：上 1/4 排前、下 1/4 排后、中段移入（与拖拽提示线的画法同源）。 */
const EDGE_RATIO = 0.25

/**
 * 指针 y → 落点。
 *
 * 行序即"从上面压下来"的顺序，所以判据很直白——**第一行满足 `clientY <= 行下缘`
 * 的就是它**：
 *
 * - `clientY` 在某行上半 → before，下半 → after（可展开的组中段则是 inside）；
 * - 落在行距那条 1px 缝隙里 → 归到**下面那一行的 before**。这与视觉一致：缝隙正是
 *   「插在这两行之间」，而 before 下一行就是那个意思；
 * - 比第一行还高 → 首行的 before；比最后一行还低 → 末行的 after（旧实现在这里
 *   一律给"末行之后"，指针停在末行上方几像素时也会被甩到末尾）。
 */
export function resolveFolderDrop(
  boxes: FolderRowBox[],
  clientY: number,
): FolderDropSpot | null {
  if (!boxes.length) return null
  for (const box of boxes) {
    const height = box.bottom - box.top
    // 还在这一行下面：记下"排在它后面"，继续往下找更贴近的那一行
    if (clientY > box.bottom) continue

    const edge: 'before' | 'after' = clientY < box.top + height / 2 ? 'before' : 'after'
    if (!box.expandable) return { path: box.path, mode: edge }
    const ratio = (clientY - box.top) / height
    if (clientY <= box.top || ratio < EDGE_RATIO) return { path: box.path, mode: 'before' }
    if (ratio > 1 - EDGE_RATIO) return { path: box.path, mode: 'after' }
    return { path: box.path, mode: 'inside' }
  }
  const last = boxes[boxes.length - 1]
  return { path: last.path, mode: 'after' }
}

/** 落点折成的目标路径；`null` 表示「不搬家」（同层排序，或压根没动）。 */
export function folderDropTarget(dragged: string, spot: FolderDropSpot): string | null {
  const name = dragged.split('/').pop() ?? dragged
  if (spot.mode === 'inside') {
    // 放进自己当前的父级 ＝ 没动
    return spot.path === folderParentOf(dragged) ? null : `${spot.path}/${name}`
  }
  // 前/后 ＝ 插到目标所在层里：新父级就是目标的父级
  const parent = folderParentOf(spot.path)
  if (parent === folderParentOf(dragged)) return null // 同层排序走 reorder
  return parent ? `${parent}/${name}` : name
}

/** 一次落子要做什么。`null` 表示这次手势不构成任何改变（no-op）。 */
export type FolderDropPlan =
  /** 同层排序：不动盘，只重写这个父级下的显示序。 */
  | { kind: 'reorder'; parent: string; order: string[] }
  /** 跨层搬家：把 `from` 搬到 `to`（走 rename_dir，含笔记/进度/顺序迁移）。 */
  | { kind: 'move'; from: string; to: string; parent: string }
  | null

/**
 * 把「被拖的组、落点、该父级下的当前显示序」折成一次动作。
 *
 * `childrenOf(parent)` 给出该父级下、按**当前显示序**排列的直接子分组路径——
 * 排序与落点都按它算，否则「落在第几位」会算在一个看不见的序上。
 */
export function planFolderDrop(
  dragged: string,
  spot: FolderDropSpot,
  childrenOf: (parent: string) => string[],
): FolderDropPlan {
  if (!dragged) return null
  // 放进自己或自己的子树里会让整棵子树消失，后端也会拒绝——先拦，理由由调用方给。
  if (spot.mode === 'inside' && (spot.path === dragged || spot.path.startsWith(`${dragged}/`))) {
    return null
  }

  const target = folderDropTarget(dragged, spot)
  if (target) {
    return { kind: 'move', from: dragged, to: target, parent: folderParentOf(target) }
  }

  if (spot.mode === 'inside') return null

  const parent = folderParentOf(spot.path)
  const current = childrenOf(parent)
  const order = current.filter((p) => p !== dragged)
  const at = order.indexOf(spot.path)
  const index = at === -1 ? order.length : spot.mode === 'before' ? at : at + 1
  order.splice(index, 0, dragged)
  // 算完等于现状（把 A 放到紧邻的 B 之前）就是 no-op：不能报一次"改了顺序"，
  // 否则一次看起来没动的拖动会白白写一次 folderOrder。
  if (order.join('\u0000') === current.join('\u0000')) return null
  return { kind: 'reorder', parent, order }
}
