<script setup lang="ts">
/**
 * 歇息引导层 —— 提醒 toast 的动作词点进来，陪你把这一歇歇完。
 *
 * 纸纱深罩，中央衬线动作词 + 引导语 + 细描边倒计时环；时尽轻钟一声
 * 「回来吧」，两息后自退。轻触任意处 / Esc 可跳过。开启期间以捕获阶段
 * 拦下 Esc，避免阅读页拿去出定。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { playZenEnterChime } from '@/lib/chime'
import { COPY } from '@/lib/copy'
import { useSettingsStore } from '@/stores/settings'
import type { ReminderAction } from '@/types/settings'

const props = defineProps<{ open: boolean; action: ReminderAction }>()
const emit = defineEmits<{ close: [] }>()

/** 各动作的建议歇息时长（秒）：望远按 20-20-20，饮水最快，散行最久。 */
const DURATION: Record<ReminderAction, number> = {
  stretch: 45,
  water: 15,
  eyes: 20,
  breathe: 30,
}

const ACTION_TEXT: Record<ReminderAction, string> = {
  stretch: COPY.breakStretch,
  water: COPY.breakWater,
  eyes: COPY.breakEyes,
  breathe: COPY.breakBreathe,
}

const GUIDE_TEXT: Record<ReminderAction, string> = {
  stretch: COPY.restGuideStretch,
  water: COPY.restGuideWater,
  eyes: COPY.restGuideEyes,
  breathe: COPY.restGuideBreathe,
}

const left = ref(0)
const done = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
let doneTimer: ReturnType<typeof setTimeout> | null = null

const total = computed(() => DURATION[props.action])
const text = computed(() => ACTION_TEXT[props.action])
const guide = computed(() => GUIDE_TEXT[props.action])
/** 倒计时环：周长与剩余占比（末秒后停在满圈）。 */
const CIRC = 2 * Math.PI * 54
const dashOffset = computed(
  () => CIRC * (1 - Math.max(0, left.value) / total.value),
)

function stopTimers() {
  if (timer) clearInterval(timer)
  if (doneTimer) clearTimeout(doneTimer)
  timer = null
  doneTimer = null
}

function tick() {
  left.value -= 1
  if (left.value > 0) return
  stopTimers()
  done.value = true
  if (useSettingsStore().reminder.chime) playZenEnterChime()
  doneTimer = setTimeout(() => emit('close'), 2000)
}

function skip() {
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  skip()
}

watch(
  () => props.open,
  (open) => {
    stopTimers()
    done.value = false
    if (open) {
      left.value = total.value
      timer = setInterval(tick, 1000)
      window.addEventListener('keydown', onKey, true)
    } else {
      window.removeEventListener('keydown', onKey, true)
    }
  },
)

onBeforeUnmount(() => {
  stopTimers()
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="rest-guide" @click="skip">
        <span class="rest-word">{{ text }}</span>
        <span class="rest-guide-text">{{ done ? COPY.restDone : guide }}</span>

        <div class="rest-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="rest-ring-track" cx="60" cy="60" r="54" />
            <circle
              class="rest-ring-arc"
              cx="60"
              cy="60"
              r="54"
              :stroke-dasharray="CIRC"
              :stroke-dashoffset="dashOffset"
            />
          </svg>
          <span class="rest-seconds tabular-nums">{{ done ? '·' : left }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.rest-guide {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  backdrop-filter: blur(5px);
  cursor: pointer;
  user-select: none;
}
.rest-word {
  font-family: var(--font-serif);
  font-size: clamp(1.6rem, 4vmin, 2.4rem);
  color: var(--ink);
  letter-spacing: 0.12em;
}
.rest-guide-text {
  font-size: 0.85rem;
  color: var(--ink-soft);
  letter-spacing: 0.06em;
}
.rest-ring {
  position: relative;
  width: clamp(120px, 22vmin, 180px);
  height: clamp(120px, 22vmin, 180px);
  margin-top: 0.6rem;
}
.rest-ring svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
.rest-ring-track,
.rest-ring-arc {
  fill: none;
  stroke-width: 1.5;
}
.rest-ring-track {
  stroke: color-mix(in srgb, var(--ink) 10%, transparent);
}
.rest-ring-arc {
  stroke: var(--bamboo);
  stroke-linecap: round;
  /* 每秒一档，随秒针徐徐收拢。 */
  transition: stroke-dashoffset 1s linear;
}
.rest-seconds {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--font-serif);
  font-size: 2rem;
  color: var(--ink-soft);
}
</style>
