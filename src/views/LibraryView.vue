<script setup lang="ts">
import ZIcon from '@/components/common/ZIcon.vue'
import DocumentCard from '@/components/library/DocumentCard.vue'
import FolderTree from '@/components/library/FolderTree.vue'

import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { COPY } from '@/lib/copy'
import type { ThemeName } from '@/types/settings'

const library = useLibraryStore()
const settings = useSettingsStore()

const THEME_CYCLE: ThemeName[] = ['light', 'sepia', 'dark']

function cycleTheme() {
  const i = THEME_CYCLE.indexOf(settings.theme)
  settings.setTheme(THEME_CYCLE[(i + 1) % THEME_CYCLE.length])
}

const SORTS = [
  { key: 'lastOpenedAt', label: '最近' },
  { key: 'updatedAt', label: '最近更新' },
  { key: 'title', label: '标题' },
] as const

function toggleFolder(path: string) {
  library.selectedFolder = library.selectedFolder === path ? '' : path
}
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
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
          :title="COPY.settings"
          @click="cycleTheme"
        >
          <ZIcon :name="settings.theme === 'dark' ? 'moon' : 'sun'" :size="17" />
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

    <div class="flex">
      <aside
        v-if="library.folderTree.length"
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
        <FolderTree
          :nodes="library.folderTree"
          :selected="library.selectedFolder"
          @select="toggleFolder"
        />
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
          v-if="library.documents.length === 0"
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
          <DocumentCard v-for="d in library.filtered" :key="d.id" :doc="d" />
        </div>
      </main>
    </div>
  </div>
</template>
