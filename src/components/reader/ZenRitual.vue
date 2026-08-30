<script setup lang="ts">
/**
 * 入定仪式 —— 「一滴墨 · 一笔圆相」。
 *
 * 纱徐起，一滴墨自高处坠入屏心，涟漪化开；笔锋顺势落纸，逆时针绕行
 * 书一枚圆相（墨色随行渐瘦、末段飞白、飞墨随锋绽开），三息呼吸与之
 * 同频——每次呼气，一圈墨晕漫过全屏，世界随之退去一层（经 stage 事件
 * 由 ReaderView 门控顶栏／面板／边距）。末息呼毕，圆相收势旋转，化作
 * 一粒墨点沉入屏心；末一圈水洗漫开，纱散，露出澄明禅境。
 *
 * 轻触任意处即跳过（emit('skip')，由父层收束直达稳态）；
 * prefers-reduced-motion 下父层根本不会挂载本组件。
 * 时间线常量与 motion.css「一滴墨 · 一笔圆相」一节同源，改动须两处同步。
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

/** 仪式时间线（ms）——与 motion.css「一滴墨 · 一笔圆相」同源。 */
const PREP = 1100
const INHALE = 2200
const EXHALE = 2600
const BREATHS = 3
const SINK = 1500
/** 运笔：与第一息吸气同始（1.1s），于第三息吸气顶点收势。 */
const STROKE_DUR = 12900
/** 墨滴落纸时刻（motion.css 的 zen-ink-drop 同源）。 */
const DROP_LAND = 820

type BreathPhase = 'pre' | 'in' | 'out' | 'sink'
const phase = ref<BreathPhase>('pre')
/** 每次换相自增，作为 :key 重触发呼吸动画。 */
const phaseKey = ref(0)
const sinking = ref(false)

let timers: ReturnType<typeof setTimeout>[] = []
const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

function setPhase(p: BreathPhase) {
  phase.value = p
  phaseKey.value++
}

onMounted(() => {
  // 墨滴落纸的一声轻响（尊重提醒静音）。
  at(DROP_LAND, () => {
    if (useSettingsStore().reminder.chime) playZenDropCue()
  })
  const breath = INHALE + EXHALE
  for (let i = 0; i < BREATHS; i++) {
    const base = PREP + i * breath
    at(base, () => setPhase('in'))
    at(base + INHALE, () => {
      setPhase('out')
      // 每次呼气，墨晕漫开，世界退去一层。
      if (i === 0) emit('stage', 1)
      if (i === 1) emit('stage', 2)
    })
  }
  const end = PREP + BREATHS * breath
  at(end, () => {
    sinking.value = true
    setPhase('sink')
    emit('stage', 3)
  })
  at(end + SINK, () => emit('finish'))
})

onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t)
  timers = []
})

/**
 * 圆相一笔：起笔于右上，逆时针绕行 280°，收于右侧——留一口呼吸的缺。
 * 坐标系 600×600，圆心 (300,300)，半径 210。
 */
const ENSO_D = 'M 371.8 102.6 A 210 210 0 1 0 506.8 336.5'

/** 墨滴落纸的两圈涟漪（迟一拍递进）。 */
const LAND_RIPPLES = [DROP_LAND + 40, DROP_LAND + 340]
/** 三次呼气的水洗时刻：墨晕自屏心漫过全屏。 */
const EXHALE_WASHES = [0, 1, 2].map((i) => PREP + i * (INHALE + EXHALE) + INHALE)

/** 飞墨：沿运笔行程排布，笔锋经过时绽开（角度°，半径偏移，大小，抖动）。 */
interface Speck {
  cx: number
  cy: number
  r: number
  delay: number
}
const SPECKS: Speck[] = (
  [
    [-95, 12, 2.6, 60],
    [-128, -10, 3.4, 40],
    [-166, 14, 2.2, 90],
    [-198, -8, 4.2, 30],
    [-226, 10, 2.8, 70],
    [-252, -14, 3.2, 50],
    [-284, 8, 2.4, 40],
    [-318, -6, 3.8, 60],
    [-344, 12, 2.2, 80],
  ] as const
).map(([deg, dr, r, jitter]) => {
  const rad = (deg * Math.PI) / 180
  const rr = 210 + dr
  const sweep = (-70 - deg + 360) % 360 // 相对起笔的行程占比
  return {
    cx: 300 + rr * Math.cos(rad),
    cy: 300 + rr * Math.sin(rad),
    r,
    delay: Math.round((sweep / 280) * STROKE_DUR) + jitter,
  }
})

/** 金尘：仪式期间绕圆缓升的微光，与稳态的微尘萤火一脉相承。 */
const MOTES = [
  [36, 60, 2, 13, 0.2],
  [58, 66, 2.6, 16, 1.4],
  [64, 40, 1.8, 12, 0.8],
  [44, 30, 2.2, 15, 2.2],
  [30, 44, 1.6, 11, 1.1],
  [52, 72, 2.4, 14, 0.5],
  [68, 56, 1.8, 13, 1.9],
  [40, 74, 2, 17, 2.6],
] as const
</script>

<template>
  <div
    class="zen-ritual"
    :class="{ 'zen-ritual-sink': sinking }"
    :style="{ '--stroke-dur': STROKE_DUR + 'ms' }"
    @click="emit('skip')"
  >
    <div class="zen-ritual-veil"></div>

    <!-- 墨滴与涟漪 -->
    <div class="zen-ink-drop"></div>
    <div
      v-for="(d, i) in LAND_RIPPLES"
      :key="`r${i}`"
      class="zen-ink-ripple"
      :style="{ '--d': d + 'ms' }"
    ></div>

    <!-- 金尘微光 -->
    <span
      v-for="(m, i) in MOTES"
      :key="`m${i}`"
      class="zen-gold"
      :style="{ '--x': m[0] + '%', '--y': m[1] + '%', '--s': m[2] + 'px', '--dur': m[3] + 's', '--d': m[4] + 's' }"
    ></span>

    <!-- 一笔圆相 -->
    <svg class="zen-enso" viewBox="0 0 600 600" aria-hidden="true">
      <defs>
        <filter id="zen-ink-rough" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.028"
            numOctaves="3"
            seed="11"
            result="n"
          />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" />
        </filter>
      </defs>
      <g class="zen-enso-inner">
        <!-- 墨晕底层：笔过之处墨入纸纹 -->
        <path class="zen-enso-bleed" :d="ENSO_D" pathLength="100" />
        <g filter="url(#zen-ink-rough)">
          <path class="zen-enso-stroke" :d="ENSO_D" pathLength="100" />
          <!-- 起笔顿锋 -->
          <circle class="zen-enso-press" cx="371.8" cy="102.6" r="7" />
        </g>
        <!-- 飞白：枯笔掠过纸面的留白丝纹 -->
        <path class="zen-enso-white" :d="ENSO_D" pathLength="100" />
        <!-- 飞墨 -->
        <circle
          v-for="(s, i) in SPECKS"
          :key="`s${i}`"
          class="zen-ink-speck"
          :cx="s.cx"
          :cy="s.cy"
          :r="s.r"
          :style="{ '--d': s.delay + 'ms' }"
        />
      </g>
    </svg>

    <!-- 呼吸字与心光 -->
    <div :key="phaseKey" class="zen-breath" :class="`zen-breath-${phase}`">
      <span v-if="phase === 'in' || phase === 'out'" class="zen-breath-word">
        {{ phase === 'in' ? COPY.zenInhale : COPY.zenExhale }}
      </span>
      <div v-if="phase === 'sink'" class="zen-breath-dot"></div>
    </div>

    <!-- 呼气水洗：墨晕漫过全屏，世界退去一层 -->
    <div
      v-for="(d, i) in EXHALE_WASHES"
      :key="`w${i}`"
      class="zen-ink-wash"
      :style="{ '--d': d + 'ms' }"
    ></div>

    <!-- 末息水洗：一圈澄明漫开，纱散现禅境 -->
    <div class="zen-final-wash"></div>

    <p class="zen-ritual-skip">{{ COPY.zenSkipHint }}</p>
  </div>
</template>
