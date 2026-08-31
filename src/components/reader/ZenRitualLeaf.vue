<script setup lang="ts">
/**
 * 入定仪式 · 落叶档 —— 「一叶知秋 · 万叶栖水」。
 *
 * 纱徐起，一叶知秋——首叶自屏上悠悠而落；暮色随叶落层层四合，
 * 风起时万叶齐落，两阵过林风掠过，叶浪翻飞、金缘乍现。落叶由
 * Canvas 粒子绘制（预渲染叶影精灵 × 三景深视差 × 翻叶摇摆随风
 * 格律共振），远叶微虚化如目光所不及处。风息，满天叶缓缓栖向
 * 水面，涟漪点点如叶雨收梢，水面天光徐徐浮现；末叶（主角叶）
 * 自屏心徐徐而落，点水一声轻响，两圈水月荡开，一圈澄明水洗漫
 * 开，露出禅境——万叶归水，一叶点心，寓意「落叶归根，心归澄明」。
 *
 * 世界退层经 stage 事件由 ReaderView 门控顶栏／面板／边距；轻触
 * 任意处即跳过（emit('skip')）；prefers-reduced-motion 下父层根本
 * 不会挂载本组件。时间线常量与下方 <style> 各 keyframes 百分比/
 * 延迟同源，改动须两处同步。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { playZenDropCue } from '@/lib/chime'
import { COPY } from '@/lib/copy'
import { useSettingsStore } from '@/stores/settings'

const emit = defineEmits<{
  /** 世界退层进度：1 顶栏化去，2 面板隐去，3 稳态澄明。 */
  (e: 'stage', n: number): void
  (e: 'skip'): void
  (e: 'finish'): void
}>()

/** 仪式时间线（ms）——与 <style> 同源。 */
const PREP = 1200 // 纱起，风未动（首叶自此际启程）
const STAGE_ONE = 4200 // 一叶知秋，暮色初合
const STAGE_TWO = 8600 // 万叶将歇，暮色渐深
const CALM = 9600 // 风息，满天叶栖向水面
const HERO_BORN = 11400 // 末叶启程（--hero-born 同源）
const HERO_FALL = 2000 // 末叶坠程（--hero-fall 同源）
const HERO_LAND = HERO_BORN + HERO_FALL // 末叶点水，水月荡开
const SETTLE = 13900 // 澄明水洗起（--leaf-total 的 89.7% 同源）
const WASH = 1600
/** 总长——<style> 中纱与暮色的 keyframes 以此总长配比百分比。 */
const TOTAL = SETTLE + WASH // 15.5s

/** 两阵过林风：钟形包络（中心、半宽，ms）——叶浪与光痕同拍。 */
const GUSTS = [
  { center: 5300, half: 1500 },
  { center: 7600, half: 1600 },
]

/** 末叶点水的两圈水月（迟一拍递进）。 */
const HERO_RIPPLES = [HERO_LAND + 40, HERO_LAND + 380]

const settling = ref(false)

let timers: ReturnType<typeof setTimeout>[] = []
const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

onMounted(() => {
  at(STAGE_ONE, () => emit('stage', 1))
  at(STAGE_TWO, () => emit('stage', 2))
  // 末叶点水的一声轻响（尊重提醒静音）。
  at(HERO_LAND, () => {
    if (useSettingsStore().reminder.chime) playZenDropCue()
  })
  at(SETTLE, () => {
    settling.value = true
    emit('stage', 3)
  })
  at(TOTAL, () => emit('finish'))
})

onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t)
  timers = []
})

/* ---------- 落叶 Canvas：叶影精灵 × 三景深 × 风场 × 栖水 ---------- */

const canvasEl = ref<HTMLCanvasElement | null>(null)

/** 三景深：远（微虚化、缓而淡，目光所不及）／中（主景）／近（大而疾）。
 *  speed 以视高/秒计——远叶横穿约 10s，近叶约 5s。 */
const DEPTHS = [
  { speed: 0.095, speedJit: 0.025, size: 0.8, alpha: 0.55, windAmp: 0.011, gustAmp: 0.05, swayA: 0.008 },
  { speed: 0.14, speedJit: 0.035, size: 1.35, alpha: 0.9, windAmp: 0.017, gustAmp: 0.062, swayA: 0.013 },
  { speed: 0.2, speedJit: 0.045, size: 1.9, alpha: 0.95, windAmp: 0.024, gustAmp: 0.078, swayA: 0.02 },
] as const

/** 落叶规模上限（防极端窗口下的堆积）。 */
const LEAF_CAP = 220

type Rgb = [number, number, number]

/** 叶影的暗部（恒向深色调，不随主题反转）。 */
const LEAF_SHADE: Rgb = [24, 21, 16]

/** 自主题变量取色（#rgb / #rrggbb），失败则用手调的禅意色（同星河档）。 */
function pickHex(name: string, fallback: Rgb): Rgb {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(
    getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
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
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb =>
  a.map((v, i) => Math.round(v + (b[i] - v) * k)) as Rgb

const toCss = (rgb: Rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)
const smooth = (t: number) => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

/** 叶形二式（64×24 坐标系，两头渐尖的竹叶：一直一偃）。 */
const SHAPE_D = [
  'M3 12 Q18 3.5 61 12 Q18 20.5 3 12 Z',
  'M3 12 Q14 4 58 7 Q30 21 3 12 Z',
]
const VEIN_D = ['M7 12 Q30 10.2 56 11.8', 'M7 12 Q26 9.5 53 8.5']

/** 叶影精灵：上缘承光、下缘沉影、中脉一痕——blur 供远景虚化。 */
function makeLeafSprite(rgb: Rgb, lum: Rgb, shape: number, blur: number) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 48
  const g = c.getContext('2d')!
  if (blur > 0) g.filter = `blur(${blur}px)`
  g.scale(2, 2)
  const grad = g.createLinearGradient(0, 4, 0, 20)
  grad.addColorStop(0, toCss(mixRgb(rgb, lum, 0.36)))
  grad.addColorStop(0.52, toCss(rgb))
  grad.addColorStop(1, toCss(mixRgb(rgb, LEAF_SHADE, 0.4)))
  g.fillStyle = grad
  g.fill(new Path2D(SHAPE_D[shape]!))
  g.strokeStyle = toCss(mixRgb(rgb, LEAF_SHADE, 0.55), 0.5)
  g.lineWidth = 0.9
  g.stroke(new Path2D(VEIN_D[shape]!))
  return c
}

let sprites: HTMLCanvasElement[] = [] // 四色 × 二形（中近景）
let farSprites: HTMLCanvasElement[] = [] // 同形微虚化（远景）
let glowRgb: Rgb = [247, 242, 233] // 水光取「纸上的亮」（涟漪用）

/** 叶色四调：竹青为主，掺纸亮、檀色与一缕火星——夕阳穿林的金缘叶。 */
function refreshPalette() {
  const dark = document.documentElement.dataset.theme === 'dark'
  const lum = pickHex(
    dark ? '--ink' : '--paper',
    dark ? [214, 207, 190] : [247, 242, 233],
  )
  const bamboo = pickHex('--bamboo', [95, 122, 92])
  const sandal = pickHex('--sandal', [138, 111, 91])
  const ember = pickHex('--ember', [192, 106, 72])
  glowRgb = lum
  const pal: Rgb[] = [
    bamboo,
    mixRgb(bamboo, lum, 0.22),
    mixRgb(bamboo, sandal, 0.62),
    mixRgb(bamboo, ember, 0.72),
  ]
  sprites = pal.flatMap((rgb, p) =>
    [0, 1].map((s) => makeLeafSprite(rgb, lum, s, 0)),
  )
  farSprites = pal.flatMap((rgb, p) =>
    [0, 1].map((s) => makeLeafSprite(rgb, lum, s, 1.3)),
  )
}

interface Leaf {
  depth: 0 | 1 | 2
  /** 位置（视口分数坐标），缩放窗口不失衡。 */
  x: number
  y: number
  /** 坠速（视高/秒）。 */
  vy: number
  /** 恒定横漂（视宽/秒）。 */
  drift: number
  swayA: number
  swayW: number
  swayP: number
  /** 翻叶：绕叶长轴的自转（相位翻转即叶面翻背）。 */
  flipW: number
  flipP: number
  roll: number
  rollW: number
  scale: number
  sprite: number
  alpha: number
  /** 夕阳金缘叶：明暗随行闪灼。 */
  glint: boolean
  /** 0 落 → 1 栖（归水滑翔）→ 2 定（水面静泊）；3 出屏待清。 */
  state: 0 | 1 | 2 | 3
  calmT: number
  glideDur: number
  sx: number
  sy: number
  sroll: number
  sflip: number
  tx: number
  ty: number
  troll: number
}

interface Rip {
  x: number
  y: number
  t0: number
  dur: number
  r0: number
  r1: number
  a0: number
}

let leaves: Leaf[] = []
let ripples: Rip[] = []
let spawnAcc = 0

function spawnLeaf() {
  if (leaves.length >= LEAF_CAP) return
  const first = leaves.length === 0
  const r = Math.random()
  const depth = (first ? 1 : r < 0.55 ? 0 : r < 0.9 ? 1 : 2) as 0 | 1 | 2
  const d = DEPTHS[depth]!
  const proll = Math.random()
  const palette = proll < 0.06 ? 3 : proll < 0.42 ? 2 : proll < 0.72 ? 1 : 0
  leaves.push({
    depth,
    // 首叶自屏心中上部启程（一叶知秋，落点有定）；其余随机铺开。
    x: first ? 0.4 + Math.random() * 0.2 : -0.06 + Math.random() * 1.12,
    y: -0.02 - Math.random() * 0.06,
    vy: first ? 0.11 : d.speed + Math.random() * d.speedJit,
    drift: (Math.random() - 0.5) * 0.012,
    swayA: d.swayA * (0.8 + Math.random() * 0.5) * (first ? 1.7 : 1),
    swayW: 0.9 + Math.random() * 1.2,
    swayP: Math.random() * Math.PI * 2,
    flipW: (0.7 + Math.random() * 1.4) * (Math.random() < 0.5 ? -1 : 1),
    flipP: Math.random() * Math.PI * 2,
    roll: (Math.random() - 0.5) * 1.2,
    rollW: (Math.random() - 0.5) * 0.5,
    scale: first ? 2.0 : 0.78 + Math.random() * 0.55,
    sprite: palette * 2 + (Math.random() < 0.5 ? 0 : 1),
    alpha: d.alpha * (0.82 + Math.random() * 0.36) * (first ? 1.25 : 1),
    glint: palette === 3,
    state: 0,
    calmT: 0,
    glideDur: 0,
    sx: 0,
    sy: 0,
    sroll: 0,
    sflip: 0,
    tx: 0,
    ty: 0,
    troll: 0,
  })
}

/** 风息后归水：各叶就近择一处水面泊位，避开屏心（留给末叶）。 */
function beginGlide(leaf: Leaf, t: number) {
  leaf.state = 1
  leaf.calmT = t
  leaf.glideDur = 1500 + Math.random() * 1300
  leaf.sx = leaf.x
  leaf.sy = leaf.y
  leaf.sroll = leaf.roll
  leaf.sflip = leaf.flipP
  const side = leaf.x < 0.5 ? -1 : 1
  const reach = 0.07 + Math.pow(Math.random(), 1.1) * 0.4
  leaf.tx = Math.min(1.04, Math.max(-0.04, 0.5 + side * reach))
  leaf.ty = 0.53 + Math.pow(Math.random(), 1.35) * 0.34
  leaf.troll = (Math.random() - 0.5) * 0.55
}

/** 慢风：两组缓正弦的合 wander，风向自左向右为正。 */
function windAt(t: number): number {
  const s = t / 1000
  return 0.5 * Math.sin(s * 0.45 + 1.1) + 0.34 * Math.sin(s * 0.21 + 2.6)
}

/** 过林风：两阵钟形包络的叠加（0..1）。 */
function gustAt(t: number): number {
  let g = 0
  for (const { center, half } of GUSTS) {
    const u = (t - center) / half
    if (Math.abs(u) < 1) g += 1 - u * u
  }
  return Math.min(g, 1)
}

/** 启程节律：一叶知秋（疏）→ 风起万叶（随 gust 涌潮）→ 风息。 */
function spawnRate(t: number): number {
  if (t < PREP) return 0
  if (t < 2600) return leaves.length === 0 ? 30 : 0.7
  if (t < STAGE_ONE) return 2.2
  if (t < CALM) return 5.5 + gustAt(t) * 24
  return 0
}

function sizeOf(leaf: Leaf, vmin: number): number {
  return vmin * (3.0 + 2.6 * leaf.scale) * DEPTHS[leaf.depth]!.size
}

function draw(t: number) {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const vmin = Math.min(w, h) / 100
  const wind = windAt(t)
  const gust = t < CALM ? gustAt(t) : 0
  // 末段随暮色同敛：水洗既起，叶影随之淡去。
  const out = 1 - smooth((t - TOTAL * 0.92) / (TOTAL * 0.08))
  ctx.clearRect(0, 0, w, h)
  if (out <= 0.01) return

  for (let depth = 0 as 0 | 1 | 2; depth < 3; depth = (depth + 1) as 0 | 1 | 2) {
    const d = DEPTHS[depth]!
    for (const leaf of leaves) {
      if (leaf.depth !== depth) continue
      if (leaf.state === 3) continue
      let poseX = leaf.x
      let poseY = leaf.y
      let poseRoll = leaf.roll
      let poseFlip = leaf.flipP
      let glideE = 0
      if (leaf.state === 0) {
        leaf.y += leaf.vy * dt
        leaf.x += (wind * d.windAmp + gust * d.gustAmp + leaf.drift) * dt
        leaf.flipP += (leaf.flipW + gust * 1.5) * dt
        leaf.roll += (leaf.rollW + wind * 0.14 + gust * 0.22) * dt
        if (t >= CALM) beginGlide(leaf, t)
        else if (leaf.y > 1.16) leaf.state = 3
        poseX = leaf.x + Math.sin((t / 1000) * leaf.swayW + leaf.swayP) * leaf.swayA
        poseY = leaf.y
        poseRoll = leaf.roll
        poseFlip = leaf.flipP
      } else {
        if (leaf.state === 1) {
          const p = clamp01((t - leaf.calmT) / leaf.glideDur)
          glideE = smooth(p)
          if (p >= 1) {
            leaf.state = 2
            glideE = 1
            const r = sizeOf(leaf, vmin)
            ripples.push({
              x: leaf.tx,
              y: leaf.ty,
              t0: t,
              dur: 1400,
              r0: r * 0.3,
              r1: r * 2.3,
              a0: 0.35,
            })
          }
        } else {
          glideE = 1
        }
        poseX = leaf.sx + (leaf.tx - leaf.sx) * glideE
        poseY = leaf.sy + (leaf.ty - leaf.sy) * glideE
        poseRoll = leaf.sroll + (leaf.troll - leaf.sroll) * glideE
        poseFlip = leaf.sflip * (1 - glideE)
        if (leaf.state === 1) {
          poseX +=
            Math.sin((t / 1000) * leaf.swayW + leaf.swayP) *
            leaf.swayA *
            (1 - glideE)
        }
      }
      const flipC = Math.cos(poseFlip)
      // 翻叶保留明暗但限制侧薄：叶缘再侧也不至于瘦成一线。
      const faceX = Math.sign(flipC || 1) * Math.max(Math.abs(flipC), 0.35)
      const tw = leaf.glint ? 0.7 + 0.3 * Math.sin(t * 0.0021 + leaf.swayP * 7) : 1
      const edge = 0.7 + 0.3 * Math.abs(flipC)
      let alpha = leaf.alpha * tw * edge * out
      if (leaf.state === 2) alpha *= 0.55
      if (alpha <= 0.012) continue
      const spr = (leaf.depth === 0 ? farSprites : sprites)[leaf.sprite]
      if (!spr) continue
      const lw = sizeOf(leaf, vmin)
      const lh = (lw * 24) / 64
      ctx.save()
      ctx.translate(poseX * w, poseY * h)
      ctx.rotate(poseRoll)
      // 绕叶长轴翻转： scaleX 过零即叶缘向人，负值即叶背。
      ctx.scale(faceX, 1)
      ctx.globalAlpha = Math.min(alpha, 1)
      ctx.drawImage(spr, -lw / 2, -lh / 2, lw, lh)
      ctx.restore()
    }
  }

  // 出屏者清出队列。
  if (leaves.some((l) => l.state === 3)) {
    leaves = leaves.filter((l) => l.state !== 3)
  }

  // 栖水涟漪：叶雨收梢的点点水痕。
  if (ripples.length) {
    ctx.lineWidth = 1.1
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i]!
      const p = (t - rp.t0) / rp.dur
      if (p >= 1) {
        ripples.splice(i, 1)
        continue
      }
      const e = 1 - Math.pow(1 - p, 3)
      const r = rp.r0 + (rp.r1 - rp.r0) * e
      ctx.strokeStyle = toCss(glowRgb, rp.a0 * (1 - p) * out)
      ctx.beginPath()
      ctx.ellipse(rp.x * w, rp.y * h, r, r * 0.3, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

let raf = 0
let running = false
let bornAt = 0
let last = 0
let dt = 0

function tick(now: number) {
  if (!running) return
  dt = Math.min((now - last) / 1000, 0.05)
  last = now
  const t = now - bornAt
  if (t < TOTAL) {
    spawnAcc += spawnRate(t) * dt
    while (spawnAcc >= 1) {
      spawnAcc -= 1
      spawnLeaf()
    }
  }
  draw(t)
  raf = requestAnimationFrame(tick)
}

function resize() {
  const canvas = canvasEl.value
  if (!canvas) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(canvas.clientWidth * dpr)
  canvas.height = Math.round(canvas.clientHeight * dpr)
  canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

const reduceMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

onMounted(() => {
  refreshPalette()
  resize()
  window.addEventListener('resize', resize)
  if (reduceMotion()) return
  running = true
  bornAt = performance.now()
  last = bornAt
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  running = false
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
})
</script>

<template>
  <div
    class="zen-ritual zen-leaf"
    :class="{ 'zen-ritual-settle': settling }"
    :style="{
      '--leaf-total': TOTAL + 'ms',
      '--wash': WASH + 'ms',
      '--hero-born': HERO_BORN + 'ms',
      '--hero-fall': HERO_FALL + 'ms',
    }"
    @click="emit('skip')"
  >
    <div class="leaf-veil"></div>

    <!-- 暮色四合：随叶落层层加深，水洗时一并散去 -->
    <div class="leaf-dusk"></div>

    <!-- 过林风：两阵掠过的光痕，与叶浪同拍 -->
    <div
      v-for="(g, i) in GUSTS"
      :key="`g${i}`"
      class="leaf-gust"
      :style="{ '--gd': g.center - 800 + 'ms' }"
    ></div>

    <!-- 落叶：Canvas 粒子（三景深视差，远叶微虚化） -->
    <canvas ref="canvasEl" class="leaf-canvas" aria-hidden="true"></canvas>

    <!-- 水面天光：风息后浮现的一方静水 -->
    <div class="leaf-pond"></div>

    <!-- 末叶：万叶栖定后的最后一叶，自屏心点水 -->
    <div class="hero-anchor" aria-hidden="true">
      <div class="hero-fall">
        <svg class="hero-leaf" viewBox="0 0 120 36">
          <path class="hero-leaf-shade" d="M6 18 Q34 3 114 16 Q36 33 6 18 Z" />
          <path class="hero-leaf-lit" d="M6 18 Q34 3 114 16 Q58 9.5 6 18 Z" />
          <path class="hero-leaf-vein" d="M10 18 Q48 13 108 16" />
        </svg>
      </div>
    </div>

    <!-- 末叶点水：两圈水月自砚心荡开 -->
    <div
      v-for="(d, i) in HERO_RIPPLES"
      :key="`r${i}`"
      class="leaf-ripple"
      :style="{ '--d': d + 'ms' }"
    ></div>

    <!-- 末景水洗：一圈澄明自屏心漫开 -->
    <div class="leaf-wash"></div>

    <p class="zen-ritual-skip">{{ COPY.zenSkipHint }}</p>
  </div>
</template>

<style scoped>
/*
 * 取色口径同星河档：本场自含的场景中，「水光／叶上承光」须取
 * 「纸上的亮」——亮/暮取 --paper，夜读的 --paper 反转为深色，改取
 * 浅色 --ink。
 */
.zen-leaf {
  --glow: var(--paper);
}
:global([data-theme='dark']) .zen-leaf {
  --glow: var(--ink);
}

/* 纱：纸色四合，随暮色徐起，水洗前散去。时长取 --leaf-total 配比。 */
.leaf-veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 95% 85% at 50% var(--ritual-cy),
      transparent 0 24%,
      color-mix(in srgb, var(--paper-deep) 88%, transparent) 88%
    ),
    var(--paper);
  opacity: 0;
  animation: leaf-veil var(--leaf-total) var(--ease-zen) both;
}
/* 8% ≈ PREP；86% 起随末叶点水而散。 */
@keyframes leaf-veil {
  0% {
    opacity: 0;
  }
  8% {
    opacity: 0.62;
  }
  30%,
  86% {
    opacity: 0.76;
  }
  94%,
  100% {
    opacity: 0;
  }
}

/* 暮色：竹青掺墨，自四缘向心合拢；三档加深对应两次 stage。 */
.leaf-dusk {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 120% 90% at 50% var(--ritual-cy),
      transparent 0 22%,
      color-mix(in srgb, var(--bamboo) 15%, transparent) 58%,
      color-mix(in srgb, var(--ink) 22%, transparent) 100%
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--bamboo) 7%, transparent),
      transparent 30% 70%,
      color-mix(in srgb, var(--ink) 11%, transparent)
    );
  opacity: 0;
  animation: leaf-dusk var(--leaf-total) var(--ease-zen) both;
}
/* 百分比与 STAGE_ONE≈27.1% / STAGE_TWO≈55.5% 同源。 */
@keyframes leaf-dusk {
  0%,
  24% {
    opacity: 0;
  }
  27.1% {
    opacity: 0.6;
  }
  55.5% {
    opacity: 0.9;
  }
  84% {
    opacity: 1;
  }
  96%,
  100% {
    opacity: 0;
  }
}

/* 过林风：斜掠的光痕，2s 横贯全屏，迟 gust 中心 0.8s 起程。 */
.leaf-gust {
  position: absolute;
  inset: -10% -30%;
  background: linear-gradient(
    100deg,
    transparent 30%,
    color-mix(in srgb, var(--glow) 12%, transparent) 46%,
    color-mix(in srgb, var(--bamboo) 9%, transparent) 54%,
    transparent 70%
  );
  opacity: 0;
  animation: leaf-gust 2s var(--ease-zen) var(--gd) both;
}
@keyframes leaf-gust {
  0% {
    opacity: 0;
    transform: translateX(-46%) skewX(-6deg);
  }
  28% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateX(46%) skewX(-6deg);
  }
}

.leaf-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* 水面天光：风息后浮现的一方静水（61.9% 起，末叶点水时最明）。 */
.leaf-pond {
  position: absolute;
  left: 50%;
  top: var(--ritual-cy);
  width: 96vw;
  height: 30vmin;
  transform: translate(-50%, -50%);
  background:
    radial-gradient(
      ellipse 50% 50% at 50% 50%,
      color-mix(in srgb, var(--glow) 13%, transparent),
      transparent 72%
    ),
    linear-gradient(
      to bottom,
      transparent 0 40%,
      color-mix(in srgb, var(--glow) 9%, transparent) 50%,
      transparent 60%
    );
  opacity: 0;
  animation: leaf-pond var(--leaf-total) var(--ease-zen) both;
}
/* 百分比与 CALM≈61.9% / HERO_LAND≈86.5% 同源。 */
@keyframes leaf-pond {
  0%,
  60% {
    opacity: 0;
  }
  74% {
    opacity: 0.8;
  }
  86.5% {
    opacity: 1;
  }
  96%,
  100% {
    opacity: 0;
  }
}

/*
 * 末叶：万叶栖定后的最后一叶。锚点即砚心（--ritual-cy），坠程
 * --hero-fall 内四段折转、逐段放缓，如天地屏息；落水一刻由内层
 * hero-land 压扁散去，让位给水月与水洗。
 */
.hero-anchor {
  position: absolute;
  left: 50%;
  top: var(--ritual-cy);
  pointer-events: none;
}
.hero-fall {
  position: absolute;
  width: 9.5vmin;
  margin: -1.5vmin 0 0 -4.75vmin;
  opacity: 0;
  animation: hero-fall var(--hero-fall) cubic-bezier(0.4, 0.06, 0.5, 0.94)
    var(--hero-born) both;
}
/* 坠程折转：57vh ≈ 屏上（砚心 45vh + 出屏 12vh）。 */
@keyframes hero-fall {
  0% {
    opacity: 0;
    transform: translate(0, -57vh) rotate(-16deg);
  }
  9% {
    opacity: 1;
  }
  32% {
    transform: translate(2.6vmin, -37vh) rotate(11deg);
  }
  56% {
    transform: translate(-1.9vmin, -20vh) rotate(-9deg);
  }
  78% {
    transform: translate(1.1vmin, -8.5vh) rotate(5deg);
  }
  100% {
    opacity: 1;
    transform: translate(0, 0) rotate(2deg);
  }
}
.hero-leaf {
  display: block;
  width: 100%;
  filter: drop-shadow(0 0 1.4vmin color-mix(in srgb, var(--ember) 30%, transparent));
  animation: hero-land 560ms var(--ease-zen)
    calc(var(--hero-born) + var(--hero-fall)) both;
}
@keyframes hero-land {
  0% {
    opacity: 1;
    transform: none;
  }
  45% {
    opacity: 1;
    transform: scale(1.08, 0.52) translateY(2px);
  }
  100% {
    opacity: 0;
    transform: scale(1.5, 0.12) translateY(5px);
  }
}
.hero-leaf-shade {
  fill: color-mix(in srgb, var(--bamboo) 72%, #221f19);
}
.hero-leaf-lit {
  fill: color-mix(in srgb, var(--bamboo) 55%, var(--glow));
  opacity: 0.85;
}
.hero-leaf-vein {
  fill: none;
  stroke: color-mix(in srgb, var(--bamboo) 60%, #221f19);
  stroke-width: 1;
  opacity: 0.55;
}

/* 末叶点水：两圈水月自砚心荡开（迟一拍递进）。 */
.leaf-ripple {
  position: absolute;
  left: 50%;
  top: var(--ritual-cy);
  width: 52vmin;
  height: 17vmin;
  margin: -8.5vmin 0 0 -26vmin;
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    transparent 50%,
    color-mix(in srgb, var(--glow) 30%, transparent) 63%,
    transparent 74%
  );
  opacity: 0;
  animation: leaf-ripple 2.1s cubic-bezier(0.2, 0.6, 0.3, 1) var(--d) both;
}
@keyframes leaf-ripple {
  0% {
    opacity: 0;
    transform: scale(0.04);
  }
  12% {
    opacity: 0.8;
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}

/* 末景水洗：与墨韵档的 zen-final-wash 同形，改由 settle 类触发。 */
.leaf-wash {
  position: absolute;
  left: 50%;
  top: var(--ritual-cy);
  width: 200vmax;
  height: 200vmax;
  margin: -100vmax 0 0 -100vmax;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--paper) 92%, transparent) 0 6%,
    color-mix(in srgb, var(--paper-deep) 66%, transparent) 22%,
    transparent 38%
  );
  opacity: 0;
  pointer-events: none;
}
.zen-ritual-settle .leaf-wash {
  animation: leaf-final-wash var(--wash) var(--ease-zen) both;
}
@keyframes leaf-final-wash {
  0% {
    opacity: 0;
    transform: scale(0.02);
  }
  35% {
    opacity: 0.9;
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}
</style>
