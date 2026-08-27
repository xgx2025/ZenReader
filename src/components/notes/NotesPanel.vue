<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import { COPY } from '@/lib/copy'
import type { Note } from '@/types/note'

const props = defineProps<{ notes: Note[]; activeId: string | null }>()
const emit = defineEmits<{ close: []; delete: [id: string]; select: [id: string] }>()

const listEl = ref<HTMLElement | null>(null)

watch(
  () => props.activeId,
  async (id) => {
    if (!id) return
    await nextTick()
    const el = listEl.value?.querySelector(`[data-note-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  },
)
</script>

<template>
  <aside class="flex h-full w-full flex-col">
    <header
      class="flex items-center justify-between border-b border-line px-4 py-3"
    >
      <h2 class="font-serif text-base text-ink">{{ COPY.notes }}</h2>
      <button class="text-ink-soft transition-colors hover:text-ink" @click="emit('close')">
        <ZIcon name="close" :size="16" />
      </button>
    </header>

    <div ref="listEl" class="flex-1 space-y-3 overflow-y-auto p-4">
      <p v-if="notes.length === 0" class="mt-8 text-center text-sm text-dusk">
        {{ COPY.emptyNotes }}
      </p>

      <article
        v-for="n in notes"
        :key="n.id"
        :data-note-id="n.id"
        class="cursor-pointer rounded-lg border border-line bg-paper-deep/50 p-3 transition-colors"
        :class="{ 'border-bamboo/60': activeId === n.id }"
        @click="emit('select', n.id)"
      >
        <blockquote class="border-l-2 border-sandal pl-2.5 text-sm text-ink-soft">
          {{ n.quote }}
        </blockquote>
        <p v-if="n.note" class="mt-2 text-sm leading-relaxed text-ink">
          {{ n.note }}
        </p>
        <button
          class="mt-2 inline-flex items-center gap-1 text-xs text-dusk transition-colors hover:text-sandal"
          @click.stop="emit('delete', n.id)"
        >
          {{ COPY.delete }}
        </button>
      </article>
    </div>
  </aside>
</template>
