/**
 * 拖动排序（手动排布）的纯算法。全部无副作用、可单测；状态接线见 stores/library.ts，
 * 持久化见 arrangeStorage.ts。
 */

export interface ArrangeFileLike {
  relativePath: string
  /** 毫秒时间戳，用于"多卷新到按最近在前"的插入次序。 */
  mtime: number
}

export interface ReconcileResult {
  /** 清洗/插入后的完整序列。 */
  order: string[]
  /** 本轮真正"新到"的卷（已立于最前）；rename 不算。 */
  arrivals: string[]
}

/** 相对路径的 basename（末段，不含分隔符）。 */
function basename(relativePath: string): string {
  const i = relativePath.lastIndexOf('/')
  return i === -1 ? relativePath : relativePath.slice(i + 1)
}

/**
 * 把 customOrder 与新一轮 readVault 结果对齐：
 * 1. rename 启发——消失/出现各 1 条且 basename 相同（覆盖"移到分组"这类库内移动），
 *    旧路径原位替换成新路径，不视为新卷、不立最前；
 * 2. 剪除已消失路径；
 * 3. 剩余新到卷按 mtime 升序逐条 unshift——最终最"新"者排在序列最前。
 */
export function reconcileCustomOrder(
  prevCustom: string[],
  nextFiles: ArrangeFileLike[],
  prevPaths: Set<string>,
): ReconcileResult {
  const nextPaths = new Set(nextFiles.map((f) => f.relativePath))

  const appeared = nextFiles.filter((f) => !prevPaths.has(f.relativePath))

  if (prevCustom.length > 0) {
    const disappeared = [...prevPaths].filter((p) => !nextPaths.has(p))
    if (
      disappeared.length === 1 &&
      appeared.length === 1 &&
      prevCustom.includes(disappeared[0]) &&
      basename(disappeared[0]) === basename(appeared[0].relativePath)
    ) {
      const oldPath = disappeared[0]
      const newPath = appeared[0].relativePath
      return {
        order: prevCustom.map((p) => (p === oldPath ? newPath : p)),
        arrivals: [],
      }
    }
  }

  // 常规：剪除消失路径，再把新到卷按时间升序逐一立到最前（最新最终在最前）。
  const order = prevCustom.filter((p) => nextPaths.has(p))
  const fresh = appeared.slice().sort((a, b) => a.mtime - b.mtime)
  for (const f of fresh) order.unshift(f.relativePath)
  return { order, arrivals: fresh.map((f) => f.relativePath) }
}

/**
 * 单卡位移合并：把过滤视图（分组/搜索）中拖动后的可见新序，稳定合并回全库序列。
 *
 * 规则：movedPath 若在 newVisible 中非首位 → 紧随其"前驱可见卷"之后插入；若移顶
 * （首位）→ 插在首个非 movedPath 的可见卷之前。无实际变化时返回 null（调用方据此
 * 判定"不算一次有效排布"）。
 */
export function mergeVisibleMove(
  global: string[],
  newVisible: string[],
  movedPath: string,
): string[] | null {
  const idx = global.indexOf(movedPath)
  const pos = newVisible.indexOf(movedPath)
  if (idx === -1 || pos === -1 || newVisible.length < 2) return null

  const rest = global.filter((p) => p !== movedPath)
  const insertAt = (arr: string[], i: number) => {
    const s = arr.slice()
    s.splice(i, 0, movedPath)
    return s
  }

  if (pos === 0) {
    const anchor = newVisible[1]
    const ai = rest.indexOf(anchor)
    if (ai === -1) return null
    return insertAt(rest, ai)
  }
  const pred = newVisible[pos - 1]
  const pi = rest.indexOf(pred)
  if (pi === -1) return null
  const next = insertAt(rest, pi + 1)
  return arraysEqual(next, global) ? null : next
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * 返回自定义序的排名函数：命中给序号；未命中（防御，正常不应发生）给序列长度，使
 * unknown 整体靠后、且彼此并列——并列时由调用方以 mtime 兜底保证稳定。
 */
export function customRank(customOrder: string[]): (path: string) => number {
  const map = new Map<string, number>()
  for (let i = 0; i < customOrder.length; i++) map.set(customOrder[i], i)
  const fallback = customOrder.length
  return (path: string) => map.get(path) ?? fallback
}
