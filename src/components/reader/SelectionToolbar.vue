<script setup lang="ts">
import { computed } from 'vue'

import { COPY } from '@/lib/copy'

const props = defineProps<{ rect: DOMRect | null; visible: boolean }>()
const emit = defineEmits<{ highlight: []; note: [] }>()

const TOOLBAR_WIDTH = 176

const style = computed(() => {
  if (!props.rect) return { left: '0px', top: '0px' }
  const x = Math.min(
    Math.max(props.rect.left + props.rect.width / 2 - TOOLBAR_WIDTH / 2, 8),
    window.innerWidth - TOOLBAR_WIDTH - 8,
  )
  const y = Math.max(props.rect.top - 46, 8)
  return { left: `${x}px`, top: `${y}px` }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible && rect"
        class="fixed z-50 flex items-center gap-1 rounded-full border border-line bg-paper-deep px-1.5 py-1 shadow-[0_8px_28px_rgba(0,0,0,0.12)]"
        :style="style"
      >
        <button
          class="rounded-full px-3 py-1 text-sm text-ink transition-colors hover:bg-bamboo/10 hover:text-bamboo"
          @mousedown.prevent
          @click="emit('highlight')"
        >
          {{ COPY.selectionHighlight }}
        </button>
        <span class="h-4 w-px bg-line" />
        <button
          class="rounded-full px-3 py-1 text-sm text-ink transition-colors hover:bg-bamboo/10 hover:text-bamboo"
          @mousedown.prevent
          @click="emit('note')"
        >
          {{ COPY.selectionNote }}
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
