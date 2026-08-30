<script setup lang="ts">
/**
 * 禅境稳态的「活气」：微尘 / 萤火。
 *
 * 入定之后，纸色之上浮起一层几乎察觉不到的缓漂粒子——明亮与
 * 暮色主题是光里的浮埃（极淡、缓缓上浮），夜读化作萤火（竹青
 * 光点、错拍明灭）。仅入定后运行 rAF，退定时暂停循环、画面
 * 留待淡出结束再清；prefers-reduced-motion 下只画一帧静尘。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ThemeName } from '@/types/settings'

const props = defineProps<{
  /** 是否已入定（入定后方才启动）。 */
  active: boolean
  theme: ThemeName
}>()

const canvasEl = ref<HTMLCanvasElement | null>(null)

const MOTES = 14
/** 越界环绕的外扩边距，避免粒子在屏缘生硬进出。 */
const MARGIN = 24

interface Mote {
  x: number
  y: number
  r: number
  /** 个体明灭强度（0..1），实际透明度再乘主题上限。 */
  alpha: number
  phase: number
  twinkle: number
  /** 漂移：基础航向 + 极缓转向。 */
  angle: number
  speed: number
  turn: number
}

let motes: Mote[] = []
let raf = 0
let running = false
let last = 0
/** 颜色缓存（rgb 三元组字符串），随主题刷新。 */
let dustRgb = '122,106,84'
let fireflyRgb = '150,180,120'
let clearTimer: ReturnType<typeof setTimeout> | null = null

const reduceMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

/** 从主题 CSS 变量取色（#rgb / #rrggbb），失败则用手调的禅意色。 */
function refreshPalette() {
  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) => {
    const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(
      style.getPropertyValue(name).trim(),
    )
    if (!m) return fallback
    const hex =
      m[1].length === 3
        ? m[1]
            .split('')
            .map((c) => c + c)
            .join('')
        : m[1]
    const n = parseInt(hex, 16)
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
  }
  dustRgb = pick('--dusk', dustRgb)
  fireflyRgb = pick('--bamboo', fireflyRgb)
}

function spawn(w: number, h: number): Mote[] {
  return Array.from({ length: MOTES }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 0.8 + Math.random() * 1.4,
    alpha: 0.4 + Math.random() * 0.6,
    phase: Math.random() * Math.PI * 2,
    twinkle: 0.35 + Math.random() * 0.6,
    angle: Math.random() * Math.PI * 2,
    speed: 2.5 + Math.random() * 4, // px/s，极缓
    turn: (Math.random() - 0.5) * 0.5,
  }))
}

function resize() {
  const canvas = canvasEl.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (!motes.length) motes = spawn(w, h)
}

function draw(dt: number, t: number) {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const dark = props.theme === 'dark'
  const rgb = dark ? fireflyRgb : dustRgb
  // 微尘浅到"似有似无"，萤火可以更亮一些。
  const maxAlpha = dark ? 0.55 : 0.16

  ctx.clearRect(0, 0, w, h)
  for (const m of motes) {
    if (dt > 0) {
      m.angle += m.turn * dt
      m.x += Math.cos(m.angle) * m.speed * dt
      // 微尘如光里浮埃缓缓上浮，萤火只是悬停微游。
      m.y += Math.sin(m.angle) * m.speed * dt - (dark ? 1 : 2.4) * dt
      if (m.x < -MARGIN) m.x = w + MARGIN
      else if (m.x > w + MARGIN) m.x = -MARGIN
      if (m.y < -MARGIN) m.y = h + MARGIN
      else if (m.y > h + MARGIN) m.y = -MARGIN
    }
    // 萤火是成相的呼吸明灭，微尘只是缓缓闪烁。
    const tw = dark
      ? Math.max(0, Math.sin(t * m.twinkle + m.phase)) ** 2.4
      : 0.7 + 0.3 * Math.sin(t * m.twinkle + m.phase)
    const a = maxAlpha * m.alpha * tw
    if (a <= 0.004) continue
    ctx.beginPath()
    if (dark) {
      ctx.shadowColor = `rgba(${rgb},${(a * 0.85).toFixed(3)})`
      ctx.shadowBlur = 7
    }
    ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }
}

function tick(now: number) {
  if (!running) return
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  draw(dt, now / 1000)
  raf = requestAnimationFrame(tick)
}

function start() {
  const canvas = canvasEl.value
  if (!canvas) return
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  refreshPalette()
  resize()
  if (reduceMotion()) {
    draw(0, 0)
    return
  }
  if (running) return
  running = true
  last = performance.now()
  raf = requestAnimationFrame(tick)
}

/** 退定：停循环；淡出（1.6s）结束后再清画面，避免淡出途中闪空。 */
function stop() {
  running = false
  cancelAnimationFrame(raf)
  if (!clearTimer)
    clearTimer = setTimeout(() => {
      clearTimer = null
      canvasEl.value?.getContext('2d')?.clearRect(0, 0, canvasEl.value.width, canvasEl.value.height)
    }, 1800)
}

watch(
  () => props.active,
  (on) => (on ? start() : stop()),
)

watch(
  () => props.theme,
  () => {
    refreshPalette()
    if (running) draw(0, performance.now() / 1000)
  },
)

function onResize() {
  if (props.active) resize()
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  running = false
  cancelAnimationFrame(raf)
  if (clearTimer) clearTimeout(clearTimer)
})
</script>

<template>
  <canvas
    ref="canvasEl"
    class="zen-motes"
    :class="{ 'zen-motes-on': active }"
    aria-hidden="true"
  ></canvas>
</template>

<style scoped>
.zen-motes {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  opacity: 0;
  transition: opacity 1.6s var(--ease-zen);
}
.zen-motes-on {
  opacity: 1;
}
</style>
