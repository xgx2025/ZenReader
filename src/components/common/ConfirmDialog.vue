<script setup lang="ts">
import ZIcon from '@/components/common/ZIcon.vue'
import { COPY } from '@/lib/copy'

defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel: string
}>()
const emit = defineEmits<{ confirm: []; close: [] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4"
        @click.self="emit('close')"
      >
        <div
          class="w-full max-w-xs rounded-xl border border-line bg-paper p-5 shadow-[0_16px_48px_rgba(0,0,0,0.16)]"
        >
          <div class="flex items-start gap-3">
            <ZIcon
              name="delete"
              :size="18"
              class="mt-0.5 shrink-0 text-sandal"
            />
            <div class="min-w-0">
              <h2 class="font-serif text-base text-ink">{{ title }}</h2>
              <p class="mt-1.5 text-sm leading-relaxed text-ink-soft">
                {{ message }}
              </p>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button
              class="rounded-full border border-line px-4 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
              @click="emit('close')"
            >
              {{ COPY.cancel }}
            </button>
            <button
              class="rounded-full bg-sandal px-4 py-1.5 text-sm text-paper transition-opacity hover:opacity-90"
              @click="emit('confirm')"
            >
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
