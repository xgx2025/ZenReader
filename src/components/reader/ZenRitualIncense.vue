<script setup lang="ts">
/**
 * 入定仪式 · 香篆档 —— 「香篆引定」。
 *
 * 纱徐起，一炷香自屏心之下立起、火星微明；烟丝袅袅，随行书篆，
 * 暖光随烟徐聚——烟盛时世界退去一层（经 stage 事件由 ReaderView
 * 门控顶栏／面板／边距）。烟散光凝，一点澄明沉入屏心，末一圈水洗
 * 漫开，纱散，露出禅境。与「香升格」专注钟同一炷香意象。
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
const PREP = 900 // 纱起
const IGNITE = 1100 // 香立起，火星点亮
const STAGE_ONE = 3100 // 烟起纱合
const STAGE_TWO = 5800 // 光晕漫开
const GATHER = 8300 // 烟散光凝，澄明水洗起
const WASH = 1500
/** 总长——<style> 中纱与光晕的 keyframes 以此总长配比百分比。 */
const TOTAL = GATHER + WASH // 9.8s

const gathering = ref(false)

let timers: ReturnType<typeof setTimeout>[] = []
const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

onMounted(() => {
  at(STAGE_ONE, () => emit('stage', 1))
  at(STAGE_TWO, () => emit('stage', 2))
  at(GATHER, () => {
    gathering.value = true
    emit('stage', 3)
  })
  at(GATHER + WASH, () => emit('finish'))
})

onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t)
  timers = []
})

/** 三缕烟丝：自香头（香座 ≈ (100, 332)）向上袅绕、交错书篆。 */
const WISPS = [
  {
    d: 'M100 332 C94 296 110 272 100 240 C90 208 112 184 100 150 C90 118 110 96 102 60',
    draw: 4600,
    delay: 1400,
    width: 1.5,
    opacity: 0.5,
  },
  {
    d: 'M100 332 C108 300 88 272 98 240 C108 208 86 180 98 146 C108 116 90 92 100 56',
    draw: 5200,
    delay: 2100,
    width: 1.1,
    opacity: 0.38,
  },
  {
    d: 'M100 332 C96 306 106 284 100 258 C94 232 108 210 100 182 C94 156 106 132 100 108',
    draw: 3800,
    delay: 2900,
    width: 0.9,
    opacity: 0.3,
  },
]
</script>

<template>
  <div
    class="zen-ritual zen-incense"
    :class="{ 'zen-ritual-gather': gathering }"
    :style="{ '--total': TOTAL + 'ms', '--ignite': IGNITE + 'ms', '--wash': WASH + 'ms' }"
    @click="emit('skip')"
  >
    <div class="incense-veil"></div>

    <!-- 暖光随烟徐聚 -->
    <div class="incense-halo"></div>

    <!-- 香与烟 -->
    <div class="incense">
      <svg
        class="incense-smoke"
        viewBox="0 0 200 340"
        preserveAspectRatio="xMidYMax meet"
        aria-hidden="true"
      >
        <defs>
          <filter id="zen-incense-wisp" x="-30%" y="-15%" width="160%" height="130%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.035 0.05"
              numOctaves="2"
              seed="7"
              result="n"
            />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="7" />
          </filter>
        </defs>
        <g filter="url(#zen-incense-wisp)">
          <path
            v-for="(w, i) in WISPS"
            :key="i"
            class="smoke-wisp"
            :d="w.d"
            pathLength="100"
            :style="{ '--draw': w.draw + 'ms', '--d': w.delay + 'ms', '--o': w.opacity, 'stroke-width': w.width + 'px' }"
          />
        </g>
      </svg>
      <div class="incense-body">
        <div class="incense-stick"></div>
        <div class="incense-ember"></div>
      </div>
    </div>

    <!-- 末景水洗：一圈澄明自屏心漫开 -->
    <div class="incense-wash"></div>

    <p class="zen-ritual-skip">{{ COPY.zenSkipHint }}</p>
  </div>
</template>

<style scoped>
/* 纱：纸色四合，徐起徐散。 */
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
  animation: incense-veil var(--total) var(--ease-zen) both;
}
@keyframes incense-veil {
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

/* 暖光晕：檀色掺火星，随烟聚于屏心；光凝时缩作一点。 */
.incense-halo {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 50% var(--ritual-cy),
    color-mix(in srgb, var(--sandal) 16%, transparent) 0%,
    color-mix(in srgb, var(--ember) 8%, transparent) 22%,
    transparent 52%
  );
  opacity: 0;
  transform-origin: 50% var(--ritual-cy);
  animation: incense-halo var(--total) var(--ease-zen) both;
}
/* 百分比与 STAGE_ONE≈32% / STAGE_TWO≈59% / GATHER≈85% 同源。 */
@keyframes incense-halo {
  0%,
  31% {
    opacity: 0;
    transform: scale(0.9);
  }
  59% {
    opacity: 0.8;
    transform: scale(1);
  }
  78% {
    opacity: 0.7;
    transform: scale(1.05);
  }
  88% {
    opacity: 0.55;
    transform: scale(0.55);
  }
  96%,
  100% {
    opacity: 0;
    transform: scale(0.4);
  }
}

/* 香座：以屏心（--ritual-cy）下方 14vmin 处为香头基准。 */
.incense {
  position: absolute;
  left: 50%;
  top: calc(var(--ritual-cy) - 16vmin);
  width: 34vmin;
  height: 30vmin;
  margin-left: -17vmin;
}

/* 烟丝：整组徐缓漂移；光凝时随香俱散。 */
.incense-smoke {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transition: opacity 1.1s var(--ease-zen);
  animation: smoke-drift 7.5s ease-in-out infinite alternate;
}
.zen-ritual-gather .incense-smoke {
  opacity: 0;
}
@keyframes smoke-drift {
  from {
    transform: translateX(-1.5%) rotate(-0.6deg);
  }
  to {
    transform: translateX(1.5%) rotate(0.6deg);
  }
}

.smoke-wisp {
  fill: none;
  stroke: color-mix(in srgb, var(--ink-soft) 55%, var(--sandal) 45%);
  stroke-linecap: round;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  opacity: 0;
  animation: wisp-draw var(--draw) var(--ease-zen) var(--d) both;
}
@keyframes wisp-draw {
  0% {
    stroke-dashoffset: 100;
    opacity: 0;
  }
  10% {
    opacity: var(--o);
  }
  85% {
    opacity: var(--o);
  }
  100% {
    stroke-dashoffset: 0;
    opacity: var(--o);
  }
}

/* 香体（杆 + 火星）：光凝时一并淡去。 */
.incense-body {
  transition: opacity 0.9s var(--ease-zen);
}
.zen-ritual-gather .incense-body {
  opacity: 0;
}

.incense-stick {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 2px;
  height: 9vmin;
  margin-left: -1px;
  border-radius: 1px;
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--sandal) 80%, var(--ink) 20%),
    color-mix(in srgb, var(--sandal) 45%, var(--paper-deep) 55%)
  );
  transform-origin: bottom;
  transform: scaleY(0);
  animation: stick-grow 0.9s var(--ease-zen) var(--ignite) both;
}
@keyframes stick-grow {
  from {
    transform: scaleY(0);
  }
  to {
    transform: scaleY(1);
  }
}

/* 火星：点亮后徐徐明灭。 */
.incense-ember {
  position: absolute;
  left: 50%;
  bottom: 9vmin;
  width: 5px;
  height: 5px;
  margin-left: -2.5px;
  margin-bottom: -2px;
  border-radius: 50%;
  background: var(--ember);
  box-shadow: 0 0 8px 2px color-mix(in srgb, var(--ember) 55%, transparent);
  opacity: 0;
  animation:
    ember-lit 0.5s var(--ease-zen) var(--ignite) both,
    ember-pulse 2.4s ease-in-out calc(var(--ignite) + 0.5s) infinite alternate;
}
@keyframes ember-lit {
  from {
    opacity: 0;
    transform: scale(0.4);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes ember-pulse {
  from {
    opacity: 0.6;
    box-shadow: 0 0 5px 1px color-mix(in srgb, var(--ember) 40%, transparent);
  }
  to {
    opacity: 1;
    box-shadow: 0 0 10px 3px color-mix(in srgb, var(--ember) 60%, transparent);
  }
}

/* 末景水洗：与墨韵档的 zen-final-wash 同形，改由 gather 类触发。 */
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
.zen-ritual-gather .incense-wash {
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
