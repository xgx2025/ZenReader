<script setup lang="ts">
/**
 * 入定仪式 · 香篆档 —— 「香篆引定」。
 *
 * 暮色徐合（暖檀色，与星河的墨蓝夜相别），万点香尘自空洒落、循迹
 * 就成一篆（五瓣盘花的篆纹，香印旧制）；火星在篆首点亮，循篆徐行
 * ——过处香尘化灰，青烟自火星与余烬袅袅而起，星火偶随烟飘散。世界
 * 随燃篆层层退去（经 stage 事件由 ReaderView 门控顶栏／面板／边距）。
 * 篆尽火星抵心，光华微绽，满室烟缕螺旋归拢、养作一点澄明；两圈暖
 * 涟荡开，暮色褪作天光，末一圈水洗漫开，纱散，露出禅境——一炉香
 * 篆，燃尽归一。
 *
 * 香篆由 Canvas 粒子系统绘制：香尘／火星／青烟／星火皆预渲染辉光
 * 精灵，篆纹取等弧长参数线（火星匀速循行，弧长表重采样）。暮色／
 * 暖晕／光涟／水洗为 DOM 层。轻触任意处即跳过（emit('skip')）；
 * prefers-reduced-motion 下父层根本不会挂载本组件。
 * 时间线常量与下方 <style> 各 keyframes 百分比同源，改动须两处同步。
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
const DUSK = 700 // 暮色起合（2400 合拢）
const POWDER = 1100 // 香尘随篆洒落（2500 落定）
const IGNITE = 3000 // 火星点亮
const BURN = 3300 // 火星启程循篆
const BURN_END = 9500 // 篆尽，火星抵心
const STAGE_ONE = 4100 // 燃篆既起，世界退一层
const STAGE_TWO = 8100 // 燃过其半，边距舒展
const FLARE = 9500 // 抵心光华微绽
const GATHER = 9900 // 万缕烟螺旋归心
const HEART = 11800 // 归一点心光既成，暖涟起
const SETTLE = 12300 // 暮色褪作天光，澄明水洗起
const WASH = 1500
/** 总长——<style> 中纱与暮色的 keyframes 以此总长配比百分比。 */
const TOTAL = SETTLE + WASH // 13.8s

/** 归一心光的两圈暖涟（迟一拍递进）。 */
const RIPPLES = [HEART + 60, HEART + 380]

const settling = ref(false)

let timers: ReturnType<typeof setTimeout>[] = []
const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

onMounted(() => {
  at(STAGE_ONE, () => emit('stage', 1))
  at(STAGE_TWO, () => emit('stage', 2))
  // 归一点既成的一声轻响（尊重提醒静音，同星河档）。
  at(HEART, () => {
    if (useSettingsStore().reminder.chime) playZenDropCue()
  })
  at(SETTLE, () => {
    settling.value = true
    emit('stage', 3)
  })
  at(TOTAL, () => emit('finish'))
})

/* ---------- 香篆 Canvas：篆纹等弧长线 × 香尘 × 火星 × 青烟 ---------- */

const canvasEl = ref<HTMLCanvasElement | null>(null)

/** 香尘粒数：篆纹丰盈而桌面可流畅绘制的量级。 */
const GRAINS = 1250
/** 篆心：屏心（--ritual-cy）即篆心，火星燃尽归于此。 */
const SEAL_CY = 0.45
/** 篆盘半径占短边的比例。 */
const SEAL_R = 0.29

/* —— 篆纹：五瓣盘花旋入篆心（r 随行收小、瓣波随角起伏）。 —— */
const TURNS = 6.2
const THETA_MAX = TURNS * Math.PI * 2
const PETALS = 4
const PETAL_AMP = 0.05

function sealPoint(theta: number): [number, number] {
  const u = theta / THETA_MAX
  const r =
    (0.085 + 0.915 * Math.pow(1 - u, 1.04)) * (1 + PETAL_AMP * Math.sin(PETALS * theta))
  return [r * Math.cos(theta), r * Math.sin(theta)]
}

/** 等弧长重采样表：火星与香尘皆按弧长取位，循行方得匀速。 */
const LUT_N = 1024
let lut: [number, number][] = []

function buildPath() {
  const FINE = 4096
  const raw: [number, number][] = []
  const cum = new Float64Array(FINE + 1)
  let prev = sealPoint(0)
  raw.push(prev)
  for (let i = 1; i <= FINE; i++) {
    const p = sealPoint((i / FINE) * THETA_MAX)
    cum[i] = cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1])
    raw.push(p)
    prev = p
  }
  const total = cum[FINE]
  lut = []
  let j = 0
  for (let i = 0; i < LUT_N; i++) {
    const target = (total * i) / (LUT_N - 1)
    while (j < FINE && cum[j + 1] < target) j++
    const span = cum[j + 1] - cum[j] || 1
    const k = (target - cum[j]) / span
    const a = raw[j]
    const b = raw[Math.min(j + 1, FINE)]
    lut.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k])
  }
}

function pointAt(s: number): [number, number] {
  const f = Math.min(Math.max(s, 0), 1) * (LUT_N - 1)
  const i = Math.min(Math.floor(f), LUT_N - 2)
  const k = f - i
  const a = lut[i]
  const b = lut[i + 1]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
}

/* —— 香尘：沿篆撒布的微点，未燃则金明、既燃则成灰。 —— */
interface Grain {
  s: number
  /** 单位篆盘上的位置（含垂线抖散）。 */
  x: number
  y: number
  size: number
  base: number
  tw: number
  phase: number
  /** 洒落时刻：随篆首至篆尾递进。 */
  born: number
  gem: boolean
}

let grains: Grain[] = []

function spawnGrains() {
  grains = Array.from({ length: GRAINS }, () => {
    const s = Math.random()
    const [x, y] = pointAt(s)
    const [tx, ty] = pointAt(Math.min(s + 0.004, 1))
    const len = Math.hypot(tx - x, ty - y) || 1
    // 垂线抖散成香粉铺撒的细带；少许大粒为「香屑」。
    const off = (Math.random() + Math.random() + Math.random() - 1.5) * 0.009
    const gem = Math.random() < 0.05
    return {
      s,
      x: x + (-(ty - y) / len) * off,
      y: y + ((tx - x) / len) * off,
      size: (0.8 + Math.pow(Math.random(), 2) * 1.6) * (gem ? 1.8 : 1),
      base: (gem ? 0.75 : 0.42) + Math.random() * 0.35,
      tw: 0.6 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      born: POWDER + s * 1000 + Math.random() * 420,
      gem,
    }
  })
}

/* —— 青烟与星火。 —— */
interface Puff {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size0: number
  grow: number
  alpha: number
  sway: number
  freq: number
  phase: number
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  phase: number
}

let puffs: Puff[] = []
let sparks: Spark[] = []
const PUFF_CAP = 170

/* ---------- 取色与精灵（同星河档的手法） ---------- */

type Rgb = [number, number, number]

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

function makeSprite(rgb: Rgb, dim = 1): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `rgba(${rgb.join(',')},1)`)
  grad.addColorStop(0.22, `rgba(${rgb.join(',')},${(0.5 * dim).toFixed(3)})`)
  grad.addColorStop(0.58, `rgba(${rgb.join(',')},${(0.1 * dim).toFixed(3)})`)
  grad.addColorStop(1, `rgba(${rgb.join(',')},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

let sprites: HTMLCanvasElement[] = []

/** 火色三精灵：火星近白暖、香尘金檀、青烟为灯所照的暖灰。 */
function refreshPalette() {
  const dark = document.documentElement.dataset.theme === 'dark'
  const lum = pickHex(
    dark ? '--ink' : '--paper',
    dark ? [232, 226, 213] : [247, 242, 233],
  )
  const ember = pickHex('--ember', [192, 106, 72])
  const sandal = pickHex('--sandal', [138, 111, 91])
  const gold = mixRgb(ember, lum, 0.3)
  sprites = [
    makeSprite(mixRgb(lum, ember, 0.16)), // 0 火星
    makeSprite(gold, 0.9), // 1 香尘
    makeSprite(mixRgb(lum, sandal, 0.62), 0.8), // 2 青烟
    makeRgbSprite(mixRgb(sandal, lum, 0.15)), // 3 灰烬（普通叠加）
    makeSprite(mixRgb(lum, ember, 0.38), 0.8), // 4 新烟被火光染暖的一截
  ]
}

/** 灰烬须比暮色更哑，用普通叠加的实心微点，不做辉光。 */
function makeRgbSprite(rgb: Rgb): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `rgba(${rgb.join(',')},0.95)`)
  grad.addColorStop(0.5, `rgba(${rgb.join(',')},0.5)`)
  grad.addColorStop(1, `rgba(${rgb.join(',')},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

/* ---------- 相位时钟 ---------- */

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)
const smooth = (t: number) => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}
const inOutSine = (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2

/** 燃篆进度：匀速为本、首末稍缓；须燃至篆尾，不留金屑。 */
function burnAt(t: number): number {
  const u = clamp01((t - BURN) / (BURN_END - BURN))
  return 0.001 + inOutSine(u) * 0.998
}

let bornAt = 0
let last = 0
let raf = 0
let running = false
let smolderAt = 0
let sparkAt = 0

/** 全局风：缓来缓去的横向漂移，烟与星火共之。 */
function windAt(t: number): number {
  return Math.sin(t * 0.00022) * 9 + Math.sin(t * 0.00007) * 5
}

function spawnSmoke(x: number, y: number, faint = 1) {
  if (puffs.length >= PUFF_CAP) return
  puffs.push({
    x: x + (Math.random() - 0.5) * 4,
    y: y + (Math.random() - 0.5) * 4,
    vx: (Math.random() - 0.5) * 8,
    vy: -(30 + Math.random() * 22) * (faint < 1 ? 0.7 : 1),
    age: 0,
    life: 3.6 + Math.random() * 2.2,
    size0: (5 + Math.random() * 4) * (faint < 1 ? 0.8 : 1),
    grow: 6 + Math.random() * 4,
    alpha: (0.09 + Math.random() * 0.04) * faint,
    sway: 14 + Math.random() * 12,
    freq: 0.5 + Math.random() * 0.6,
    phase: Math.random() * Math.PI * 2,
  })
}

function spawnSpark(x: number, y: number) {
  sparks.push({
    x: x + (Math.random() - 0.5) * 3,
    y: y + (Math.random() - 0.5) * 3,
    vx: (Math.random() - 0.5) * 24,
    vy: -(34 + Math.random() * 44),
    age: 0,
    life: 0.8 + Math.random() * 0.9,
    size: 1.6 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,
  })
}

function stepParticles(dt: number, t: number, b: number, ex: number, ey: number, cx: number, cy: number) {
  const wind = windAt(t)
  // 火星处的青烟；篆尽即止。
  if (t >= IGNITE && t < FLARE && running) {
    if (Math.random() < 0.5) spawnSmoke(ex, ey)
  }
  // 余烬迹上偶起一缕更淡的烟。
  if (t >= IGNITE + 900 && t < FLARE && t > smolderAt) {
    smolderAt = t + 450 + Math.random() * 300
    const s0 = Math.max(b - 0.02 - Math.random() * 0.11, 0)
    const [px, py] = pointAt(s0)
    spawnSmoke(cx + px * sealR, cy + py * sealR, 0.25)
  }
  // 星火：自火星飘散，随烟而上。
  if (t >= IGNITE + 400 && t < FLARE - 300 && t > sparkAt) {
    sparkAt = t + 240 + Math.random() * 260
    if (sparks.length < 40) spawnSpark(ex, ey)
  }

  const gatherP = clamp01((t - GATHER) / (HEART - GATHER))
  const gathering = t >= GATHER
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]
    p.age += dt
    if (gathering) {
      // 螺旋归心：切向绕行、径向渐紧，愈近愈疾。
      const dx = cx - p.x
      const dy = cy - p.y
      const dist = Math.hypot(dx, dy) || 1
      const nx = dx / dist
      const ny = dy / dist
      const swirl = 46 + 150 * gatherP
      const inward = 60 + 900 * gatherP * gatherP
      const mixK = Math.min(1, 2.4 * gatherP + 0.1)
      p.vx += ((-ny * swirl + nx * inward) - p.vx) * mixK * dt * 7
      p.vy += ((nx * swirl + ny * inward) - p.vy) * mixK * dt * 7
      if (dist < 30) {
        puffs.splice(i, 1)
        continue
      }
    } else {
      p.x += p.vx * dt + Math.sin(t * 0.001 * p.freq + p.phase) * p.sway * dt + wind * dt * 0.55
      p.y += p.vy * dt
    }
    if (gathering) {
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    if (p.age >= p.life) {
      puffs.splice(i, 1)
    }
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]
    s.age += dt
    if (s.age >= s.life) {
      sparks.splice(i, 1)
      continue
    }
    s.x += (s.vx + wind) * dt
    s.y += s.vy * dt
    s.vy += 14 * dt
  }
}

function draw(dt: number, t: number) {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx || sprites.length < 5 || !lut.length) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const cx = w / 2
  const cy = h * SEAL_CY
  const R = Math.min(w, h) * SEAL_R
  const b = burnAt(t)
  const [ux, uy] = pointAt(b)
  const ex = cx + ux * R
  const ey = cy + uy * R

  ctx.clearRect(0, 0, w, h)

  /* 灰烬迹（普通叠加）：火星过处的哑色细带，收势时随暮色褪去。 */
  const ashFade = 1 - smooth((t - FLARE) / (SETTLE - FLARE + 900))
  if (b > 0.001 && ashFade > 0.01) {
    ctx.globalAlpha = 1
    for (const g of grains) {
      if (g.s >= b || t < g.born + 380) continue
      ctx.globalAlpha = ashFade * (0.38 + g.base * 0.3)
      const px = cx + g.x * R
      const py = cy + g.y * R
      ctx.drawImage(sprites[3], px - g.size, py - g.size, g.size * 2, g.size * 2)
    }
  }

  /* 以下皆加色叠加：香尘、热界、火星、青烟、星火。 */
  ctx.globalCompositeOperation = 'lighter'

  for (const g of grains) {
    if (t < g.born) continue
    // 洒落：自高处坠定。
    const fall = Math.min((t - g.born) / 380, 1)
    const fallY = (1 - fall) * (1 - fall) * -26
    const px = cx + g.x * R
    const py = cy + g.y * R + fallY
    if (g.s >= b) {
      // 未燃香尘：金明微烁；近火者受热预颤、愈近愈亮。
      const heat = smooth((g.s - b) / 0.009)
      const tw = 0.66 + 0.34 * Math.sin(t * 0.001 * g.tw + g.phase)
      let alpha = g.base * tw * fall
      let size = g.size
      let sx = px
      if (heat > 0) {
        alpha = Math.min(alpha + heat * 0.5, 1)
        size += heat * 1.2
        sx = px + Math.sin(t * 0.018 + g.phase) * heat * 1.4
      }
      ctx.globalAlpha = Math.min(alpha, 0.95)
      ctx.drawImage(sprites[1], sx - size, py - size, size * 2, size * 2)
    }
  }

  /* 火星：亮核 + 辉光，明灭如呼吸。 */
  if (t >= IGNITE) {
    const lit = smooth((t - IGNITE) / 420)
    const flick = 0.78 + 0.14 * Math.sin(t * 0.011) + 0.08 * Math.sin(t * 0.027 + 1.7)
    const emberA = lit * (t < FLARE ? 1 : smooth(1 - (t - FLARE) / 500))
    const gsz = (9.5 + 3 * flick) * emberA
    ctx.globalAlpha = 0.7 * emberA * flick
    ctx.drawImage(sprites[0], ex - gsz, ey - gsz, gsz * 2, gsz * 2)
    const csz = 2.3 + 0.7 * flick
    ctx.globalAlpha = Math.min(1, emberA * 1.05)
    ctx.drawImage(sprites[0], ex - csz * 2, ey - csz * 2, csz * 4, csz * 4)
  }

  /* 青烟：灯下暖灰，初起的一截被火光染暖；归一时收拢渐亮、缩作一线。 */
  const gatherShrink = t >= GATHER ? 1 - 0.55 * clamp01((t - GATHER) / (HEART - GATHER)) : 1
  for (const p of puffs) {
    const env = Math.sin(Math.PI * clamp01(p.age / p.life))
    let alpha = p.alpha * env
    const size = (p.size0 + p.grow * p.age) * gatherShrink
    const spr = p.age < 0.55 ? sprites[4] : sprites[2]
    if (t >= GATHER) {
      const gp = clamp01((t - GATHER) / (HEART - GATHER))
      alpha *= 1 + 0.55 * Math.sin(Math.PI * gp)
      if (t > HEART) alpha *= 1 - smooth((t - HEART) / 900)
    }
    if (alpha <= 0.004) continue
    let drawSize = size
    if (t >= GATHER) {
      // 近心愈细愈敛：烟缕收作一线，让心光做唯一的主语。
      const ddist = Math.hypot(p.x - cx, p.y - cy)
      const near = Math.min(Math.max(ddist / 140, 0.16), 1)
      drawSize = size * near
      alpha *= Math.min(Math.max(ddist / 70, 0.12), 1)
    }
    ctx.globalAlpha = Math.min(alpha, 0.4)
    ctx.drawImage(spr, p.x - drawSize, p.y - drawSize, drawSize * 2, drawSize * 2)
  }

  /* 星火：明灭的暖屑。 */
  for (const s of sparks) {
    const env = Math.sin(Math.PI * clamp01(s.age / s.life))
    const tw = 0.6 + 0.4 * Math.sin(t * 0.02 + s.phase)
    ctx.globalAlpha = 0.85 * env * tw
    ctx.drawImage(sprites[0], s.x - s.size * 2, s.y - s.size * 2, s.size * 4, s.size * 4)
  }

  /* 点火微绽：篆首一朵小小的火光应声而起。 */
  if (t >= IGNITE && t < IGNITE + 560) {
    const fp = (t - IGNITE) / 560
    const [sx0, sy0] = pointAt(0)
    const size = 5 + fp * 30
    ctx.globalAlpha = 0.55 * (1 - fp)
    ctx.drawImage(sprites[0], cx + sx0 * R - size, cy + sy0 * R - size, size * 2, size * 2)
  }

  /* 抵心微绽：一朵光华自篆心荡开。 */
  if (t >= FLARE && t < FLARE + 620) {
    const fp = (t - FLARE) / 620
    const size = 14 + fp * 74
    ctx.globalAlpha = 0.75 * (1 - fp)
    ctx.drawImage(sprites[0], ex - size, ey - size, size * 2, size * 2)
  }

  /* 归一心光：万缕所养的一点澄明，既成后轻轻搏动。 */
  if (t >= GATHER + 200) {
    const born = smooth((t - (GATHER + 200)) / 1300)
    const pulse = t > HEART ? 0.9 + 0.1 * Math.sin((t - HEART) * 0.006) : 1
    const fade = 1 - smooth((t - SETTLE) / 1100)
    const gsz = (8 + 16 * born) * pulse
    ctx.globalAlpha = born * fade
    ctx.drawImage(sprites[4], cx - gsz, cy - gsz, gsz * 2, gsz * 2)
    const csz = (2 + 2.2 * born) * pulse
    ctx.globalAlpha = Math.min(1, born * 1.2 * fade)
    ctx.drawImage(sprites[0], cx - csz * 2, cy - csz * 2, csz * 4, csz * 4)
  }

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

let sealR = 0
function tick(now: number) {
  if (!running) return
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  const t = now - bornAt
  const canvas = canvasEl.value
  if (canvas) {
    const b = burnAt(t)
    const cx = canvas.clientWidth / 2
    const cy = canvas.clientHeight * SEAL_CY
    const [ux, uy] = pointAt(b)
    stepParticles(dt, t, b, cx + ux * sealR, cy + uy * sealR, cx, cy)
  }
  draw(dt, t)
  raf = requestAnimationFrame(tick)
}

function measure() {
  const canvas = canvasEl.value
  if (!canvas) return
  sealR = Math.min(canvas.clientWidth, canvas.clientHeight) * SEAL_R
}

function resize() {
  const canvas = canvasEl.value
  if (!canvas) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(canvas.clientWidth * dpr)
  canvas.height = Math.round(canvas.clientHeight * dpr)
  canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
  measure()
}

function stopCanvas() {
  running = false
  cancelAnimationFrame(raf)
}

const reduceMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

onMounted(() => {
  buildPath()
  refreshPalette()
  spawnGrains()
  resize()
  window.addEventListener('resize', resize)
  if (reduceMotion()) {
    // 一帧静篆（父层在 reduced-motion 下本就不会挂载本组件，保底而已）。
    draw(0, BURN + 2200)
    return
  }
  running = true
  bornAt = performance.now()
  last = bornAt
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t)
  timers = []
  stopCanvas()
  window.removeEventListener('resize', resize)
})
</script>

<template>
  <div
    class="zen-ritual zen-incense"
    :class="{ 'zen-ritual-settle': settling }"
    :style="{
      '--incense-total': TOTAL + 'ms',
      '--ignite': IGNITE + 'ms',
      '--burn': BURN + 'ms',
      '--wash': WASH + 'ms',
    }"
    @click="emit('skip')"
  >
    <!-- 纸纱：纸色四合，徐起徐散 -->
    <div class="incense-veil"></div>

    <!-- 暮色：暖檀四合，破晓时自同一层褪去 -->
    <div class="incense-dusk"></div>

    <!-- 暖晕：篆盘后随燃呼吸的微光 -->
    <div class="incense-halo"></div>

    <!-- 香篆：Canvas 粒子 -->
    <canvas ref="canvasEl" class="incense-canvas" aria-hidden="true"></canvas>

    <!-- 归一暖涟：两圈暖光自屏心荡开 -->
    <div
      v-for="(d, i) in RIPPLES"
      :key="`r${i}`"
      class="incense-ripple"
      :style="{ '--d': d + 'ms' }"
    ></div>

    <!-- 末景水洗：一圈澄明自屏心漫开 -->
    <div class="incense-wash"></div>

    <p class="zen-ritual-skip">{{ COPY.zenSkipHint }}</p>
  </div>
</template>

<style scoped>
/*
 * 暮色取色：香席暮光——暖檀褐掺竹青与纸色，避开纯黑；唯火色随
 * 主题取「纸上的亮」，夜读的 --paper 反转为深色，改取浅色 --ink
 * （取色在脚本 refreshPalette 内）。DOM 侧的暮色三主题共用同一片。
 */
.zen-incense {
  --dusk: color-mix(in srgb, #2c1f16 82%, var(--bamboo));
  --dusk-deep: color-mix(in srgb, #1b120d 88%, var(--sandal));
}

/* 纸纱：纸色四合、边缘晕深，末段散去露出正文。 */
.incense-veil {
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
  animation: incense-veil var(--incense-total) var(--ease-zen) both;
}
@keyframes incense-veil {
  0% {
    opacity: 0;
  }
  7% {
    opacity: 0.62;
  }
  20%,
  86% {
    opacity: 0.78;
  }
  96%,
  100% {
    opacity: 0;
  }
}

/*
 * 暮色：DUSK≈5.1% 起合、2400ms≈17.4% 合拢，SETTLE≈89.1% 褪作天光。
 * 天心留一团暖意（灯下香席），四缘沉入深檀。
 */
.incense-dusk {
  position: absolute;
  inset: 0;
  background:
    /* 灯下香席：篆心留一团暖意 */
    radial-gradient(
      circle 44vmin at 50% var(--ritual-cy),
      color-mix(in srgb, var(--ember) 10%, transparent),
      transparent 68%
    ),
    radial-gradient(
      ellipse 120% 88% at 50% calc(var(--ritual-cy) - 4vh),
      var(--dusk) 0 26%,
      var(--dusk-deep) 88%
    ),
    linear-gradient(
      to top,
      color-mix(in srgb, var(--ember) 6%, transparent),
      transparent 24%
    );
  opacity: 0;
  animation: incense-dusk var(--incense-total) var(--ease-zen) both;
}
/* 百分比与 DUSK≈5.1% / SETTLE≈89.1% 同源。 */
@keyframes incense-dusk {
  0% {
    opacity: 0;
  }
  5.1% {
    opacity: 0;
  }
  17.4% {
    opacity: 1;
  }
  89.1% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

/* 暖晕：篆盘后一团随燃呼吸的微光，归一时收拢让位给心光。 */
.incense-halo {
  position: absolute;
  left: 50%;
  top: var(--ritual-cy);
  width: 46vmin;
  height: 46vmin;
  margin: -23vmin 0 0 -23vmin;
  border-radius: 50%;
  background: radial-gradient(
    closest-side,
    color-mix(in srgb, var(--ember) 6%, transparent),
    color-mix(in srgb, var(--sandal) 5%, transparent) 46%,
    transparent 72%
  );
  opacity: 0;
  animation:
    incense-halo var(--incense-total) linear both,
    incense-breathe 2.6s ease-in-out var(--burn) infinite alternate;
}
/* 百分比与 POWDER≈8% / STAGE_TWO≈58.7% / GATHER≈71.7% 同源。 */
@keyframes incense-halo {
  0%,
  10% {
    opacity: 0;
  }
  17% {
    opacity: 0.42;
  }
  58.7% {
    opacity: 0.38;
  }
  71.7%,
  100% {
    opacity: 0;
  }
}
@keyframes incense-breathe {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.05);
  }
}

.incense-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* 归一暖涟：两圈暖光自屏心荡开（迟一拍递进）。 */
.incense-ripple {
  position: absolute;
  left: 50%;
  top: var(--ritual-cy);
  width: 46vmin;
  height: 46vmin;
  margin: -23vmin 0 0 -23vmin;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    transparent 54%,
    color-mix(in srgb, var(--ember) 26%, transparent) 64%,
    color-mix(in srgb, var(--sandal) 14%, transparent) 70%,
    transparent 74%
  );
  opacity: 0;
  animation: incense-ripple 1.9s cubic-bezier(0.2, 0.6, 0.3, 1) var(--d) both;
}
@keyframes incense-ripple {
  0% {
    opacity: 0;
    transform: scale(0.04);
  }
  12% {
    opacity: 0.75;
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}

/* 末景水洗：一圈澄明自屏心漫开，暮散现禅境（settle 类触发）。 */
.incense-wash {
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
.zen-ritual-settle .incense-wash {
  animation: incense-final-wash var(--wash) var(--ease-zen) both;
}
@keyframes incense-final-wash {
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
