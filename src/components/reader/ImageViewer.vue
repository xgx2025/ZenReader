<script setup lang="ts">
/**
 * 正文灯箱：点击文档里的图片或 mermaid 图，全屏放大静观。
 * 轻触纱面任意处或 Esc 收起；内容以 fade + 轻缩放入场，不抢图的戏。
 * 开启期间以捕获阶段拦下 Esc，避免阅读页把 Esc 拿去出定/关面板。
 *
 * 放大静观：开箱后图以「适配」姿态居中，滚轮 / 触控板双指在指针处
 * 无级缩放，放大超出屏时按住拖动平移，双击还原适配。缩放全部走 CSS
 * transform——SVG 不失真，点阵图以 1:1 自然像素为上限。深色纱面（图外
 * 空地）与 Esc 一律收起。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  src: string | null
  /** mermaid 分支：图卡内 SVG 快照与宽高比（mermaidSvgSnapshot 产物）。 */
  svg?: { html: string; ratio: number } | null
}>()
const emit = defineEmits<{ close: [] }>()

const open = computed(() => Boolean(props.src || props.svg))

/** 缩放相对「适配」的最小/上限：1 = 恰好铺进屏；mermaid 是矢量无自然上限，给个富余倍数。 */
const ZOOM_MAX = 12
/** 滚轮灵敏度：约每 380px 滚动量 ×e 一档；再夹住单帧步长，防大幅滚动一眼飞远。 */
const WHEEL_SENSITIVITY = 380
const WHEEL_FLOOR = 0.55
const WHEEL_CEIL = 1.8

const rootEl = ref<HTMLElement | null>(null)
const zoom = ref(1)
const tx = ref(0)
const ty = ref(0)
/** 当前可见内容能放大的上限（点阵图=1:1，mermaid=ZOOM_MAX）。 */
const maxZoom = ref(1)
const dragging = ref(false)
/** 双击还原的那一口轻滑：短暂打开 transform 过渡后即关。 */
const settling = ref(false)
let settleTimer: ReturnType<typeof setTimeout> | null = null

/** 当前激活的图面元素：普通图取 <img>，mermaid 取纸卡 div。 */
function currentVisual(): HTMLElement | null {
  if (!rootEl.value) return null
  const sel = props.src ? '.img-viewer-img' : '.img-viewer-mermaid'
  return rootEl.value.querySelector<HTMLElement>(sel)
}

/** 图面在适配态下的布局盒（transform 不改布局，offsetWidth/Height 即铺满尺寸）。 */
function geometry() {
  const root = rootEl.value
  const visual = currentVisual()
  if (!root || !visual) return null
  return {
    w: visual.offsetWidth,
    h: visual.offsetHeight,
    W: root.clientWidth,
    H: root.clientHeight,
  }
}

/** 依内容类型定放大上限：点阵图到 1:1 自然像素为止，mermaid 用富余上限。 */
function refreshMaxZoom() {
  const root = rootEl.value
  const visual = currentVisual()
  if (!root || !visual) return
  if (props.src && visual instanceof HTMLImageElement) {
    const { naturalWidth, naturalHeight } = visual
    if (naturalWidth > 0 && visual.offsetWidth > 0) {
      maxZoom.value = Math.min(
        ZOOM_MAX,
        Math.max(1, naturalWidth / visual.offsetWidth, naturalHeight / visual.offsetHeight),
      )
    }
    // 图未解码完（naturalWidth=0）先不放：@load 后再刷新。
  } else {
    maxZoom.value = ZOOM_MAX
  }
  if (zoom.value > maxZoom.value) {
    zoom.value = maxZoom.value
    clampPan()
  }
}

/** 平移夹逼：缩放后的图面须始终盖住屏心，不露出对侧空洞。 */
function clampPan() {
  const g = geometry()
  if (!g) return
  const sw = g.w * zoom.value
  const sh = g.h * zoom.value
  const mx = Math.max(0, (sw - g.W) / 2)
  const my = Math.max(0, (sh - g.H) / 2)
  tx.value = Math.min(mx, Math.max(-mx, tx.value))
  ty.value = Math.min(my, Math.max(-my, ty.value))
}

/** 以指针为不动点缩放：把指针下的图面坐标原地钉住，再夹平移。 */
function zoomAt(factor: number, cx: number, cy: number) {
  const next = Math.min(maxZoom.value, Math.max(1, zoom.value * factor))
  if (next === zoom.value) return
  const root = rootEl.value
  if (!root) return
  const r = next / zoom.value
  const rect = root.getBoundingClientRect()
  const ccx = rect.left + rect.width / 2
  const ccy = rect.top + rect.height / 2
  tx.value = (cx - ccx) * (1 - r) + tx.value * r
  ty.value = (cy - ccy) * (1 - r) + ty.value * r
  zoom.value = next
  clampPan()
}

/** 双击：缩放态还原适配，适配态则放大两档再看细节。 */
function onDblClick() {
  if (!open.value) return
  if (zoom.value > 1.0001) {
    zoom.value = 1
    tx.value = 0
    ty.value = 0
  } else {
    zoom.value = Math.min(maxZoom.value, 2)
    tx.value = 0
    ty.value = 0
  }
  // 这一口轻滑只属于还原，不设常驻过渡，免得拖拽/滚轮被它拖出粘滞感。
  settling.value = true
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settling.value = false
  }, 260)
}

let dragId: number | null = null
let dragFrom = { x: 0, y: 0, tx: 0, ty: 0 }

function isVisual(e: PointerEvent | MouseEvent) {
  const t = e.target as Element | null
  return !!t && !!t.closest && !!t.closest('.img-viewer-img, .img-viewer-mermaid')
}

function onPointerDown(e: PointerEvent) {
  if (!open.value) return
  // 图外深纱：收起。图面满屏不可拖时（无可放大的点阵图）同样以点击收场。
  if (!isVisual(e) || (zoom.value <= 1 && maxZoom.value <= 1)) {
    emit('close')
    return
  }
  if (zoom.value <= 1.0001) return // 适配态：点图不拖不关，滚轮与双击待命
  e.preventDefault()
  dragging.value = true
  dragId = e.pointerId
  dragFrom = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }
  try {
    rootEl.value?.setPointerCapture(e.pointerId)
  } catch {
    /* capture 失败时靠 move 冒泡到根即可 */
  }
}

function onPointerMove(e: PointerEvent) {
  if (dragId !== e.pointerId) return
  const g = geometry()
  if (!g) return
  const sw = g.w * zoom.value
  const sh = g.h * zoom.value
  const mx = Math.max(0, (sw - g.W) / 2)
  const my = Math.max(0, (sh - g.H) / 2)
  tx.value = Math.min(mx, Math.max(-mx, dragFrom.tx + e.clientX - dragFrom.x))
  ty.value = Math.min(my, Math.max(-my, dragFrom.ty + e.clientY - dragFrom.y))
}

function onPointerEnd(e: PointerEvent) {
  if (dragId !== e.pointerId) return
  dragging.value = false
  dragId = null
  try {
    rootEl.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* 已松开则忽略 */
  }
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return
  e.stopPropagation()
  if (e.key === 'Escape') emit('close')
}

/** 原生 wheel（passive:false）以拦下默认滚动，滚轮/双指按指针位置缩放。 */
function onWheel(e: WheelEvent) {
  if (!open.value) return
  e.preventDefault()
  const step = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1)
  if (!step) return
  const factor = Math.min(WHEEL_CEIL, Math.max(WHEEL_FLOOR, Math.exp(-step / WHEEL_SENSITIVITY)))
  zoomAt(factor, e.clientX, e.clientY)
}

function bindWheel() {
  rootEl.value?.addEventListener('wheel', onWheel, { passive: false })
}
function unbindWheel() {
  rootEl.value?.removeEventListener('wheel', onWheel)
}

watch(
  () => props.src || props.svg,
  (v) => {
    if (v) {
      zoom.value = 1
      tx.value = 0
      ty.value = 0
      window.addEventListener('keydown', onKey, true)
      // 等图面挂好再量尺寸：mermaid 立即可知；点阵图要等 @load 后按自然像素补档。
      nextTick(() => {
        bindWheel()
        refreshMaxZoom()
      })
    } else {
      window.removeEventListener('keydown', onKey, true)
      unbindWheel()
      dragging.value = false
      dragId = null
    }
  },
)

function onImageLoad() {
  refreshMaxZoom()
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  unbindWheel()
  if (settleTimer) clearTimeout(settleTimer)
})

const paneStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${zoom.value})`,
}))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        ref="rootEl"
        class="img-viewer"
        :class="{
          'is-zoomed': zoom > 1.0001,
          'is-dragging': dragging,
          'is-settling': settling,
        }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
        @dblclick.prevent="onDblClick"
      >
        <img
          v-if="src"
          :src="src"
          class="img-viewer-img"
          :style="paneStyle"
          alt=""
          draggable="false"
          @load="onImageLoad"
        />
        <!-- mermaid 图透明底，须垫纸色卡才看得清；尺寸由 viewBox 比例自适应。 -->
        <div
          v-else-if="svg"
          class="img-viewer-mermaid"
          :style="[{ '--ar': String(svg.ratio) }, paneStyle]"
          v-html="svg.html"
        ></div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.img-viewer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 4vmin;
  overflow: hidden;
  background: color-mix(in srgb, var(--ink) 62%, transparent);
  backdrop-filter: blur(6px);
  user-select: none;
  touch-action: none;
  cursor: zoom-out;
}
.img-viewer-img {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 6px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 35%);
  /* 入场动画不得保留末尾帧（无 both/forwards）：否则定格 transform，
     压过缩放平移的内联 transform，放大就会失灵。 */
  animation: img-viewer-in 360ms var(--ease-zen);
  transform-origin: center;
  cursor: default;
}
.img-viewer-mermaid {
  max-width: 92vw;
  max-height: 92vh;
  padding: 2vmin;
  background: var(--paper-deep);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 35%);
  animation: img-viewer-in 360ms var(--ease-zen);
  transform-origin: center;
  cursor: default;
}
/* 放大可拖时换成抓手，拖行中握紧；双击还原带一口轻滑（仅此瞬有过渡）。 */
.img-viewer.is-zoomed .img-viewer-img,
.img-viewer.is-zoomed .img-viewer-mermaid {
  cursor: grab;
}
.img-viewer.is-zoomed.is-dragging .img-viewer-img,
.img-viewer.is-zoomed.is-dragging .img-viewer-mermaid {
  cursor: grabbing;
}
.img-viewer.is-settling .img-viewer-img,
.img-viewer.is-settling .img-viewer-mermaid {
  transition: transform 240ms var(--ease-zen);
}
.img-viewer-mermaid :deep(svg) {
  display: block;
  /* 按宽高比撑到贴边：宽受 92vw 限，高经 --ar 折算不越 92vh；
     小图无级放大、巨图无级缩小，SVG 怎么缩放都不失真。 */
  width: min(calc(92vw - 4vmin), calc((92vh - 4vmin) * var(--ar, 1)));
  height: auto;
}
@keyframes img-viewer-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
