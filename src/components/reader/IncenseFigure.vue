<script setup lang="ts">
import { computed } from 'vue'

/**
 * 燃香图 -- 一柱真的会烧短的香。
 *
 * progress（0-1 已燃比例）驱动：香身自顶端烧短，燃点处悬一粒明灭的
 * 火光（--ember），青烟自火光处袅袅而上。香将尽时传 hot，火光转急。
 * 未燃时只余一柱静香，无火无烟。
 */
const props = withDefaults(
  defineProps<{
    progress?: number
    lit?: boolean
    /** 香将尽：火光转急（燃香预提示阶段）。 */
    hot?: boolean
    size?: 'sm' | 'lg'
  }>(),
  { progress: 0, lit: false, hot: false, size: 'sm' },
)

const geo = computed(() => {
  const burned = Math.min(1, Math.max(0, props.progress))
  if (props.size === 'lg') {
    const stickH = 38
    const baseY = 57
    return {
      vb: '0 0 24 64',
      cx: 12,
      baseY,
      topY: baseY - stickH * (1 - burned),
      sw: 2.4,
      smokeLen: 16,
      sway: 2.2,
      haloR: 3.6,
      coreR: 1.7,
      holder: 'M7 57h10',
      bowl: 'M7 57c1.6 3.4 8.4 3.4 10 0',
    }
  }
  const stickH = 24
  const baseY = 38
  return {
    vb: '0 0 20 42',
    cx: 10,
    baseY,
    topY: baseY - stickH * (1 - burned),
    sw: 2,
    smokeLen: 12,
    sway: 1.8,
    haloR: 3,
    coreR: 1.3,
    holder: 'M5.5 38h9',
    bowl: null as string | null,
  }
})

/** 三段 S 弯的烟迹，自燃点向上。 */
const smokeD = computed(() => {
  const { cx, topY, smokeLen, sway } = geo.value
  const y = topY - 1.5
  const s = smokeLen / 3
  return [
    `M ${cx} ${y}`,
    `C ${cx - sway} ${y - s * 0.7}, ${cx + sway} ${y - s * 1.5}, ${cx - sway * 0.4} ${y - s * 2.1}`,
    `C ${cx - sway * 1.4} ${y - s * 2.7}, ${cx + sway * 1.2} ${y - s * 3.1}, ${cx - sway * 0.5} ${y - smokeLen}`,
  ].join(' ')
})
</script>

<template>
  <svg :viewBox="geo.vb" class="overflow-visible" aria-hidden="true">
    <!-- 青烟：两缕错拍，袅袅而散 -->
    <g
      v-if="lit"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      :stroke-width="geo.sw * 0.5"
      opacity="0.45"
    >
      <path :d="smokeD" class="incense-smoke" />
      <path :d="smokeD" class="incense-smoke incense-smoke-late" />
    </g>

    <!-- 香脚与香炉 -->
    <path
      :d="geo.holder"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      fill="none"
      opacity="0.75"
    />
    <path
      v-if="geo.bowl"
      :d="geo.bowl"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      fill="none"
      opacity="0.55"
    />

    <!-- 香身：随燃而短 -->
    <rect
      :x="geo.cx - geo.sw / 2"
      :y="geo.topY"
      :width="geo.sw"
      :height="Math.max(0, geo.baseY - geo.topY)"
      :rx="geo.sw / 2.4"
      fill="currentColor"
      class="transition-[y,height] duration-1000 ease-linear"
    />

    <!-- 燃点：一粒火光，明灭有息 -->
    <g v-if="lit" style="filter: drop-shadow(0 0 2px var(--ember))">
      <circle
        :cx="geo.cx"
        :cy="geo.topY"
        :r="geo.haloR"
        fill="var(--ember)"
        opacity="0.35"
        class="incense-ember transition-[cy] duration-1000 ease-linear"
        :class="{ 'incense-ember-hot': hot }"
      />
      <circle
        :cx="geo.cx"
        :cy="geo.topY"
        :r="geo.coreR"
        fill="var(--ember)"
        class="incense-ember transition-[cy] duration-1000 ease-linear"
        :class="{ 'incense-ember-hot': hot }"
      />
    </g>
  </svg>
</template>
