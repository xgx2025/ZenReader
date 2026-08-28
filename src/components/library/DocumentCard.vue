<script setup lang="ts">
import { computed } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import { folderPathFromRelative, titleFromName } from '@/lib/vault'
import { COPY } from '@/lib/copy'
import { useProgressStore } from '@/stores/progress'
import { FINISHED_RATIO, RESUME_MIN_RATIO } from '@/types/progress'
import type { IndexedMeta } from '@/stores/library'
import type { VaultFile } from '@/types/document'

const props = defineProps<{ file: VaultFile; meta?: IndexedMeta }>()

const progressStore = useProgressStore()

const title = computed(() => props.meta?.title ?? titleFromName(props.file.name))
const folderPath = computed(() => folderPathFromRelative(props.file.relativePath))
const mtime = computed(() => {
  const d = new Date(props.file.mtime)
  return d.getTime() ? d.toLocaleDateString('zh-CN') : ''
})

/** 在读 progress for this card, null when untouched or finished. */
const reading = computed(() => {
  const e = progressStore.get(props.file.relativePath)
  if (!e || e.ratio < RESUME_MIN_RATIO || e.ratio >= FINISHED_RATIO) return null
  return e
})
const finished = computed(() => {
  const e = progressStore.get(props.file.relativePath)
  return !!e && e.ratio >= FINISHED_RATIO
})
</script>

<template>
  <RouterLink
    :to="`/read/${encodeURIComponent(file.relativePath)}`"
    class="group block rounded-lg border border-line bg-paper-deep/50 p-5 transition-all duration-300 ease-zen hover:-translate-y-0.5 hover:border-bamboo/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)]"
    :class="{ 'border-bamboo/30': reading }"
  >
    <div class="flex items-start justify-between gap-2">
      <h3 class="font-serif text-lg leading-snug text-ink line-clamp-2">
        {{ title }}
      </h3>
      <span
        v-if="finished"
        class="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-bamboo/10 px-2 py-0.5 text-[11px] text-bamboo"
      >
        <ZIcon name="bookmark" :size="11" />
        {{ COPY.finished }}
      </span>
    </div>

    <p
      v-if="meta?.excerpt"
      class="mt-2 text-sm leading-relaxed text-ink-soft line-clamp-3"
    >
      {{ meta.excerpt }}
    </p>

    <!-- 在读 progress -->
    <div v-if="reading" class="mt-3 flex items-center gap-2">
      <div class="h-0.5 flex-1 overflow-hidden rounded-full bg-line">
        <div
          class="h-full rounded-full bg-bamboo/70"
          :style="{ width: `${Math.round(reading.ratio * 100)}%` }"
        />
      </div>
      <span class="shrink-0 text-[11px] tabular-nums text-bamboo">
        {{ COPY.readingProgress }} {{ Math.round(reading.ratio * 100) }}%
      </span>
    </div>

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
