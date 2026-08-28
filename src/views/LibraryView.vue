<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import DocumentCard from '@/components/library/DocumentCard.vue'
import FolderTree from '@/components/library/FolderTree.vue'

import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import { COPY } from '@/lib/copy'
import type { ThemeName } from '@/types/settings'

const library = useLibraryStore()
const settings = useSettingsStore()
const { openPanel } = useSettingsPanel()

const THEME_CYCLE: ThemeName[] = ['light', 'sepia', 'dark']

function cycleTheme() {
  const i = THEME_CYCLE.indexOf(settings.theme)
  settings.setTheme(THEME_CYCLE[(i + 1) % THEME_CYCLE.length])
}

const SORTS = [
  { key: 'modified', label: '最近修改' },
  { key: 'title', label: '标题' },
] as const

function toggleFolder(path: string) {
  library.selectedFolder = library.selectedFolder === path ? '' : path
}

const creating = ref(false)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement | null>(null)

function startCreating() {
  creating.value = true
  newFolderName.value = ''
  nextTick(() => newFolderInput.value?.focus())
}

function cancelCreating() {
  creating.value = false
  newFolderName.value = ''
}

function canCreate() {
  const n = newFolderName.value.trim()
  return n.length > 0 && !n.includes('/') && !n.includes('\\')
}

async function submitFolder() {
  if (!canCreate()) return
  await library.createFolder(newFolderName.value.trim())
  cancelCreating()
}

function onWindowFocus() {
  library.refresh()
}

onMounted(() => {
  library.refresh()
  window.addEventListener('focus', onWindowFocus)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus)
})
</script>

<template>
  <div class="min-h-screen bg-paper text-ink">
    <header
      class="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper/80 px-6 py-4 backdrop-blur"
    >
      <div>
        <h1 class="font-serif text-xl leading-tight">{{ COPY.appName }}</h1>
        <p class="text-xs text-dusk">{{ COPY.tagline }}</p>
      </div>

      <div class="flex items-center gap-1.5">
        <button
          v-if="library.hasVault"
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          :title="COPY.refresh"
          @click="library.refresh()"
        >
          <ZIcon name="refresh" :size="17" />
        </button>

        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          title="主题"
          @click="cycleTheme"
        >
          <ZIcon :name="settings.theme === 'dark' ? 'moon' : 'sun'" :size="17" />
        </button>

        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          :title="COPY.settings"
          @click="openPanel"
        >
          <ZIcon name="settings" :size="18" />
        </button>

        <RouterLink
          to="/import"
          class="flex items-center gap-2 rounded-full bg-bamboo px-4 py-1.5 text-sm text-paper transition-opacity hover:opacity-90"
        >
          <ZIcon name="import" :size="16" />
          {{ COPY.import }}
        </RouterLink>
      </div>
    </header>

    <!-- 未打开书库 -->
    <div
      v-if="!library.hasVault"
      class="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center"
    >
      <ZIcon name="folder" :size="40" :stroke-width="1" class="text-sandal" />
      <h2 class="mt-5 font-serif text-2xl text-ink">{{ COPY.appName }}</h2>
      <p class="mt-2 text-sm text-dusk">{{ COPY.tagline }}</p>
      <button
        class="mt-6 inline-flex items-center gap-2 rounded-full bg-bamboo px-6 py-2.5 text-sm text-paper transition-opacity hover:opacity-90"
        @click="library.openVault()"
      >
        <ZIcon name="folder" :size="16" />
        {{ COPY.openVault }}
      </button>
    </div>

    <div v-else class="flex">
      <aside
        class="hidden w-56 shrink-0 border-r border-line p-4 md:block"
      >
        <button
          class="mb-2 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-bamboo/10"
          :class="{ 'bg-bamboo/15 text-ink': !library.selectedFolder }"
          @click="library.selectedFolder = ''"
        >
          <span>{{ COPY.library }}</span>
          <span class="text-xs text-dusk">{{ library.totalCount }}</span>
        </button>

        <div class="mb-2">
          <button
            v-if="!creating"
            class="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
            @click="startCreating"
          >
            <ZIcon name="plus" :size="14" />
            {{ COPY.newFolder }}
          </button>
          <div v-else class="flex flex-col gap-1.5">
            <input
              ref="newFolderInput"
              v-model="newFolderName"
              :placeholder="COPY.folderName"
              class="w-full rounded-md border border-line bg-paper-deep/60 px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-dusk focus:border-bamboo"
              @keydown.enter="submitFolder"
              @keydown.esc="cancelCreating"
            />
            <div class="flex gap-1">
              <button
                class="flex-1 rounded-md bg-bamboo px-2 py-1 text-xs text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                :disabled="!canCreate()"
                @click="submitFolder"
              >
                {{ COPY.save }}
              </button>
              <button
                class="flex-1 rounded-md px-2 py-1 text-xs text-ink-soft transition-colors hover:text-ink"
                @click="cancelCreating"
              >
                {{ COPY.cancel }}
              </button>
            </div>
          </div>
        </div>

        <FolderTree
          v-if="library.folderTree.length"
          :nodes="library.folderTree"
          :selected="library.selectedFolder"
          @select="toggleFolder"
        />
        <p v-else class="px-2.5 text-xs text-dusk">暂无分组</p>
      </aside>

      <main class="min-w-0 flex-1 p-6">
        <div class="mb-6 flex flex-wrap items-center gap-3">
          <div class="relative min-w-0 max-w-md flex-1">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dusk">
              <ZIcon name="search" :size="16" />
            </span>
            <input
              v-model="library.search"
              :placeholder="COPY.search"
              class="w-full rounded-full border border-line bg-paper-deep/60 py-2 pl-9 pr-4 text-sm text-ink outline-none placeholder:text-dusk focus:border-bamboo"
            />
          </div>

          <div class="flex rounded-full border border-line p-0.5">
            <button
              v-for="o in SORTS"
              :key="o.key"
              class="rounded-full px-3 py-1 text-xs text-ink-soft transition-colors"
              :class="{ 'bg-bamboo/15 text-ink': library.sortBy === o.key }"
              @click="library.sortBy = o.key"
            >
              {{ o.label }}
            </button>
          </div>
        </div>

        <div
          v-if="library.files.length === 0"
          class="mt-24 text-center text-dusk"
        >
          <p class="font-serif text-lg">{{ COPY.emptyLibrary }}</p>
          <RouterLink
            to="/import"
            class="mt-4 inline-flex items-center gap-2 text-sm text-bamboo hover:underline"
          >
            <ZIcon name="import" :size="15" />
            {{ COPY.import }}
          </RouterLink>
        </div>

        <p
          v-else-if="library.filtered.length === 0"
          class="mt-24 text-center text-dusk"
        >
          寻无所获
        </p>

        <div
          v-else
          class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <DocumentCard
            v-for="f in library.filtered"
            :key="f.relativePath"
            :file="f"
            :meta="library.index[f.relativePath]"
          />
        </div>
      </main>
    </div>
  </div>
</template>
