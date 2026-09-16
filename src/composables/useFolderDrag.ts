import { onBeforeUnmount, ref, type Ref } from 'vue'

import { resolveFolderDrop, type FolderDropSpot, type FolderRowBox } from '@/lib/folderDrag'

/**
 * 侧栏分组拖动：**指针事件**实现（Pointer Events + rAF），不走 HTML5 拖放。
 *
 * 为什么换掉 `draggable` / `dragstart` / `dragover` / `drop` 那一套：
 *
 * 1. 在 Windows 的 WebView2 里它**会丢**——同一手势反复做，`drop` 时有时无，
 *    表现就是用户说的「一直显示禁止光标、松手毫无变化」。真机探针实测
 *    （`tools/ui-preview/app-probe.mjs`）：12 步快速移动时 drop 常在 0/1 之间跳；
 *    把落点算法换回旧版、乃至关掉 Tauri 自己的拖放处理器，都还是那样。这是协议层
 *    的不可靠，不是判定写错了。
 * 2. 书库卡片的拖动排序（`useCardArrange`）本来就是指针事件，一直稳。两条路统一后，
 *    侧栏与主区的手感也一致。
 *
 * 与 `useCardArrange` 的分工：那边要在一张会换行的网格里算「第几格」，这边只需在一条
 * 竖列上算「第几位」——判定已抽到 `lib/folderDrag` 的纯函数里，这里只管手势与 DOM。
 * 也因此，本文件里所有 `getBoundingClientRect` 都只读不写：**不给行加 transform**
 * （那会改变盒、让每帧的落点判定跟着漂）；"被拿起"的视觉交给透明度与插入线。
 */
export interface FolderDragState {
  /** 被拿起的组路径。 */
  path: string
  /** 指针视口坐标（留给将来的跟手浮标；落点判定不用它）。 */
  x: number
  y: number
}

export interface FolderDragOptions {
  /** 整个树容器（行序与盒都从它里面量，滚动也走它）。 */
  getEl: () => HTMLElement | null
  /** 可见行（展平序）：顺序即命中顺序。 */
  getRows: () => { path: string; expandable: boolean }[]
  /** 拖动确实开始了（越过阈值）。 */
  onStart: (path: string) => void
  /** 落点变化（可能为 null：指针离开整棵树）。 */
  onOver: (spot: FolderDropSpot | null) => void
  /**
   * 松手落子。**两个状态都随参数交出**，不靠调用方回头读 ref——`onDrop` 之后
   * 手势状态就被清空了（"拖过没有"仍要留给随后的 click 判断用）。
   *
   * @param path   被拿起的组路径（没拖动过则为空串）
   * @param spot   松手时的落点（可能为 null：指针不在任何一行上）
   */
  onDrop: (moved: boolean, path: string, spot: FolderDropSpot | null) => void
}
/** 位移之和超过它才算「拿起」——否则一次轻按会被当成拖动，点选分组就失灵了。 */
const DRAG_THRESHOLD = 5
/** 距容器上/下缘多近开始自动滚动。 */
const EDGE_ZONE = 48
/** 自动滚动最大速度（px/帧）。 */
const MAX_SCROLL = 12

export function useFolderDrag(opts: FolderDragOptions): {
  drag: Ref<FolderDragState | null>
  over: Ref<FolderDropSpot | null>
  /** 行上 `pointerdown` 的入口。 */
  onPointerDown: (path: string, ev: PointerEvent) => void
  /** 行上 `click` 的入口：上一次手势若是拖动，就吞掉这次点击。 */
  shouldSwallowClick: () => boolean
} {
  const drag = ref<FolderDragState | null>(null)
  const over = ref<FolderDropSpot | null>(null)

  /**
   * 本次手势是否已经拖动过。**不能只看 `drag.value`**：松手那一刻它就清空了，
   * 而 `click` 是在 `pointerup` **之后**才派发的——留着它才吞得掉「拖完那一下」的误点选。
   */
  let dragged = false
  let active = false
  let startPath = ''
  let startX = 0
  let startY = 0
  let startPointerId = -1
  /** 按下时命中的那个元素：真正"拿起"时才在它上面捕获指针（见 capturePointer）。 */
  let pressTarget: HTMLElement | null = null
  let raf = 0
  let scrollDir = 0

  /** 逐行量盒：拖拽中每帧都重量（行可能因展开/收缩、滚动而移位）。 */
  function rowBoxes(): FolderRowBox[] {
    const el = opts.getEl()
    if (!el) return []
    const expandable = new Map(opts.getRows().map((r) => [r.path, r.expandable]))
    const out: FolderRowBox[] = []
    for (const li of el.querySelectorAll<HTMLElement>('.folder-row')) {
      const path = li.dataset.folderRow
      if (!path) continue
      const r = li.getBoundingClientRect()
      out.push({ path, expandable: expandable.get(path) ?? false, top: r.top, bottom: r.bottom })
    }
    return out
  }

  function updateOver(clientY: number): void {
    const next = resolveFolderDrop(rowBoxes(), clientY)
    const cur = over.value
    if (next?.path === cur?.path && next?.mode === cur?.mode) return
    over.value = next
    opts.onOver(next)
  }

  /** 指针贴近容器上下缘时自动滚动：一帧一步，滚动后落点要重量（行跟着动了）。 */
  function tick(): void {
    if (!active || !drag.value) {
      raf = 0
      return
    }
    const el = opts.getEl()
    if (el && scrollDir !== 0) {
      const before = el.scrollTop
      el.scrollTop += scrollDir * MAX_SCROLL
      if (el.scrollTop !== before) updateOver(drag.value.y)
    }
    raf = requestAnimationFrame(tick)
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!active) return
    const state = drag.value
    if (!state) {
      // 还没越过阈值：够了才「拿起」；不够就还是普通点击。
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return
      dragged = true
      drag.value = { path: startPath, x: ev.clientX, y: ev.clientY }
      document.body.classList.add('folder-drag-active')
      capturePointer()
      opts.onStart(startPath)
      if (!raf) raf = requestAnimationFrame(tick)
    } else {
      drag.value = { ...state, x: ev.clientX, y: ev.clientY }
    }
    updateOver(ev.clientY)

    const el = opts.getEl()
    if (el) {
      const box = el.getBoundingClientRect()
      scrollDir =
        ev.clientY < box.top + EDGE_ZONE ? -1 : ev.clientY > box.bottom - EDGE_ZONE ? 1 : 0
    }
  }

  /** 拆掉这次手势的所有接线（不落子）。 */
  function teardown(): void {
    active = false
    scrollDir = 0
    drag.value = null
    over.value = null
    document.body.classList.remove('folder-drag-active')
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('blur', onCancel)
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  function onPointerUp(): void {
    if (!active) return
    // 先留好落子所需的两样东西，再拆接线（teardown 会把 ref 清空）
    const path = drag.value?.path ?? ''
    const spot = over.value
    teardown()
    opts.onDrop(dragged, path, spot)
  }

  /** 取消（Esc / 指针被系统收回 / 窗口失焦）：不落子，也不吞随后的点击。 */
  function onCancel(): void {
    if (!active) return
    teardown()
    dragged = false
  }

  function onPointerDown(path: string, ev: PointerEvent): void {
    if (ev.button !== 0) return // 只认左键，右键留给菜单
    if (active) return
    // 改名输入框里的按下是"选字"，不是"拿起这一行"——它必须自留指针。
    if ((ev.target as HTMLElement | null)?.closest?.('.folder-rename-input')) return
    active = true
    dragged = false
    startPath = path
    startX = ev.clientX
    startY = ev.clientY
    startPointerId = ev.pointerId
    // 捕获回"按下时命中的那个元素"（可能是折页、也可能是行身）：拖动中指针在行内
    // 子元素之间滑动时，move/up 仍会稳定落到它身上。
    pressTarget = (ev.target as HTMLElement | null) ?? null
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
  }

  /**
   * 越过阈值、真正"拿起"时才捕获指针。
   *
   * **不能在 `pointerdown` 就捕获**：捕获会把随后的 `pointerup` 重定向到被捕获的元素，
   * 而浏览器是拿"按下时的元素"与"松开时的元素"的**最近公共祖先**去派发 `click` 的。
   * 若在行上捕获，按在折页上松手 → `click` 落在整行上，折页那个按钮永远收不到——
   * 表现就是"分组点不开了"。捕获晚一步，点击语义完好；拖起来之后照样收得到事件。
   */
  function capturePointer(): void {
    try {
      pressTarget?.setPointerCapture?.(startPointerId)
    } catch {
      /* 没有活跃指针（合成事件）时它会抛：捕获只是锦上添花，别挡住整条手势 */
    }
  }

  onBeforeUnmount(() => {
    if (active) onCancel()
  })

  return {
    drag,
    over,
    onPointerDown,
    shouldSwallowClick: () => dragged,
  }
}
