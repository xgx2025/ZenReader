<script setup lang="ts">
import BaseDialog from '@/components/common/BaseDialog.vue'
import { COPY } from '@/lib/copy'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

/** 键径：阅读页全部快捷键，一目了然。 */
const ROWS: { keys: string[]; label: string }[] = [
  { keys: ['J', 'K'], label: `${COPY.shortcutDown} · ${COPY.shortcutUp}` },
  { keys: ['空格'], label: COPY.shortcutSpace },
  { keys: ['←', '→'], label: `${COPY.shortcutPrevChapter} · ${COPY.shortcutNextChapter}` },
  { keys: ['Home', 'End'], label: COPY.shortcutTopBottom },
  { keys: ['T'], label: COPY.shortcutToc },
  { keys: ['N'], label: COPY.shortcutNotes },
  { keys: ['Z'], label: COPY.shortcutZen },
  { keys: ['Esc'], label: COPY.shortcutEsc },
  { keys: ['F11'], label: COPY.shortcutFullscreen },
  { keys: ['?'], label: COPY.shortcutSheetKey },
]
</script>

<template>
  <BaseDialog
    :open="open"
    :title="COPY.shortcutSheet"
    max-width="sm"
    @close="emit('close')"
  >
    <div class="space-y-2.5 px-5 py-4">
      <div
        v-for="row in ROWS"
        :key="row.label"
        class="flex items-center justify-between gap-4"
      >
        <div class="flex shrink-0 gap-1">
          <kbd
            v-for="k in row.keys"
            :key="k"
            class="min-w-7 rounded-md border border-line bg-paper-deep/60 px-1.5 py-0.5 text-center font-mono text-[11px] text-ink-soft"
          >
            {{ k }}
          </kbd>
        </div>
        <span class="text-right text-xs text-ink-soft">{{ row.label }}</span>
      </div>
    </div>
  </BaseDialog>
</template>
