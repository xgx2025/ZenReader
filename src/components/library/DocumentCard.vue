<script setup lang="ts">
import { computed } from 'vue'

import { folderPathFromRelative, titleFromName } from '@/lib/vault'
import type { IndexedMeta } from '@/stores/library'
import type { VaultFile } from '@/types/document'

const props = defineProps<{ file: VaultFile; meta?: IndexedMeta }>()

const title = computed(() => props.meta?.title ?? titleFromName(props.file.name))
const folderPath = computed(() => folderPathFromRelative(props.file.relativePath))
const mtime = computed(() => {
  const d = new Date(props.file.mtime)
  return d.getTime() ? d.toLocaleDateString('zh-CN') : ''
})
</script>

<template>
  <RouterLink
    :to="`/read/${encodeURIComponent(file.relativePath)}`"
    class="group block rounded-lg border border-line bg-paper-deep/50 p-5 transition-all duration-300 ease-zen hover:-translate-y-0.5 hover:border-bamboo/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)]"
  >
    <h3 class="font-serif text-lg leading-snug text-ink line-clamp-2">
      {{ title }}
    </h3>

    <p
      v-if="meta?.excerpt"
      class="mt-2 text-sm leading-relaxed text-ink-soft line-clamp-3"
    >
      {{ meta.excerpt }}
    </p>

    <div class="mt-4 flex items-center gap-3 text-xs text-ink-soft">
      <span v-if="folderPath" class="truncate text-sandal">{{ folderPath }}</span>
      <template v-if="meta">
        <span>{{ meta.wordCount }} 字</span>
        <span>{{ meta.readingTime }} 分</span>
      </template>
      <span v-if="mtime" class="ml-auto shrink-0 text-dusk">{{ mtime }}</span>
    </div>
  </RouterLink>
</template>
