import { ref, type Ref } from 'vue'

import type { VaultFile } from '@/types/document'

/**
 * 拖动排序就地拖拽核心（无第三方依赖，Pointer Events + rAF）。
 *
 * 约定：视图持有一份"拖动排序工作序列" `paths`（vault 相对路径），本 composable 在拖拽中
 * 以 splice 就地重排该数组；其余卡片由视图的 `<TransitionGroup>` `.arrange-move`
 * FLIP 动画让位。被拿起卷的原位由视图依据 `drag.started` 渲染为隐藏占位格（slot），
 * 克隆浮层亦由视图 Teleport 渲染并跟随 `drag.x / drag.y`。
 *
 * 判位采用"行带 + 格心中线"法，兼容响应式 CSS grid 换行：每帧量取各格 rect 聚成行带，
 * 找指针所在/最近的行带，数出"排于指针之前"的非拖拽格数量即得目标下标。
 */
export interface PickPayload {
  path: string
  event: PointerEvent
  el: HTMLElement
}

export interface DragState {
  path: string
  file: VaultFile
  /** 拖拽开始时的工作序列快照——取消时还原，保证"松手不改序"。 */
  startOrder: string[]
  /** 是否已超过拾取阈值（真正"拿起"）。阈值内的轻按/微移不产生任何效果。 */
  started: boolean
  /** 克隆左上角（视口坐标）。 */
  x: number
  y: number
  /** 克隆宽度：取自源卡 rect。 */
  width: number
  /** 指针相对被拿起卷左上角的抓取偏移。 */
  grabDX: number
  grabDY: number
}

export interface CardArrangeOptions {
  /** 拖动排序工作序列（视图持有，拖拽中会被就地重排）。 */
  paths: Ref<string[]>
  /** TransitionGroup 渲染出的网格元素（其 element 子节点顺序 == paths 顺序）。 */
  getGrid: () => HTMLElement | null
  /** 滚动容器（书库 main），供边缘自动滚动。 */
  getScroll: () => HTMLElement | null
  lookupFile: (path: string) => VaultFile | null
  /** 一次落子提交（视图据此 commitVisibleMove；内部无变化时不调用）。 */
  onCommit: (movedPath: string) => void
}

const DRAG_THRESHOLD = 6 // px：超过才视为"拿起"
const EDGE_ZONE = 64 // px：距滚动容器上/下缘进入自动滚动带
const MAX_SCROLL = 16 // px/frame：边缘最大滚动速度
const ROW_TOLERANCE = 6 // px：同一行 top 聚类容差

export function useCardArrange(opts: CardArrangeOptions) {
  const drag = ref<DragState | null>(null)

  let raf = 0
  let active = false
  let px = 0
  let py = 0
  let ox = 0
  let oy = 0
  let el: HTMLElement | null = null
  let pointerId = -1

  function detach(): void {
    active = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('blur', onCancel)
    document.removeEventListener('visibilitychange', onVisibility)
    document.body.classList.remove('arrange-drag-active')
    document.body.style.userSelect = ''
    const grid = opts.getGrid()
    if (grid) grid.style.touchAction = ''
    if (el && pointerId >= 0) {
      try {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
      } catch {
        /* pointer 已失效，忽略 */
      }
    }
    el = null
    pointerId = -1
  }

  function beginDrag(d: DragState): void {
    d.started = true
    d.x = px - d.grabDX
    d.y = py - d.grabDY
    document.body.classList.add('arrange-drag-active')
    document.body.style.userSelect = 'none'
    const grid = opts.getGrid()
    if (grid) grid.style.touchAction = 'none'
    active = true
    raf = requestAnimationFrame(loop)
  }

  function loop(): void {
    const d = drag.value
    if (!d?.started) return
    d.x = px - d.grabDX
    d.y = py - d.grabDY
    moveTo(computeTarget(px, py))
    autoScroll()
    raf = requestAnimationFrame(loop)
  }

  /** 拾取一张卷（DocumentCard 的 pick emit）。 */
  function onPick(payload: PickPayload): void {
    if (drag.value) return
    const file = opts.lookupFile(payload.path)
    if (!file) return
    const rect = payload.el.getBoundingClientRect()
    el = payload.el
    pointerId = payload.event.pointerId
    ox = px = payload.event.clientX
    oy = py = payload.event.clientY
    drag.value = {
      path: payload.path,
      file,
      startOrder: opts.paths.value.slice(),
      started: false,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      grabDX: px - rect.left,
      grabDY: py - rect.top,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onCancel)
    document.addEventListener('visibilitychange', onVisibility)
  }

  function onPointerMove(e: PointerEvent): void {
    const d = drag.value
    if (!d) return
    px = e.clientX
    py = e.clientY
    if (d.started) return // loop 已在 rAF 里消费
    // 未起手：超过阈值才真正"拿起"
    if (Math.hypot(px - ox, py - oy) < DRAG_THRESHOLD) return
    beginDrag(d)
  }

  function onPointerUp(e: PointerEvent): void {
    const d = drag.value
    if (!d) return
    const commit = d.started
    detach()
    drag.value = null
    if (commit) opts.onCommit(d.path)
  }

  function onPointerCancel(): void {
    cancelDrag()
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') cancelDrag()
  }

  function onCancel(): void {
    cancelDrag()
  }

  /** 取消本次拖拽：还原序列、收起克隆。拖动排序态仍在，是否退出由视图决定。 */
  function cancelDrag(): void {
    const d = drag.value
    if (!d) return
    detach()
    if (d.started) {
      const cur = opts.paths.value
      const same =
        cur.length === d.startOrder.length &&
        cur.every((p, i) => p === d.startOrder[i])
      if (!same) opts.paths.value = d.startOrder.slice()
    }
    drag.value = null
  }

  /** 目标位（0..N-1）= 排于指针之前的非拖拽格数量。 */
  function computeTarget(pointerX: number, pointerY: number): number {
    const grid = opts.getGrid()
    const d = drag.value
    if (!grid || !d) return 0
    const paths = opts.paths.value
    const N = paths.length
    const pIndex = paths.indexOf(d.path)
    if (pIndex === -1 || N < 2) return 0

    const cells: { top: number; bottom: number; cx: number }[] = []
    const els = Array.from(grid.children) as HTMLElement[]
    // 行带由"非拖拽格"构成：指针常落在拖拽格上，跳过它仍可靠相邻格定位行列。
    for (let i = 0; i < els.length && i < N; i++) {
      if (i === pIndex) continue
      const rect = els[i].getBoundingClientRect()
      if (rect.width <= 0 && rect.height <= 0) continue
      cells.push({ top: rect.top, bottom: rect.bottom, cx: rect.left + rect.width / 2 })
    }
    if (cells.length === 0) return 0

    const sorted = [...cells].sort((a, b) => a.top - b.top)
    const bands: { top: number; bottom: number; cells: typeof cells }[] = []
    for (const c of sorted) {
      const band = bands[bands.length - 1]
      if (band && c.top - band.top <= ROW_TOLERANCE) {
        band.bottom = Math.max(band.bottom, c.bottom)
        band.cells.push(c)
      } else {
        bands.push({ top: c.top, bottom: c.bottom, cells: [c] })
      }
    }

    if (pointerY < bands[0].top) return 0
    if (pointerY > bands[bands.length - 1].bottom) return N - 1

    let band = bands[0]
    let best = Infinity
    for (const b of bands) {
      const contained = pointerY >= b.top && pointerY <= b.bottom
      const dist = contained ? 0 : Math.abs(pointerY - (b.top + b.bottom) / 2)
      if (dist < best) {
        best = dist
        band = b
      }
    }

    let count = 0
    for (const b of bands) {
      if (b === band) {
        for (const c of b.cells) if (c.cx < pointerX) count++
        break
      }
      count += b.cells.length
    }
    return Math.max(0, Math.min(count, N - 1))
  }

  function moveTo(target: number): void {
    const d = drag.value
    if (!d) return
    const arr = opts.paths.value
    const pIndex = arr.indexOf(d.path)
    if (pIndex === -1 || pIndex === target) return
    arr.splice(pIndex, 1)
    arr.splice(target, 0, d.path)
  }

  function autoScroll(): void {
    const scroll = opts.getScroll()
    if (!scroll) return
    const r = scroll.getBoundingClientRect()
    let dir = 0
    if (py < r.top + EDGE_ZONE) dir = -1
    else if (py > r.bottom - EDGE_ZONE) dir = 1
    if (!dir) return
    const dist = dir < 0 ? r.top + EDGE_ZONE - py : py - (r.bottom - EDGE_ZONE)
    const speed = Math.min(MAX_SCROLL, Math.max(4, (dist / EDGE_ZONE) * MAX_SCROLL))
    scroll.scrollTop += dir * speed
  }

  return { drag, onPick, cancelDrag }
}
