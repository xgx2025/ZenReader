<script setup lang="ts">
import { ref } from 'vue'
import { useDropZone } from '@vueuse/core'

import ZIcon from '@/components/common/ZIcon.vue'

import { useFileImport } from '@/composables/useFileImport'
import { useLibraryStore } from '@/stores/library'
import { COPY } from '@/lib/copy'
import type { ImportResult } from '@/types/import'

const { items, importing, importFiles } = useFileImport()
const library = useLibraryStore()

const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const result = ref<ImportResult | null>(null)

const dropzoneEl = ref<HTMLElement | null>(null)
const { isOverDropZone } = useDropZone(dropzoneEl, {
  onDrop: (files) => {
    if (files?.length) run(files)
  },
})

function run(files: File[]) {
  result.value = null
  importFiles(files).then((r) => {
    result.value = r
  })
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  if (files.length) run(files)
  input.value = ''
}

function onFolderChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  if (files.length) run(files)
  input.value = ''
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待引',
  reading: '读卷中',
  parsing: '解卷中',
  saving: '藏卷中',
  done: '已藏',
  skipped: '已略过',
  error: '有误',
}

const STATUS_CLASS: Record<string, string> = {
  pending: 'text-dusk',
  reading: 'text-dusk',
  parsing: 'text-dusk',
  saving: 'text-dusk',
  done: 'text-bamboo',
  skipped: 'text-sandal',
  error: 'text-sandal',
}
</script>

<template>
  <div class="min-h-screen bg-paper text-ink">
    <header class="flex items-center gap-3 border-b border-line px-6 py-4">
      <button
        class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
        @click="$router.push('/')"
      >
        <ZIcon name="back" :size="18" />
      </button>
      <div>
        <h1 class="font-serif text-lg">{{ COPY.import }}</h1>
        <p class="text-xs text-dusk">{{ COPY.importDropHint }}</p>
      </div>
    </header>

    <main class="mx-auto max-w-2xl p-6">
      <div
        v-if="!library.hasVault"
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-paper-deep/40 py-16 text-center"
      >
        <ZIcon name="folder" :size="32" :stroke-width="1" class="text-sandal" />
        <p class="mt-4 text-sm text-ink-soft">请先打开书库，方能引卷入藏</p>
        <button
          class="mt-4 inline-flex items-center gap-2 rounded-full bg-bamboo px-5 py-2 text-sm text-paper transition-opacity hover:opacity-90"
          @click="library.openVault()"
        >
          <ZIcon name="folder" :size="15" />
          {{ COPY.openVault }}
        </button>
      </div>

      <template v-else>
        <div
          ref="dropzoneEl"
          class="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center transition-colors duration-300"
          :class="
            isOverDropZone
              ? 'border-bamboo bg-bamboo/10'
              : 'border-line bg-paper-deep/40'
          "
          @click="fileInput?.click()"
        >
          <ZIcon name="import" :size="28" :stroke-width="1" class="text-sandal" />
          <p class="mt-4 text-sm text-ink-soft">{{ COPY.importDropHint }}</p>
          <p class="mt-1 text-xs text-dusk">.md / .markdown</p>
        </div>

        <div class="mt-4 flex flex-wrap gap-3">
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-full border border-line bg-paper-deep/60 px-4 py-2.5 text-sm text-ink transition-colors hover:border-bamboo"
            @click="fileInput?.click()"
          >
            <ZIcon name="import" :size="16" />
            {{ COPY.importFileAction }}
          </button>
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-full border border-line bg-paper-deep/60 px-4 py-2.5 text-sm text-ink transition-colors hover:border-bamboo"
            @click="folderInput?.click()"
          >
            <ZIcon name="folder" :size="16" />
            {{ COPY.importFolderAction }}
          </button>
        </div>

        <input
          ref="fileInput"
          type="file"
          accept=".md,.markdown,text/markdown"
          multiple
          class="hidden"
          @change="onFileChange"
        />
        <input
          ref="folderInput"
          type="file"
          webkitdirectory
          multiple
          class="hidden"
          @change="onFolderChange"
        />

        <ul v-if="items.length" class="mt-6 space-y-1.5">
          <li
            v-for="(item, i) in items"
            :key="i"
            class="flex items-center justify-between rounded-lg border border-line bg-paper-deep/40 px-3 py-2 text-sm"
          >
            <span class="min-w-0 truncate text-ink">
              <span v-if="item.folderPath" class="text-dusk">
                {{ item.folderPath }}/
              </span>
              {{ item.fileName }}
            </span>
            <span class="shrink-0 text-xs" :class="STATUS_CLASS[item.status]">
              {{ item.error ?? STATUS_LABEL[item.status] }}
            </span>
          </li>
        </ul>

        <div
          v-if="result"
          class="mt-6 rounded-xl border border-line bg-paper-deep/40 p-5 text-center"
        >
          <p class="font-serif text-lg text-ink">
            {{ COPY.importDone }} {{ result.imported }} · {{ COPY.importSkipped }}
            {{ result.skipped }}
          </p>

          <div class="mt-4 flex flex-wrap justify-center gap-3">
            <RouterLink
              to="/"
              class="rounded-full bg-bamboo px-5 py-2 text-sm text-paper transition-opacity hover:opacity-90"
            >
              {{ COPY.library }}
            </RouterLink>

            <button
              v-if="!importing"
              class="rounded-full border border-line px-5 py-2 text-sm text-ink-soft transition-colors hover:text-ink"
              @click="result = null"
            >
              继续引卷
            </button>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
