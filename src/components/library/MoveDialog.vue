<script setup lang="ts">
import ZIcon from '@/components/common/ZIcon.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { COPY } from '@/lib/copy'

defineProps<{ open: boolean; folders: string[]; currentPath: string }>()
const emit = defineEmits<{ select: [path: string]; close: [] }>()

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}
</script>

<template>
  <BaseDialog
    :open="open"
    :title="COPY.moveTo"
    max-width="xs"
    max-height="70vh"
    @close="emit('close')"
  >
    <nav class="space-y-0.5 p-2">
      <button
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
        :class="{ 'bg-bamboo/15 text-ink': currentPath === '' }"
        @click="emit('select', '')"
      >
        <ZIcon name="folder" :size="15" class="shrink-0 text-sandal" />
        {{ COPY.moveToRoot }}
      </button>

      <button
        v-for="f in folders"
        :key="f"
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
        :class="{ 'bg-bamboo/15 text-ink': currentPath === f }"
        @click="emit('select', f)"
      >
        <ZIcon name="folder" :size="15" class="shrink-0 text-sandal" />
        <span class="min-w-0 truncate">{{ baseName(f) }}</span>
        <span class="ml-auto truncate text-xs text-dusk">{{ f }}</span>
      </button>

      <p
        v-if="folders.length === 0"
        class="flex flex-col items-center py-6 text-xs text-dusk"
      >
        <span class="zen-breathe h-1.5 w-1.5 rounded-full bg-dusk/60"></span>
        <span class="mt-3">{{ COPY.emptyFolders }}</span>
      </p>
    </nav>
  </BaseDialog>
</template>
