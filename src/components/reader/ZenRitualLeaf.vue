<script setup lang="ts">
/**
 * 入定仪式 · 落叶档 —— 「落叶听禅」。
 *
 * 纱徐起，竹叶自屏上分三批徐徐飘落（沉浮摇摆，各随其性）；暮色随
 * 叶落层层四合，世界随之退去一层（经 stage 事件由 ReaderView 门控
 * 顶栏／面板／边距）。末叶落尽，一圈澄明水洗漫开，纱散，露出禅境。
 *
 * 轻触任意处即跳过（emit('skip')，由父层收束直达稳态）；
 * prefers-reduced-motion 下入定路径不会挂载本组件。
 * 时间线常量与下方 <style> 各动画时长同源，改动须两处同步。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { COPY } from '@/lib/copy'

const emit = defineEmits<{
  /** 世界退层进度：1 顶栏化去，2 面板隐去，3 稳态澄明。 */
  (e: 'stage', n: number): void
  (e: 'skip'): void
  (e: 'finish'): void
}>()

/** 仪式时间线（ms）——与 <style> 同源。 */
const PREP = 1000 // 纱起（叶自此刻分批启程）
const STAGE_ONE = 3100 // 头批叶过，暮色初合
const STAGE_TWO = 5800 // 暮色渐深
const SETTLE = 9800 // 末叶落尽，澄明水洗起
const WASH = 1500
/** 总长——<style> 中纱与暮色的 keyframes 以此总长配比百分比。 */
const TOTAL = SETTLE + WASH // 11.3s

const settling = ref(false)

let timers: ReturnType<typeof setTimeout>[] = []
const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

onMounted(() => {
  at(STAGE_ONE, () => emit('stage', 1))
  at(STAGE_TWO, () => emit('stage', 2))
  at(SETTLE, () => {
    settling.value = true
    emit('stage', 3)
  })
  at(SETTLE + WASH, () => emit('finish'))
})

onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t)
  timers = []
})

/** 一叶竹叶：两头渐尖。坐标系 40×12。 */
const LEAF_D = 'M2 6 Q12 0.5 38 6 Q12 11.5 2 6 Z'

/** 七片叶：横位（vw）、坠落时长/启程延迟（ms）、大小、摇摆周期（s）、
 *  终章旋转（deg）、叶色与浓淡。三批启程（≈1s / 3.9s / 6.4s），
 *  末批恰在 SETTLE 落尽。 */
interface Leaf {
  x: number
  fall: number
  delay: number
  scale: number
  sway: number
  rot: number
  fill: string
  opacity: number
}
const LEAVES: Leaf[] = [
  { x: 14, fall: 5200, delay: 1000, scale: 1.05, sway: 2.0, rot: 46, fill: 'var(--bamboo)', opacity: 0.66 },
  { x: 30, fall: 5600, delay: 1600, scale: 0.85, sway: 2.4, rot: -34, fill: 'color-mix(in srgb, var(--bamboo) 72%, var(--sandal))', opacity: 0.55 },
  { x: 47, fall: 5000, delay: 2100, scale: 1.0, sway: 1.9, rot: 30, fill: 'var(--bamboo)', opacity: 0.7 },
  { x: 63, fall: 4400, delay: 3900, scale: 0.9, sway: 2.2, rot: -50, fill: 'color-mix(in srgb, var(--bamboo) 60%, var(--sandal))', opacity: 0.6 },
  { x: 78, fall: 4600, delay: 4500, scale: 1.1, sway: 2.6, rot: 24, fill: 'var(--bamboo)', opacity: 0.5 },
  { x: 24, fall: 3400, delay: 6400, scale: 0.95, sway: 1.8, rot: -38, fill: 'color-mix(in srgb, var(--sandal) 55%, var(--bamboo))', opacity: 0.65 },
  { x: 55, fall: 3000, delay: 6800, scale: 0.8, sway: 2.1, rot: 42, fill: 'var(--bamboo)', opacity: 0.75 },
]
</script>

<template>
  <div
    class="zen-ritual zen-leaf"
    :class="{ 'zen-ritual-settle': settling }"
    :style="{ '--leaf-total': TOTAL + 'ms', '--wash': WASH + 'ms' }"
    @click="emit('skip')"
  >
    <div class="leaf-veil"></div>

    <!-- 暮色四合：随叶落层层加深，水洗时一并散去 -->
    <div class="leaf-dusk"></div>

    <!-- 落叶：外层坠行，内层摇摆 -->
    <div
      v-for="(leaf, i) in LEAVES"
      :key="i"
      class="leaf"
      :style="{
        '--x': leaf.x + 'vw',
        '--fall': leaf.fall + 'ms',
        '--d': leaf.delay + 'ms',
        '--scale': leaf.scale,
        '--rot': leaf.rot + 'deg',
        '--sway': leaf.sway + 's',
      }"
    >
      <svg class="leaf-blade" viewBox="0 0 40 12" aria-hidden="true">
        <path :d="LEAF_D" :fill="leaf.fill" :fill-opacity="leaf.opacity" />
      </svg>
    </div>

    <!-- 末景水洗：一圈澄明自屏心漫开 -->
    <div class="leaf-wash"></div>

    <p class="zen-ritual-skip">{{ COPY.zenSkipHint }}</p>
  </div>
</template>

<style scoped>
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
@keyframes leaf-veil {
  0% {
    opacity: 0;
  }
  8% {
    opacity: 0.62;
  }
  30%,
  80% {
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
      color-mix(in srgb, var(--bamboo) 9%, transparent) 58%,
      color-mix(in srgb, var(--ink) 14%, transparent) 100%
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--bamboo) 5%, transparent),
      transparent 30% 70%,
      color-mix(in srgb, var(--ink) 8%, transparent)
    );
  opacity: 0;
  animation: leaf-dusk var(--leaf-total) var(--ease-zen) both;
}
/* 百分比与 STAGE_ONE≈28% / STAGE_TWO≈51% 同源。 */
@keyframes leaf-dusk {
  0%,
  24% {
    opacity: 0;
  }
  28% {
    opacity: 0.55;
  }
  51% {
    opacity: 0.85;
  }
  84% {
    opacity: 0.9;
  }
  96%,
  100% {
    opacity: 0;
  }
}

/* 坠行：自屏上飘入，穿屏而下，启程即显形。 */
.leaf {
  position: absolute;
  left: var(--x);
  top: 0;
  width: calc(3.2vmin * var(--scale));
  aspect-ratio: 40 / 12;
  opacity: 0;
  animation: leaf-fall var(--fall) cubic-bezier(0.45, 0.05, 0.55, 0.95) var(--d) both;
  will-change: transform;
}
@keyframes leaf-fall {
  0% {
    opacity: 0;
    transform: translateY(-8vh) rotate(calc(var(--rot) * -0.4));
  }
  7% {
    opacity: 1;
  }
  100% {
    opacity: 1;
    transform: translateY(108vh) rotate(var(--rot));
  }
}

/* 摇摆：叶身左右徐摆，如风穿过竹林。 */
.leaf-blade {
  display: block;
  width: 100%;
  animation: leaf-sway var(--sway) ease-in-out var(--d) infinite alternate;
}
@keyframes leaf-sway {
  from {
    transform: translateX(-1.6vw) rotate(-16deg);
  }
  to {
    transform: translateX(1.6vw) rotate(22deg);
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
