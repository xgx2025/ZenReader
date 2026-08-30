<script setup lang="ts">
import { computed } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import { folderPathFromRelative, titleFromName } from '@/lib/vault'
import { COPY } from '@/lib/copy'
import { useProgressStore } from '@/stores/progress'
import { FINISHED_RATIO, RESUME_MIN_RATIO } from '@/types/progress'
import type { IndexedMeta } from '@/stores/library'
import type { VaultFile } from '@/types/document'

const props = withDefaults(
  defineProps<{
    file: VaultFile
    meta?: IndexedMeta
    index?: number
    /** 当前书库搜索词：全文命中时在卡片上展示上下文片段。 */
    query?: string
  }>(),
  { index: 0, query: '' },
)

const emit = defineEmits<{ menu: [file: VaultFile, x: number, y: number] }>()

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

/** 全文命中片段：展示「为什么搜到它」，回答标题与摘要之外的命中。 */
const hit = computed(() => {
  const q = props.query.trim().toLowerCase()
  const text = props.meta?.fullText
  if (!q || !text) return null
  const i = text.toLowerCase().indexOf(q)
  if (i === -1) return null
  const start = Math.max(0, i - 40)
  const end = Math.min(text.length, i + q.length + 40)
  return {
    lead: start > 0 ? '……' : '',
    before: text.slice(start, i),
    match: text.slice(i, i + q.length),
    after: text.slice(i + q.length, end),
    tail: end < text.length ? '……' : '',
  }
})

/** 入场 stagger：逐张上浮，长列表封顶不等待。 */
const riseDelay = computed(() => `${Math.min(props.index * 45, 360)}ms`)
</script>

<template>
  <div
    class="card-rise group relative flex"
    :style="{ animationDelay: riseDelay }"
    @contextmenu.prevent="emit('menu', file, $event.clientX, $event.clientY)"
  >
    <RouterLink
      :to="`/read/${encodeURIComponent(file.relativePath)}`"
      class="flex flex-1 flex-col rounded-2xl bg-paper-deep/40 p-5 transition-all duration-300 ease-zen hover:-translate-y-0.5 hover:bg-paper-deep/60 hover:shadow-zen-md"
    >
      <div class="flex items-start justify-between gap-2">
        <h3 class="min-h-[2lh] font-serif font-bold text-lg leading-snug text-ink line-clamp-2">
          {{ title }}
        </h3>
        <span
          v-if="finished"
          class="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-bamboo/10 px-2 py-0.5 text-[11px] text-bamboo"
        >
          <span class="h-1 w-1 rounded-full bg-bamboo"></span>
          {{ COPY.finished }}
        </span>
      </div>

      <!-- 全文命中片段优先于摘要，说明命中缘由 -->
      <p
        v-if="hit"
        class="mt-2 text-xs leading-relaxed text-dusk"
      >
        {{ hit.lead }}{{ hit.before }}<mark class="rounded-sm bg-bamboo/20 px-0.5 text-ink">{{ hit.match }}</mark>{{ hit.after }}{{ hit.tail }}
      </p>
      <p
        v-else-if="meta?.excerpt"
        class="mt-2 text-sm leading-relaxed text-ink-soft line-clamp-3"
      >
        {{ meta.excerpt }}
      </p>

      <!-- 底部信息：固定占位的进度条 + 元信息，统一贴底对齐 -->
      <div class="mt-auto pt-4">
        <div class="flex h-4 items-center gap-2">
          <template v-if="reading">
            <div class="h-0.5 flex-1 overflow-hidden rounded-full bg-line">
              <div
                class="h-full rounded-full bg-bamboo/60"
                :style="{ width: `${Math.round(reading.ratio * 100)}%` }"
              />
            </div>
            <span class="shrink-0 text-[11px] tabular-nums text-dusk">
              {{ COPY.readingProgress }} {{ Math.round(reading.ratio * 100) }}%
            </span>
          </template>
        </div>

        <div class="mt-3 flex items-center gap-3 text-[11px] text-dusk">
          <span v-if="folderPath" class="truncate">{{ folderPath }}</span>
          <template v-if="meta">
            <span>{{ meta.wordCount }} {{ COPY.words }}</span>
            <span>{{ meta.readingTime }} {{ COPY.minutes }}</span>
          </template>
          <span v-if="mtime" class="ml-auto shrink-0">{{ mtime }}</span>
        </div>
      </div>
    </RouterLink>

    <button
      class="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-ink-soft opacity-0 transition-opacity duration-200 hover:bg-bamboo/10 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      :title="COPY.moreActions"
      @click.prevent.stop="emit('menu', file, $event.clientX, $event.clientY)"
    >
      <ZIcon name="more" :size="16" />
    </button>
  </div>
</template>
