<script setup lang="ts">
/**
 * 入定仪式 · 星河档 —— 「星河入砚」。
 *
 * 夜幕徐合，纸色沉入墨蓝；万点星尘自幕中渗出，缓缓旋成一泓斜倾的
 * 银河（两旋臂、内快外慢的差速旋转），随一吸一呼轻轻涨落。归一之际
 * 星河向砚心收拢，万点凝作一滴星芒；星滴坠入砚心，两圈光涟荡开，
 * 破晓自天际褪去夜色，末一圈澄明水洗漫开，露出禅境——满天星河，
 * 收作一粒墨，寓意「一即一切」。
 *
 * 星河由 Canvas 粒子系统绘制（预渲染辉光精灵 + 加色叠加），夜幕/
 * 星晕/星滴/光涟为 DOM 层；世界退层经 stage 事件由 ReaderView 门控
 * 顶栏／面板／边距。轻触任意处即跳过（emit('skip')）；
 * prefers-reduced-motion 下父层根本不会挂载本组件。
 * 时间线常量与下方 <style> 各 keyframes 百分比/延迟同源，改动须两处同步。
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
const NIGHTFALL = 2000 // 夜幕徐合（星自此际后半渗出）
const STAGE_ONE = 4800 // 夜合星旋，世界退一层
const STAGE_TWO = 9200 // 归一开始，星河向砚心收拢
const CONVERGE = 12500 // 万点凝作一滴
const DROP = 13100 // 星滴启程坠落（0.66s 后落砚）
const DROP_LAND = DROP + 660 // 落砚一声轻响，光涟荡开
const SETTLE = 14150 // 破晓褪夜，澄明水洗起（星滴先落、光涟既起，水洗方来）
const WASH = 1600
/** 总长——<style> 中夜幕/星晕的 keyframes 以此总长配比百分比。 */
const TOTAL = SETTLE + WASH // 15.75s

/** 呼吸涨落：自 stage 1 至 stage 2 恰好一吸一呼（与星晕 CSS 同源）。 */
const BREATH_MS = STAGE_TWO - STAGE_ONE

/** 星滴落砚的两圈光涟（迟一拍递进）。 */
const RIPPLES = [DROP_LAND + 40, DROP_LAND + 320]

const settling = ref(false)

let timers: ReturnType<typeof setTimeout>[] = []
const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

onMounted(() => {
  at(STAGE_ONE, () => emit('stage', 1))
  at(STAGE_TWO, () => emit('stage', 2))
  // 星滴落砚的一声轻响（尊重提醒静音）。
  at(DROP_LAND, () => {
    if (useSettingsStore().reminder.chime) playZenDropCue()
  })
  at(SETTLE, () => {
    settling.value = true
    emit('stage', 3)
  })
  at(TOTAL, () => emit('finish'))
})

/* ---------- 星河 Canvas：粒子 × 辉光精灵 × 差速旋转 ---------- */

const canvasEl = ref<HTMLCanvasElement | null>(null)

/** 星数：取「万点」之意、桌面可流畅绘制的量级。 */
const STARS = 520
/** 天心：星河旋心在砚心（--ritual-cy）上方 11vh 的天区（与 CSS --sky 同源）。 */
const SKY_LIFT_VH = 11
const RITUAL_CY = 0.45
/** 星盘侧倾：椭圆纵横比与整体倾角，如银河斜贯天际。 */
const DISK_SQUASH = 0.62
const DISK_TILT = -0.46

interface Star {
  /** 归一轨道半径 0..1（幂偏置：核密外疏）。 */
  r: number
  /** 轨道角（rad）。 */
  a: number
  /** 差速角速基准（rad/s，内快外慢）。 */
  w: number
  /** 绘制半径（px）。 */
  size: number
  base: number
  phase: number
  tw: number
  sprite: number
}

let stars: Star[] = []
let sprites: HTMLCanvasElement[] = []
let raf = 0
let running = false
let bornAt = 0
let last = 0

type Rgb = [number, number, number]

/** 自主题变量取色（#rgb / #rrggbb），失败则用手调的禅意色（同 ZenMotes）。 */
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

/** 辉光精灵：中心亮、外缘骤散的柔光点，加色叠加即成星芒。 */
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

/** 星光三色：暖白为主，掺竹青与檀色——夜空里的五色禅意。 */
function refreshPalette() {
  const dark = document.documentElement.dataset.theme === 'dark'
  const lum = pickHex(
    dark ? '--ink' : '--paper',
    dark ? [232, 226, 213] : [247, 242, 233],
  )
  const ember = pickHex('--ember', [166, 124, 82])
  const bamboo = pickHex('--bamboo', [95, 122, 92])
  const sandal = pickHex('--sandal', [138, 111, 91])
  const star = mixRgb(lum, ember, 0.14)
  sprites = [
    makeSprite(star),
    makeSprite(mixRgb(star, bamboo, 0.55), 0.85),
    makeSprite(mixRgb(star, sandal, 0.6), 0.8),
  ]
}

function spawn(): Star[] {
  return Array.from({ length: STARS }, (_, i) => {
    // 核球密、盘面疏的幂偏置半径。
    const bulge = Math.random() < 0.24
    const r = bulge
      ? Math.pow(Math.random(), 2.6)
      : 0.12 + Math.pow(Math.random(), 1.35) * 0.88
    // 两旋臂（对数螺线），两成散星填满盘面。
    const arm = (i % 2) * Math.PI
    const spread = Math.random() < 0.2
    const a = spread
      ? Math.random() * Math.PI * 2
      : arm +
        2.6 * Math.log(1 + r * 5.4) +
        (Math.random() + Math.random() - 1) * (0.34 + r * 0.3)
    const bright = Math.random() < 0.07
    const roll = Math.random()
    return {
      r,
      a,
      // 差速：内快外慢（开普勒味道）；转向取负，与墨韵圆相同为逆时针。
      w: 0.1 + 0.16 / (0.12 + r),
      size: (0.7 + Math.pow(Math.random(), 2.2) * 2.4) * (bright ? 1.9 : 1),
      base: (bulge ? 0.55 : 0.3) + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      tw: 0.5 + Math.random() * 1.1,
      sprite: bright || roll >= 0.3 ? 0 : roll < 0.2 ? 1 : 2,
    }
  })
}

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)
const smooth = (t: number) => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}
const inOutCubic = (t: number) => {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** 相位时钟：时间线常量驱动全局状态——星光显隐 / 半径收涨 / 转速 / 星心辉光。 */
function phaseState(t: number) {
  // 初拢：散星徐徐收成盘面。
  const gather = 1.14 - 0.14 * smooth((t - NIGHTFALL * 0.5) / (STAGE_ONE - NIGHTFALL * 0.5))
  // 归一：星河向砚心收拢，转速随半径收小而愈疾。
  const cs = inOutCubic((t - STAGE_TWO) / (CONVERGE - STAGE_TWO))
  // 一息涨落：涨落包络乘整周正弦，恰好一吸一呼。
  const bp = clamp01((t - STAGE_ONE) / BREATH_MS)
  const swell = Math.sin(Math.PI * bp) * Math.sin(bp * Math.PI * 2 - Math.PI / 2)
  const radius = gather * (1 - cs * (1 - 0.055)) * (1 + 0.035 * swell)
  // 落砚后星河隐去，让位给星滴与光涟。
  const fade = 1 - smooth((t - DROP) / 900)
  // 星心：归一后半程亮起，星滴启程后让位。
  const core =
    smooth((t - (STAGE_TWO + (CONVERGE - STAGE_TWO) * 0.7)) / ((CONVERGE - STAGE_TWO) * 0.3)) *
    (1 - smooth((t - DROP) / 700))
  return {
    alpha: smooth((t - NIGHTFALL * 0.45) / 2600) * fade,
    radius,
    spin: 1 + cs * 1.8,
    core,
    dim: 1 - cs * 0.25,
  }
}

function draw(dt: number, t: number) {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx || !sprites.length) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const st = phaseState(t)
  ctx.clearRect(0, 0, w, h)
  if (st.alpha <= 0.004) return
  const maxR = Math.min(w, h) * 0.5
  const cx = w / 2
  const cy = h * (RITUAL_CY - SKY_LIFT_VH / 100)
  const cosT = Math.cos(DISK_TILT)
  const sinT = Math.sin(DISK_TILT)
  ctx.globalCompositeOperation = 'lighter'
  for (const s of stars) {
    s.a -= s.w * st.spin * dt
    const rr = s.r * st.radius * maxR
    const ex = Math.cos(s.a) * rr
    const ey = Math.sin(s.a) * rr * DISK_SQUASH
    // 星盘侧倾：先椭圆压扁再整体倾转。
    const x = cx + ex * cosT - ey * sinT
    const y = cy + ex * sinT + ey * cosT
    const tw = 0.62 + 0.38 * Math.sin(t * s.tw + s.phase)
    const alpha = st.alpha * st.dim * s.base * tw
    if (alpha <= 0.004) continue
    // 归一时万点聚拢，加色叠加自会亮成星心。
    const boost = 1 + (1 - st.radius) * 1.7
    const sz = s.size * boost
    ctx.globalAlpha = Math.min(alpha, 1)
    ctx.drawImage(sprites[s.sprite], x - sz, y - sz, sz * 2, sz * 2)
  }
  if (st.core > 0.004) {
    // 星心：将凝未凝的一点亮芒。
    const g = maxR * 0.3 * (0.45 + 0.55 * st.core)
    ctx.globalAlpha = st.core * 0.85 * st.alpha
    ctx.drawImage(sprites[0], cx - g, cy - g, g * 2, g * 2)
    const d = maxR * 0.045
    ctx.globalAlpha = Math.min(1, st.core * 1.15)
    ctx.drawImage(sprites[0], cx - d, cy - d, d * 2, d * 2)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

function tick(now: number) {
  if (!running) return
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  draw(dt, now - bornAt)
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

function stopCanvas() {
  running = false
  cancelAnimationFrame(raf)
}

function onResize() {
  resize()
}

const reduceMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

onMounted(() => {
  refreshPalette()
  resize()
  stars = spawn()
  window.addEventListener('resize', onResize)
  if (reduceMotion()) {
    // 一帧静星（父层在 reduced-motion 下本就不会挂载本组件，保底而已）。
    draw(0, STAGE_ONE + 2200)
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
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div
    class="zen-ritual zen-galaxy"
    :class="{ 'zen-ritual-settle': settling }"
    :style="{
      '--galaxy-total': TOTAL + 'ms',
      '--stage-one': STAGE_ONE + 'ms',
      '--drop': DROP + 'ms',
      '--drop-dur': DROP_LAND - DROP + 550 + 'ms',
      '--drop-land': DROP_LAND - DROP + 'ms',
      '--wash': WASH + 'ms',
    }"
    @click="emit('skip')"
  >
    <!-- 夜幕：纸色沉入墨蓝，破晓时自同一层褪去 -->
    <div class="galaxy-night"></div>

    <!-- 星晕：随星河呼吸的微光（星河之下） -->
    <div class="galaxy-halo"></div>

    <!-- 星河：Canvas 粒子 -->
    <canvas ref="canvasEl" class="galaxy-canvas" aria-hidden="true"></canvas>

    <!-- 星滴：万点所凝，自天心坠入砚心 -->
    <div class="galaxy-drop"></div>

    <!-- 落砚光涟：两圈星光自砚心荡开 -->
    <div
      v-for="(d, i) in RIPPLES"
      :key="`r${i}`"
      class="galaxy-ripple"
      :style="{ '--d': d + 'ms' }"
    ></div>

    <!-- 末景水洗：一圈澄明自砚心漫开 -->
    <div class="galaxy-wash"></div>

    <p class="zen-ritual-skip">{{ COPY.zenSkipHint }}</p>
  </div>
</template>

<style scoped>
/*
 * 夜幕与星光取色：夜空是本场自含的场景，亮/暮/夜三主题共用同一片
 * 墨蓝（掺竹青以合五色、远离纯黑）；唯星光须随主题取「纸上的亮」——
 * 亮/暮取纸色掺火星，夜读的 --paper 反转为深色，改取浅色 --ink。
 */
.zen-galaxy {
  --sky: calc(var(--ritual-cy) - 11vh);
  --night: color-mix(in srgb, #202a3e 86%, var(--bamboo));
  --night-deep: color-mix(in srgb, #10151f 90%, var(--bamboo));
  --star: color-mix(in srgb, var(--paper) 88%, var(--ember));
}
:global([data-theme='dark']) .zen-galaxy {
  --star: color-mix(in srgb, var(--ink) 88%, var(--paper));
}

/* 夜幕：徐合（NIGHTFALL≈13.3%）→ 满夜 → 破晓自 SETTLE≈89.3% 褪去。 */
.galaxy-night {
  position: absolute;
  inset: 0;
  background:
    /* 银河带：斜贯天际的一痕微光 */
    linear-gradient(
      112deg,
      transparent 36%,
      color-mix(in srgb, var(--star) 5%, transparent) 46%,
      color-mix(in srgb, var(--bamboo) 6%, transparent) 52%,
      transparent 62%
    ),
    /* 远山如黛：天际线下的一痕竹影 */
    linear-gradient(
      to top,
      color-mix(in srgb, var(--bamboo) 16%, var(--night-deep)) 0,
      transparent 16%
    ),
    radial-gradient(
      ellipse 120% 88% at 50% var(--sky),
      color-mix(in srgb, var(--night) 70%, transparent) 0 26%,
      var(--night-deep) 86%
    ),
    var(--night-deep);
  opacity: 0;
  animation: galaxy-night var(--galaxy-total) var(--ease-zen) both;
}
/* 百分比与 NIGHTFALL≈12.7% / SETTLE≈89.8% 同源。 */
@keyframes galaxy-night {
  0% {
    opacity: 0;
  }
  12.7% {
    opacity: 1;
  }
  89.8% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

/* 星晕：天心一团随呼吸涨落的微光，归一时收拢让位给星心。 */
.galaxy-halo {
  position: absolute;
  left: 50%;
  top: var(--sky);
  width: 66vmin;
  height: 44vmin;
  margin: -22vmin 0 0 -33vmin;
  border-radius: 50%;
  background:
    radial-gradient(
      closest-side,
      color-mix(in srgb, var(--star) 13%, transparent),
      transparent 72%
    ),
    radial-gradient(
      closest-side,
      color-mix(in srgb, var(--bamboo) 11%, transparent),
      transparent 70%
    );
  opacity: 0;
  animation:
    galaxy-halo var(--galaxy-total) linear both,
    galaxy-breathe 2.2s ease-in-out var(--stage-one) infinite alternate;
}
/* 百分比与 STAGE_ONE≈30.5% / STAGE_TWO≈58.4% / CONVERGE≈79.4% 同源。 */
@keyframes galaxy-halo {
  0% {
    opacity: 0;
  }
  30.5% {
    opacity: 1;
  }
  58.4% {
    opacity: 0.85;
  }
  79.4% {
    opacity: 0;
  }
  100% {
    opacity: 0;
  }
}
@keyframes galaxy-breathe {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.06);
  }
}

.galaxy-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/*
 * 星滴：万点所凝的一滴星芒，自天心坠入砚心（--sky → --ritual-cy，
 * 恰 11vh）。坠与碎同属一段 keyframes（坠 0.66s / 碎 0.55s，共
 * --drop-dur），免两段动画对 transform 的相互覆盖。
 */
.galaxy-drop {
  position: absolute;
  left: 50%;
  top: var(--sky);
  width: 1.25vmin;
  height: 1.65vmin;
  margin: -0.82vmin 0 0 -0.62vmin;
  border-radius: 50% 50% 58% 58%;
  background: color-mix(in srgb, var(--star) 92%, transparent);
  box-shadow:
    0 0 1.6vmin color-mix(in srgb, var(--star) 62%, transparent),
    0 0 5.2vmin color-mix(in srgb, var(--star) 24%, transparent);
  opacity: 0;
  animation: galaxy-drop var(--drop-dur) cubic-bezier(0.55, 0, 0.72, 0.45) var(--drop) both;
}
/* 坠程 660ms 占 --drop-dur 的 54.5%（与 DROP_LAND - DROP 同源）。 */
@keyframes galaxy-drop {
  0% {
    opacity: 0;
    transform: translateY(-5vmin) scale(0.6) scaleY(1.32);
  }
  10% {
    opacity: 1;
  }
  54.5% {
    opacity: 1;
    transform: translateY(11vh) scaleY(1.12);
  }
  70% {
    opacity: 1;
    transform: translateY(calc(11vh + 2px)) scale(1.9, 0.42);
  }
  100% {
    opacity: 0;
    transform: translateY(calc(11vh + 7px)) scale(0.2, 0.08);
  }
}
/* 坠落的星尾。 */
.galaxy-drop::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 96%;
  width: 1.5px;
  height: 8vmin;
  transform-origin: bottom;
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--star) 55%, transparent),
    transparent
  );
  opacity: 0;
  animation: galaxy-tail 0.66s linear var(--drop) both;
}
@keyframes galaxy-tail {
  0% {
    opacity: 0.7;
    transform: translateX(-50%) scaleY(1);
  }
  100% {
    opacity: 0.95;
    transform: translateX(-50%) scaleY(0.12);
  }
}

/* 落砚光涟：两圈星光自砚心荡开（迟一拍递进）。 */
.galaxy-ripple {
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
    color-mix(in srgb, var(--star) 30%, transparent) 64%,
    transparent 73%
  );
  opacity: 0;
  animation: galaxy-ripple 1.9s cubic-bezier(0.2, 0.6, 0.3, 1) var(--d) both;
}
@keyframes galaxy-ripple {
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

/* 末景水洗：一圈澄明自砚心漫开，夜散现禅境（settle 类触发）。 */
.galaxy-wash {
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
.zen-ritual-settle .galaxy-wash {
  animation: galaxy-final-wash var(--wash) var(--ease-zen) both;
}
@keyframes galaxy-final-wash {
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
