<script setup lang="ts">
import ZIcon from '@/components/common/ZIcon.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
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
  <BaseDialog :open="open" max-width="xs" :aria-label="title" @close="emit('close')">
    <div class="p-5">
      <div class="flex items-start gap-3">
        <ZIcon name="delete" :size="18" class="mt-0.5 shrink-0 text-sandal" />
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
  </BaseDialog>
</template>
