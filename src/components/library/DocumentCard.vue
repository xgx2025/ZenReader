<script setup lang="ts">
import type { Document } from '@/types/document'

defineProps<{ doc: Document }>()
</script>

<template>
  <RouterLink
    :to="`/read/${doc.id}`"
    class="group block rounded-lg border border-line bg-paper-deep/50 p-5 transition-all duration-300 ease-zen hover:-translate-y-0.5 hover:border-bamboo/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)]"
  >
    <h3 class="font-serif text-lg leading-snug text-ink line-clamp-2">
      {{ doc.title }}
    </h3>

    <p
      v-if="doc.excerpt"
      class="mt-2 text-sm leading-relaxed text-ink-soft line-clamp-3"
    >
      {{ doc.excerpt }}
    </p>

    <div class="mt-4 flex items-center gap-3 text-xs text-ink-soft">
      <span v-if="doc.folderPath" class="truncate text-sandal">
        {{ doc.folderPath }}
      </span>
      <span>{{ doc.wordCount }} 字</span>
      <span>{{ doc.readingTime }} 分</span>
    </div>
  </RouterLink>
</template>
