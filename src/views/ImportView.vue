<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useDropZone } from '@vueuse/core'

import ZIcon from '@/components/common/ZIcon.vue'

import { useFileImport } from '@/composables/useFileImport'
import { useNativeDragDrop } from '@/composables/useNativeDragDrop'
import { useLibraryStore } from '@/stores/library'
import { useToast } from '@/composables/useToast'
import { COPY } from '@/lib/copy'
import type { ImportResult } from '@/types/import'

const { items, importing, importFiles, importPaths } = useFileImport()
const library = useLibraryStore()
const { notify } = useToast()

const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const result = ref<ImportResult | null>(null)
const resultEl = ref<HTMLElement | null>(null)
/** Destination 分组 within the vault; empty string = root. */
const targetFolder = ref('')

const dropzoneEl = ref<HTMLElement | null>(null)
const { isOverDropZone } = useDropZone(dropzoneEl, {
  onDrop: (files) => {
    if (files?.length) run(files)
  },
})

// 桌面端：Tauri 拦截了 HTML5 drop，须走原生通道收绝对路径。
const { dragging: nativeDragging } = useNativeDragDrop((paths) => {
  if (!library.hasVault) {
    notify(COPY.vaultNotOpen, 'sandal')
    return
  }
  start(() => importPaths(paths, targetFolder.value))
})

function run(files: File[]) {
  start(() => importFiles(files, targetFolder.value))
}

/**
 * 藏卷毕：结果卡入视野，并轻唤一声去向，不让用户猜。
 * 收工厂函数而非 promise--导入函数的同步前缀会先置 importing，
 * 传 promise 会让守卫误判「正在导入」而整段跳过。
 */
async function start(run: () => Promise<ImportResult>) {
  if (importing.value) return
  result.value = null
  const r = await run()
  result.value = r

  await nextTick()
  resultEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

  const parts: string[] = []
  if (r.imported) parts.push(`${COPY.importDone} ${r.imported}`)
  if (r.skipped) parts.push(`${COPY.importSkipped} ${r.skipped}`)
  if (r.errors.length) parts.push(`${COPY.importError} ${r.errors.length}`)
  if (!parts.length) return
  notify(parts.join(' · '), r.imported && !r.errors.length ? 'bamboo' : 'sandal')
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
  pending: COPY.importPending,
  reading: COPY.importReading,
  parsing: COPY.importParsing,
  saving: COPY.importSaving,
  done: COPY.importStored,
  skipped: COPY.importSkipped,
  error: COPY.importError,
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
  <div class="min-h-screen text-ink">
    <header
      class="header-fade relative flex items-center gap-3 bg-paper/55 px-6 py-4 backdrop-blur-md"
    >
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
        class="flex flex-col items-center justify-center rounded-2xl bg-paper-deep/40 py-16 text-center shadow-zen-sm"
      >
        <ZIcon name="folder" :size="32" :stroke-width="1" class="text-sandal" />
        <p class="mt-4 text-sm text-ink-soft">{{ COPY.vaultNotOpen }}</p>
        <button
          class="mt-4 inline-flex items-center gap-2 rounded-full bg-bamboo px-5 py-2 text-sm text-paper transition-opacity hover:opacity-90"
          @click="library.openVault()"
        >
          <ZIcon name="folder" :size="15" />
          {{ COPY.openVault }}
        </button>
      </div>

      <template v-else>
        <!-- 目标分组：自绘下拉，原生 select 不再突兀 -->
        <div class="mb-4 flex items-center gap-3 rounded-xl bg-paper-deep/40 px-4 py-3">
          <ZIcon name="folder" :size="16" class="shrink-0 text-sandal" />
          <label class="shrink-0 text-sm text-ink-soft">{{ COPY.importTo }}</label>
          <div class="relative min-w-0 flex-1">
            <select
              v-model="targetFolder"
              class="w-full cursor-pointer appearance-none rounded-full bg-paper py-1.5 pl-4 pr-9 text-sm text-ink outline-none transition-colors focus:bg-paper-deep"
            >
              <option value="">{{ COPY.moveToRoot }}</option>
              <option v-for="f in library.flatFolders" :key="f" :value="f">
                {{ f }}
              </option>
            </select>
            <span
              class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dusk"
            >
              <ZIcon name="chevron-down" :size="15" />
            </span>
          </div>
        </div>

        <div
          ref="dropzoneEl"
          class="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center transition-colors duration-300"
          :class="
            isOverDropZone || nativeDragging
              ? 'border-bamboo bg-bamboo/10'
              : 'border-line/70 bg-paper-deep/40 hover:border-bamboo/50'
          "
          @click="!importing && fileInput?.click()"
        >
          <ZIcon name="import" :size="28" :stroke-width="1" class="text-sandal" />
          <p class="mt-4 text-sm text-ink-soft">
            {{ importing ? COPY.importReading : COPY.importDropHint }}
          </p>
          <p v-if="!importing" class="mt-1 text-xs text-dusk">.md</p>
        </div>

        <div class="mt-4 flex flex-wrap gap-3">
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-full bg-paper-deep/60 px-4 py-2.5 text-sm text-ink shadow-zen-sm transition-colors hover:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="importing"
            @click="fileInput?.click()"
          >
            <ZIcon name="import" :size="16" />
            {{ COPY.importFileAction }}
          </button>
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-full bg-paper-deep/60 px-4 py-2.5 text-sm text-ink shadow-zen-sm transition-colors hover:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="importing"
            @click="folderInput?.click()"
          >
            <ZIcon name="folder" :size="16" />
            {{ COPY.importFolderAction }}
          </button>
        </div>

        <input
          ref="fileInput"
          type="file"
          accept=".md,text/markdown"
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
            class="flex items-center justify-between rounded-lg bg-paper-deep/40 px-3 py-2 text-sm"
          >
            <span class="min-w-0 truncate text-ink">
              <span v-if="item.folderPath" class="text-dusk">
                {{ item.folderPath }}/
              </span>
              {{ item.fileName }}
            </span>
            <span class="shrink-0 text-xs" :class="STATUS_CLASS[item.status]">
              {{ item.error ?? item.reason ?? STATUS_LABEL[item.status] }}
            </span>
          </li>
        </ul>

        <div
          v-if="result"
          ref="resultEl"
          class="mt-6 rounded-xl bg-paper-deep/40 p-5 text-center shadow-zen-sm"
        >
          <p class="font-serif text-lg text-ink">
            {{ COPY.importDone }} {{ result.imported }} · {{ COPY.importSkipped }}
            {{ result.skipped }}<template v-if="result.errors.length">
              · {{ COPY.importError }} {{ result.errors.length }}</template
            >
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
              class="rounded-full px-5 py-2 text-sm text-ink-soft transition-colors hover:text-ink"
              @click="result = null"
            >
              {{ COPY.continueImport }}
            </button>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
