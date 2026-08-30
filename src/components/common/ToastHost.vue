<script setup lang="ts">
import { useToast, type ToastTone } from '@/composables/useToast'

const { toasts } = useToast()

const TONE: Record<ToastTone, { dot: string; text: string }> = {
  bamboo: { dot: 'bg-bamboo', text: 'text-ink-soft' },
  sandal: { dot: 'bg-sandal', text: 'text-sandal' },
  dusk: { dot: 'bg-dusk', text: 'text-ink-soft' },
}
</script>

<template>
  <Teleport to="body">
    <!-- z-[60]：高于模态（z-50），弹窗内的保存失败亦可见。 -->
    <div
      class="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      <TransitionGroup name="fade-slide">
        <p
          v-for="t in toasts"
          :key="t.id"
          class="flex items-center gap-1.5 rounded-full border border-line bg-paper/90 px-3.5 py-1.5 text-xs shadow-zen-sm backdrop-blur-sm"
          :class="TONE[t.tone].text"
        >
          <span class="h-1 w-1 rounded-full" :class="TONE[t.tone].dot" />
          {{ t.message }}
        </p>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
