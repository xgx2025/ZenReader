<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import { COPY } from '@/lib/copy'
import type { Note } from '@/types/note'

const props = defineProps<{ notes: Note[]; activeId: string | null }>()
const emit = defineEmits<{
  close: []
  delete: [id: string]
  select: [id: string]
  edit: [id: string]
  create: []
}>()

const listEl = ref<HTMLElement | null>(null)
const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.notes
  return props.notes.filter(
    (n) => n.quote.toLowerCase().includes(q) || n.note.toLowerCase().includes(q),
  )
})

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
    <header class="flex items-center justify-between border-b border-line px-4 py-3">
      <h2 class="font-serif text-base text-ink">{{ COPY.notes }}</h2>
      <div class="flex items-center gap-1">
        <button
          class="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          :title="COPY.newNote"
          @click="emit('create')"
        >
          <ZIcon name="plus" :size="16" />
        </button>
        <button
          class="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink"
          @click="emit('close')"
        >
          <ZIcon name="close" :size="16" />
        </button>
      </div>
    </header>

    <div class="border-b border-line px-4 py-2.5">
      <div class="flex items-center gap-2 rounded-lg border border-line bg-paper-deep px-3 py-1.5">
        <ZIcon name="search" :size="14" class="shrink-0 text-dusk" />
        <input
          v-model="query"
          :placeholder="COPY.noteSearchPlaceholder"
          class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-dusk"
        />
      </div>
    </div>

    <div ref="listEl" class="flex-1 space-y-3 overflow-y-auto p-4">
      <p v-if="notes.length === 0" class="mt-8 text-center text-sm text-dusk">
        {{ COPY.emptyNotes }}
      </p>
      <p v-else-if="filtered.length === 0" class="mt-8 text-center text-sm text-dusk">
        {{ COPY.emptySearch }}
      </p>

      <article
        v-for="n in filtered"
        :key="n.id"
        :data-note-id="n.id"
        class="cursor-pointer rounded-lg border border-line bg-paper-deep/50 p-3 transition-colors"
        :class="{ 'border-bamboo/60': activeId === n.id }"
        @click="emit('select', n.id)"
      >
        <blockquote
          v-if="n.quote"
          class="border-l-2 border-sandal pl-2.5 text-sm text-ink-soft"
        >
          {{ n.quote }}
        </blockquote>
        <span
          v-else
          class="inline-block rounded-full bg-bamboo/10 px-2 py-0.5 text-xs text-bamboo"
        >
          {{ COPY.freeNote }}
        </span>
        <p v-if="n.note" class="mt-2 text-sm leading-relaxed text-ink">
          {{ n.note }}
        </p>
        <div class="mt-2 flex items-center gap-3">
          <button
            class="inline-flex items-center gap-1 text-xs text-dusk transition-colors hover:text-bamboo"
            @click.stop="emit('edit', n.id)"
          >
            <ZIcon name="edit" :size="13" />
            {{ n.kind === 'highlight' ? COPY.selectionNote : COPY.editNote }}
          </button>
          <button
            class="inline-flex items-center gap-1 text-xs text-dusk transition-colors hover:text-sandal"
            @click.stop="emit('delete', n.id)"
          >
            <ZIcon name="delete" :size="13" />
            {{ COPY.delete }}
          </button>
        </div>
      </article>
    </div>
  </aside>
</template>
