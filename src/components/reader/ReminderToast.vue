<script setup lang="ts">
import { computed } from 'vue'

import ZIcon, { type IconName } from '@/components/common/ZIcon.vue'
import { useZenClock } from '@/composables/useZenClock'
import { useSettingsStore } from '@/stores/settings'
import { COPY } from '@/lib/copy'
import type { ReminderAction } from '@/types/settings'

const { reminderOpen, reminderLevel, reminderAction, dismiss, ignite } = useZenClock()
const settings = useSettingsStore()

const ACTION_ICON: Record<ReminderAction, IconName> = {
  stretch: 'figure',
  water: 'droplet',
  eyes: 'eye',
  breathe: 'breath',
}

const ACTION_TEXT: Record<ReminderAction, string> = {
  stretch: COPY.breakStretch,
  water: COPY.breakWater,
  eyes: COPY.breakEyes,
  breathe: COPY.breakBreathe,
}

const text = computed(() => ACTION_TEXT[reminderAction.value])
const icon = computed(() => ACTION_ICON[reminderAction.value])

/** 歇毕一键续香：关掉提醒并点燃下一炷。 */
function onRelight() {
  dismiss()
  ignite()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade-slide">
      <div
        v-if="reminderOpen"
        class="pointer-events-auto fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full border bg-paper/95 px-4 py-2.5 shadow-zen-md backdrop-blur-sm transition-colors duration-300"
        :class="
          reminderLevel === 2
            ? 'border-bamboo/50 shadow-zen-lg zen-breathe'
            : 'border-line'
        "
        @click="dismiss"
      >
        <ZIcon :name="icon" :size="16" class="zen-breathe shrink-0 text-sandal" />
        <div class="flex flex-col items-start leading-tight">
          <span v-if="!settings.zenMode" class="text-xs text-dusk">
            {{ COPY.incenseGone }}
          </span>
          <span
            class="font-serif text-ink"
            :class="reminderLevel === 2 ? 'text-base' : 'text-sm'"
          >
            {{ text }}
          </span>
        </div>
        <button
          type="button"
          class="ml-1 shrink-0 rounded-full px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          @click.stop="dismiss"
        >
          {{ COPY.breakKnow }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded-full bg-bamboo/15 px-2.5 py-1 text-xs text-bamboo transition-colors hover:bg-bamboo/25"
          @click.stop="onRelight"
        >
          {{ COPY.relight }}
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
