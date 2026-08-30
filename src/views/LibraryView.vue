<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import type { IconName } from '@/components/common/ZIcon.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import DocumentCard from '@/components/library/DocumentCard.vue'
import FolderTree from '@/components/library/FolderTree.vue'
import MoveDialog from '@/components/library/MoveDialog.vue'

import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import { useVaultDrop, type DropImportResult } from '@/composables/useVaultDrop'
import { useToast } from '@/composables/useToast'
import { COPY } from '@/lib/copy'
import { folderPathFromRelative } from '@/lib/vault'
import type { ThemeName } from '@/types/settings'
import type { VaultFile } from '@/types/document'

const library = useLibraryStore()
const settings = useSettingsStore()
const { openPanel } = useSettingsPanel()
const { notify } = useToast()

const THEME_CYCLE: ThemeName[] = ['light', 'sepia', 'dark']

/** 三态主题图标：明亮→日、暮色→落日、夜读→月。 */
const THEME_ICON: Record<ThemeName, IconName> = {
  light: 'sun',
  sepia: 'sunset',
  dark: 'moon',
}

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

// 文档操作：右击卡片或点「⋯」唤起菜单 → 移到分组 / 移出书库
const menu = ref<{ open: boolean; x: number; y: number; file: VaultFile | null }>({
  open: false,
  x: 0,
  y: 0,
  file: null,
})
const moveTarget = ref<VaultFile | null>(null)
const removeTarget = ref<VaultFile | null>(null)

function openMenu(file: VaultFile, x: number, y: number) {
  menu.value = { open: true, x, y, file }
}

function closeMenu() {
  menu.value.open = false
}

function onMenuMove() {
  const file = menu.value.file
  closeMenu()
  if (file) moveTarget.value = file
}

function onMenuRemove() {
  const file = menu.value.file
  closeMenu()
  if (file) removeTarget.value = file
}

async function onMoveTo(path: string) {
  const file = moveTarget.value
  if (!file) return
  moveTarget.value = null
  const to = path ? `${path}/${file.name}` : file.name
  if (to === file.relativePath) return
  try {
    await library.moveDocument(file.relativePath, to)
    notify(COPY.movedDone)
  } catch {
    notify(COPY.opFailed, 'sandal')
  }
}

async function onConfirmRemove() {
  const file = removeTarget.value
  if (!file) return
  removeTarget.value = null
  try {
    await library.removeDocument(file.relativePath)
    notify(COPY.removedDone, 'bamboo')
  } catch {
    notify(COPY.opFailed, 'sandal')
  }
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
  try {
    await library.createFolder(newFolderName.value.trim())
    notify(COPY.folderCreated)
  } catch {
    notify(COPY.opFailed, 'sandal')
  }
  cancelCreating()
}

// 拖拽引卷：拖入即浮起「松手引卷入藏」，落点按当前选中分组导入。
function onDropResult(r: DropImportResult) {
  const parts: string[] = []
  if (r.imported) parts.push(`${COPY.importDone} ${r.imported}`)
  if (r.skipped) parts.push(`${COPY.importSkipped} ${r.skipped}`)
  if (r.failed) parts.push(`${COPY.importError} ${r.failed}`)
  if (!parts.length) return
  notify(parts.join(' · '), r.imported ? 'bamboo' : 'sandal')
}

const { dragging: dropDragging } = useVaultDrop(
  () => library.selectedFolder,
  onDropResult,
)

function onWindowFocus() {
  library.refresh()
}

/** 搜索框引用：清空后回焦、`/` 键直达。 */
const searchInput = ref<HTMLInputElement | null>(null)
const searchFocused = ref(false)

function clearSearch() {
  library.search = ''
  searchInput.value?.focus()
}

/** 非输入态按 `/` 直达寻书。 */
function onGlobalKey(e: KeyboardEvent) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target as HTMLElement
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
  e.preventDefault()
  searchInput.value?.focus()
}

onMounted(() => {
  library.refresh()
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('keydown', onGlobalKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('keydown', onGlobalKey)
})
</script>

<template>
  <div class="min-h-screen text-ink">
    <header
      class="header-fade sticky top-0 z-10 flex items-center justify-between bg-paper/55 px-6 py-4 backdrop-blur-md"
    >
      <div class="flex items-baseline gap-2.5">
        <h1 class="font-serif text-xl leading-tight">{{ COPY.appName }}</h1>
        <span class="text-[11px] uppercase tracking-[0.18em] text-dusk">
          {{ COPY.appNameLatin }}
        </span>
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
          :title="COPY.theme"
          @click="cycleTheme"
        >
          <ZIcon :name="THEME_ICON[settings.theme]" :size="17" />
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
      <div class="zen-breathe h-2.5 w-2.5 rounded-full bg-bamboo/50"></div>
      <h2 class="mt-8 font-serif text-2xl text-ink">{{ COPY.appName }}</h2>
      <p class="mt-2 text-sm tracking-wide text-dusk">{{ COPY.tagline }}</p>
      <button
        class="mt-8 inline-flex items-center gap-2 rounded-full bg-bamboo px-6 py-2.5 text-sm text-paper transition-opacity hover:opacity-90"
        @click="library.openVault()"
      >
        <ZIcon name="folder" :size="16" />
        {{ COPY.openVault }}
      </button>
    </div>

    <div v-else class="flex">
      <aside class="hidden w-56 shrink-0 p-4 md:block">
        <button
          class="mb-2 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm text-ink-soft transition-colors duration-200 hover:bg-bamboo/10 hover:text-ink"
          :class="{ 'bg-bamboo/15 font-medium text-ink': !library.selectedFolder }"
          @click="library.selectedFolder = ''"
        >
          <span class="flex items-center gap-1.5">
            <ZIcon name="library" :size="14" class="shrink-0 text-bamboo/70" />
            {{ COPY.library }}
          </span>
          <span class="text-xs text-dusk">{{ library.totalCount }}</span>
        </button>

        <div class="mb-2">
          <button
            v-if="!creating"
            class="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-soft transition-colors duration-200 hover:bg-bamboo/10 hover:text-ink"
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
              class="w-full rounded-lg bg-paper-deep/60 px-2.5 py-1.5 text-sm text-ink caret-bamboo outline-none placeholder:text-dusk transition-colors focus:bg-paper-deep"
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
        <p
          v-else
          class="flex flex-col items-center px-2.5 py-4 text-xs text-dusk"
        >
          <span class="zen-breathe h-1.5 w-1.5 rounded-full bg-dusk/60"></span>
          <span class="mt-3">{{ COPY.emptyFolders }}</span>
        </p>
      </aside>

      <main class="min-w-0 flex-1 p-6">
        <div class="mb-6 flex flex-wrap items-center gap-3">
          <div class="relative min-w-0 max-w-md flex-1">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dusk">
              <ZIcon name="search" :size="16" />
            </span>
            <input
              ref="searchInput"
              v-model="library.search"
              :placeholder="COPY.search"
              class="w-full rounded-full bg-paper-deep/60 py-2 pl-9 pr-9 text-sm text-ink caret-bamboo outline-none placeholder:text-dusk transition-colors focus:bg-paper-deep"
              @focus="searchFocused = true"
              @blur="searchFocused = false"
            />
            <button
              v-if="library.search"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-dusk transition-colors hover:text-ink"
              aria-label="清空寻词"
              @click="clearSearch"
            >
              <ZIcon name="close" :size="14" />
            </button>
            <kbd
              v-else-if="!searchFocused"
              class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-line bg-paper-deep/60 px-1.5 py-0.5 font-mono text-[11px] leading-none text-dusk"
            >
              /
            </kbd>
          </div>

          <div class="flex rounded-full bg-paper-deep/60 p-0.5">
            <button
              v-for="o in SORTS"
              :key="o.key"
              class="rounded-full px-3 py-1 text-xs transition-colors duration-200"
              :class="
                library.sortBy === o.key
                  ? 'bg-bamboo/15 font-medium text-ink'
                  : 'text-ink-soft hover:text-ink'
              "
              @click="library.sortBy = o.key"
            >
              {{ o.label }}
            </button>
          </div>
        </div>

        <!-- 开卷中：首次扫描书库时的呼吸圆点 -->
        <div
          v-if="library.loading && library.files.length === 0"
          class="mt-24 flex flex-col items-center text-center text-dusk"
        >
          <div class="zen-breathe h-2 w-2 rounded-full bg-bamboo/50"></div>
          <p class="mt-6 font-serif text-lg">{{ COPY.loadingLibrary }}</p>
        </div>

        <div
          v-else-if="library.files.length === 0"
          class="mt-24 flex flex-col items-center text-center text-dusk"
        >
          <div class="zen-breathe h-2 w-2 rounded-full bg-bamboo/50"></div>
          <p class="mt-6 font-serif text-lg">{{ COPY.emptyLibrary }}</p>
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
          class="mt-24 flex flex-col items-center text-center text-dusk"
        >
          <span class="zen-breathe h-1.5 w-1.5 rounded-full bg-dusk/60"></span>
          <span class="mt-5 font-serif">{{ COPY.emptySearch }}</span>
        </p>

        <div
          v-else
          class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <DocumentCard
            v-for="(f, i) in library.filtered"
            :key="f.relativePath"
            :file="f"
            :meta="library.index[f.relativePath]"
            :index="i"
            :query="library.search"
            @menu="openMenu"
          />
        </div>
      </main>
    </div>

    <ContextMenu :open="menu.open" :x="menu.x" :y="menu.y" @close="closeMenu">
      <button
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
        @click="onMenuMove"
      >
        <ZIcon name="folder" :size="15" class="shrink-0 text-sandal" />
        {{ COPY.moveTo }}
      </button>
      <button
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
        @click="onMenuRemove"
      >
        <ZIcon name="delete" :size="15" class="shrink-0 text-sandal" />
        {{ COPY.removeDoc }}
      </button>
    </ContextMenu>

    <MoveDialog
      :open="moveTarget !== null"
      :folders="library.flatFolders"
      :current-path="
        moveTarget ? folderPathFromRelative(moveTarget.relativePath) : ''
      "
      @select="onMoveTo"
      @close="moveTarget = null"
    />

    <ConfirmDialog
      :open="removeTarget !== null"
      :title="COPY.removeDoc"
      :message="COPY.removeDocHint"
      :confirm-label="COPY.delete"
      @confirm="onConfirmRemove"
      @close="removeTarget = null"
    />

    <!-- 拖拽引卷遮罩：悬浮全屏提示，落点即入藏 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="dropDragging"
          class="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-paper/85 backdrop-blur-sm"
        >
          <div
            class="flex flex-col items-center rounded-3xl border-2 border-dashed border-bamboo/50 px-16 py-12 text-center"
          >
            <ZIcon
              name="import"
              :size="40"
              :stroke-width="1"
              class="text-bamboo"
            />
            <p class="mt-4 font-serif text-lg text-ink">
              {{ COPY.dropToImport }}
            </p>
            <p class="mt-1 text-xs text-dusk">.md / .markdown</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
