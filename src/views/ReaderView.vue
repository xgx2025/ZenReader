<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ZIcon from '@/components/common/ZIcon.vue'
import SelectionToolbar from '@/components/reader/SelectionToolbar.vue'
import InsightComposer from '@/components/notes/InsightComposer.vue'
import NotesPanel from '@/components/notes/NotesPanel.vue'

import { applyAnchors, type AppliedAnchor } from '@/lib/anchor/textAnchor'
import { highlightCodeBlocks } from '@/lib/markdown/highlight'
import { extractStructure } from '@/lib/markdown/structure'
import { useSelectionAnchor } from '@/composables/useSelectionAnchor'
import { useReaderStore } from '@/stores/reader'
import { useNotesStore } from '@/stores/notes'
import { useSettingsStore } from '@/stores/settings'
import { COPY } from '@/lib/copy'
import type { HighlightAnchor, Note } from '@/types/note'
import type { ThemeName } from '@/types/settings'

const route = useRoute()
const router = useRouter()
const reader = useReaderStore()
const notesStore = useNotesStore()
const settings = useSettingsStore()

const proseEl = ref<HTMLElement | null>(null)
const { capture, visible, dismiss } = useSelectionAnchor(proseEl)

const showToc = ref(false)
const showNotes = ref(false)
const activeNoteId = ref<string | null>(null)

const composerOpen = ref(false)
const composerQuote = ref('')
const composerAnchor = ref<HighlightAnchor | null>(null)

const doc = computed(() => reader.current)
const structure = computed(() =>
  doc.value ? extractStructure(doc.value.html) : { toc: [], hasCodeBlocks: false },
)
const toc = computed(() => structure.value.toc)
const anchors = computed<AppliedAnchor[]>(() =>
  notesStore.notes.map((n) => ({ noteId: n.id, anchor: n.anchor })),
)

const THEME_CYCLE: ThemeName[] = ['light', 'sepia', 'dark']

function renderProse() {
  const el = proseEl.value
  if (!el || !doc.value) return
  el.innerHTML = doc.value.html
  applyAnchors(el, anchors.value)
  highlightCodeBlocks(el, settings.theme)
}

async function loadDocument() {
  const id = route.params.id as string
  const loaded = await reader.open(id)
  if (!loaded) {
    router.replace('/')
    return
  }
  await notesStore.load(id)
  await nextTick()
  renderProse()
}

function makeNote(anchor: HighlightAnchor, note: string, kind: Note['kind']): Note {
  const ts = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    documentId: doc.value!.id,
    kind,
    quote: anchor.quote,
    note,
    // Spread strips the Vue reactive Proxy — IndexedDB's structured clone
    // rejects Proxy objects (DataCloneError).
    anchor: { ...anchor },
    createdAt: ts,
    updatedAt: ts,
  }
}

async function onHighlight() {
  const cap = capture.value
  if (!cap) return
  await notesStore.add(makeNote(cap.anchor, '', 'highlight'))
  dismiss()
  renderProse()
}

function onOpenComposer() {
  const cap = capture.value
  if (!cap) return
  composerQuote.value = cap.anchor.quote
  composerAnchor.value = cap.anchor
  composerOpen.value = true
  dismiss()
}

async function onSaveNote(text: string) {
  if (!composerAnchor.value) return
  await notesStore.add(makeNote(composerAnchor.value, text, 'note'))
  composerOpen.value = false
  composerAnchor.value = null
  renderProse()
}

async function onDeleteNote(id: string) {
  await notesStore.remove(id)
  renderProse()
}

function onProseClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const mark = target.closest('mark.hl')
  if (!mark) return
  const id = mark.getAttribute('data-note-id')
  if (!id) return
  activeNoteId.value = id
  showNotes.value = true
}

function cycleTheme() {
  const i = THEME_CYCLE.indexOf(settings.theme)
  settings.setTheme(THEME_CYCLE[(i + 1) % THEME_CYCLE.length])
}

function bumpFont(delta: number) {
  const next = Math.min(28, Math.max(13, settings.fontSize + delta))
  settings.update({ fontSize: next })
}

function toggleFontFamily() {
  settings.update({
    fontFamily: settings.fontFamily === 'serif' ? 'sans' : 'serif',
  })
}

function scrollToHeading(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

watch(
  () => settings.theme,
  () => {
    if (proseEl.value && doc.value) {
      highlightCodeBlocks(proseEl.value, settings.theme)
    }
  },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (composerOpen.value) {
    composerOpen.value = false
  } else if (settings.zenMode) {
    settings.setZenMode(false)
  } else if (showNotes.value) {
    showNotes.value = false
  } else if (showToc.value) {
    showToc.value = false
  }
}

onMounted(() => {
  loadDocument()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

watch(() => route.params.id, loadDocument)
</script>

<template>
  <div class="flex h-screen flex-col bg-paper text-ink">
    <!-- Top toolbar (hidden in 禅境) -->
    <header
      v-if="!settings.zenMode"
      class="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5"
    >
      <div class="flex min-w-0 items-center gap-1">
        <button
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          @click="router.push('/')"
        >
          <ZIcon name="back" :size="18" />
        </button>
        <span class="truncate font-serif text-base text-ink">
          {{ doc?.title }}
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <button
          class="flex h-9 items-center justify-center rounded-full px-2.5 text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          :title="COPY.toc"
          @click="showToc = !showToc"
        >
          <ZIcon name="toc" :size="17" />
        </button>

        <span class="mx-1 h-5 w-px bg-line" />

        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          @click="bumpFont(-1)"
        >
          <ZIcon name="minus" :size="15" />
        </button>
        <span class="w-6 text-center text-xs text-dusk">{{ settings.fontSize }}</span>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          @click="bumpFont(1)"
        >
          <ZIcon name="plus" :size="15" />
        </button>

        <span class="mx-1 h-5 w-px bg-line" />

        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          :title="COPY.settings"
          @click="cycleTheme"
        >
          <ZIcon :name="settings.theme === 'dark' ? 'moon' : 'sun'" :size="17" />
        </button>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          :class="{ 'text-bamboo': settings.fontFamily === 'sans' }"
          title="字体"
          @click="toggleFontFamily"
        >
          <span class="font-serif text-sm">字</span>
        </button>

        <span class="mx-1 h-5 w-px bg-line" />

        <button
          class="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          :title="COPY.notes"
          @click="showNotes = !showNotes"
        >
          <ZIcon name="note" :size="16" />
          <span v-if="notesStore.notes.length" class="text-xs text-sandal">
            {{ notesStore.notes.length }}
          </span>
        </button>

        <button
          class="flex h-9 items-center gap-1.5 rounded-full bg-bamboo/15 px-3 text-sm text-bamboo transition-colors hover:bg-bamboo/25"
          :title="COPY.zenMode"
          @click="settings.setZenMode(!settings.zenMode)"
        >
          <ZIcon name="zen" :size="16" />
          {{ COPY.zenMode }}
        </button>
      </div>
    </header>

    <div class="relative flex min-h-0 flex-1">
      <!-- TOC sidebar -->
      <Transition name="fade-slide">
        <aside
          v-if="showToc && !settings.zenMode"
          class="flex w-64 shrink-0 flex-col overflow-hidden border-r border-line"
        >
          <div class="border-b border-line px-4 py-3">
            <h2 class="font-serif text-base">{{ COPY.toc }}</h2>
          </div>
          <nav class="flex-1 space-y-0.5 overflow-y-auto p-3">
            <p v-if="toc.length === 0" class="px-2 text-sm text-dusk">无</p>
            <a
              v-for="item in toc"
              :key="item.id"
              :href="`#${item.id}`"
              class="block truncate rounded-md px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
              :style="{ paddingLeft: `${(item.level - 1) * 12 + 10}px` }"
              @click.prevent="scrollToHeading(item.id)"
            >
              {{ item.text }}
            </a>
          </nav>
        </aside>
      </Transition>

      <!-- Reading surface -->
      <div class="min-w-0 flex-1 overflow-y-auto">
        <div
          class="px-6 py-10 md:px-12"
          :class="{ 'py-16': settings.zenMode }"
        >
          <article
            ref="proseEl"
            class="zen-prose"
            @click="onProseClick"
          ></article>
        </div>
      </div>

      <!-- Notes panel -->
      <Transition name="fade-slide">
        <aside
          v-if="showNotes && !settings.zenMode"
          class="w-80 shrink-0 border-l border-line"
        >
          <NotesPanel
            :notes="notesStore.notes"
            :active-id="activeNoteId"
            @close="showNotes = false"
            @select="activeNoteId = $event"
            @delete="onDeleteNote"
          />
        </aside>
      </Transition>
    </div>

    <!-- 禅境 exit hint -->
    <Transition name="fade">
      <p
        v-if="settings.zenMode"
        class="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 text-xs text-dusk"
      >
        按 Esc 返回
      </p>
    </Transition>

    <SelectionToolbar
      :rect="capture?.rect ?? null"
      :visible="visible"
      @highlight="onHighlight"
      @note="onOpenComposer"
    />

    <InsightComposer
      :open="composerOpen"
      :quote="composerQuote"
      @save="onSaveNote"
      @cancel="composerOpen = false"
    />
  </div>
</template>
