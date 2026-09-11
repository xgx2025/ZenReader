<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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
import { useCardArrange } from '@/composables/useCardArrange'
import { customRank } from '@/lib/arrange'
import { COPY } from '@/lib/copy'
import { folderCrumbs } from '@/lib/folderTree'
import { folderPathFromRelative } from '@/lib/vault'
import type { ThemeName } from '@/types/settings'
import type { FormatFilter, VaultFile } from '@/types/document'

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
  { key: 'custom', label: COPY.sortHand },
] as const
type SortKey = (typeof SORTS)[number]['key']

/** 「自定义」档仅在完成过排布后出现（从未排布时它没有意义）。 */
const visibleSorts = computed(() =>
  library.arranged ? SORTS : SORTS.filter((o) => o.key !== 'custom'),
)

function onSortClick(key: SortKey) {
  if (key === 'custom' && !library.arranged) return
  library.setSort(key)
}

function toggleFolder(path: string) {
  library.selectedFolder = library.selectedFolder === path ? '' : path
}

// —— 卷式筛选：折叠成一枚小签，点击展开三档 ——
/** md / html 沿用卡片页脚那枚小签的等宽字形与本色。 */
const FORMAT_FILTERS = [
  { key: 'all', label: COPY.formatFilterAll, mono: false, mark: 'text-bamboo' },
  { key: 'markdown', label: COPY.formatExtMarkdown, mono: true, mark: 'text-bamboo' },
  { key: 'html', label: COPY.formatExtHtml, mono: true, mark: 'text-sandal' },
] as const

const formatCurrent = computed(
  () =>
    FORMAT_FILTERS.find((f) => f.key === library.formatFilter) ?? FORMAT_FILTERS[0],
)

/** 未筛选时是一枚静默胶囊（与「拖动排序」同族）；筛选生效才泛出该卷式本色。 */
const formatChipClass = computed(() => {
  switch (library.formatFilter) {
    case 'markdown':
      return 'border-bamboo/25 bg-bamboo/10 text-bamboo'
    case 'html':
      return 'border-sandal/30 bg-sandal/12 text-sandal'
    default:
      return 'border-transparent bg-paper-deep/60 text-ink-soft hover:bg-bamboo/10 hover:text-ink'
  }
})

const formatBtn = ref<HTMLElement | null>(null)
const formatMenu = ref({ open: false, x: 0, y: 0 })

/** 菜单锚在签的左下角；ContextMenu 自会按视口夹取。 */
function openFormatMenu() {
  const r = formatBtn.value?.getBoundingClientRect()
  if (!r) return
  formatMenu.value = { open: true, x: r.left, y: r.bottom + 6 }
}

function pickFormat(key: FormatFilter) {
  library.formatFilter = key
  formatMenu.value.open = false
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

// 分组操作：右击侧栏分组 → 释怀（仅空分组可删）。
const folderMenu = ref<{
  open: boolean
  x: number
  y: number
  path: string
  /** 该分组整棵子树的卷数；> 0 即后端必然拒绝释怀，据此前置置灰。 */
  count: number
}>({
  open: false,
  x: 0,
  y: 0,
  path: '',
  count: 0,
})

function openFolderMenu(e: { path: string; count: number; x: number; y: number }) {
  folderMenu.value = { open: true, x: e.x, y: e.y, path: e.path, count: e.count }
}

function closeFolderMenu() {
  folderMenu.value.open = false
}

async function onRemoveFolder() {
  const { path, count } = folderMenu.value
  closeFolderMenu()
  if (!path || count > 0) return
  try {
    await library.removeFolder(path)
    notify(COPY.folderRemoved, 'bamboo')
  } catch {
    // 兜底：read_vault 只报 .md/.html/.htm 且跳过隐藏目录，而后端对**任何**文件
    // 都拒绝——一个只含 cover.png 的分组会显示 0 却删不掉，UI 无从预判。
    notify(COPY.folderNotEmpty, 'sandal')
  }
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
  // 卷式是一枚一键可复原的视图滤镜，而「我要引入这个文件」的意图不可推导：
  // 挡掉新卡的代价（以为引入失败）远大于多按一次，故有卷入库即复位为「全部」。
  // 已知精度损失：落进来的文件本就符合当前筛选时也会一并复位——结果只带计数
  // 不带路径，为这点偏差去扩 ImportResult 不划算。
  const cleared = r.imported > 0 && library.formatFilter !== 'all'
  if (cleared) library.formatFilter = 'all'

  const parts: string[] = []
  if (r.imported) parts.push(`${COPY.importDone} ${r.imported}`)
  if (r.skipped) parts.push(`${COPY.importSkipped} ${r.skipped}`)
  if (r.failed) parts.push(`${COPY.importError} ${r.failed}`)
  if (cleared) parts.push(COPY.importFilterCleared)
  if (!parts.length) return
  notify(parts.join(' · '), r.imported ? 'bamboo' : 'sandal')
}

const { dragging: dropDragging } = useVaultDrop(
  () => library.selectedFolder,
  onDropResult,
  // 拖动排序中不受新卷，避免正在排的序列被 refresh 打乱。
  () => !arranging.value,
)

// —— 拖动排序（手动排布）：就地拖拽 ——
const arranging = ref(false)
/** 拖动排序工作序列：当前可见集按自定义序基线投影；拖拽就地重排它。 */
const arrangePaths = ref<string[]>([])
const mainRef = ref<HTMLElement | null>(null)

const arrangeReady = computed(
  () => library.hasVault && library.filtered.length >= 2,
)

/** 供卡片渲染：把 relativePath 快速反查 VaultFile。 */
const byPath = computed(() => {
  const m = new Map<string, VaultFile>()
  for (const f of library.files) m.set(f.relativePath, f)
  return m
})

/** 拖动排序中展示本地序列，否则展示 store 的 filtered。 */
const cardsToRender = computed<VaultFile[]>(() =>
  arranging.value
    ? arrangePaths.value
        .map((p) => byPath.value.get(p))
        .filter((f): f is VaultFile => !!f)
    : library.filtered,
)

const gridClass = computed(() =>
  [
    'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 arrange-grid',
    // 整片网格淡入：非拖动排序态每次重挂载播放一次（见下方 key）。
    arranging.value ? 'arrange-active' : 'grid-arrive',
  ].join(' '),
)

/**
 * 网格重挂载钥匙：换分组/换卷式/进出拖动排序时强制重挂载整片网格，
 * 让 .grid-arrive 从头播放、并让旧组卡片即刻退场（不再拖沓半秒）。
 * 不掺入搜索词——寻词过程要保持即时、逐键不闪动。
 */
const gridKey = computed(() =>
  arranging.value
    ? 'arrange'
    : `folder:${library.selectedFolder || '__root__'}:${library.formatFilter}`,
)

/**
 * 空网格的缘由：先答「寻」、再答「卷式」、最后答「分组为空」。
 *
 * 这个次序**刻意不同于** store 里谓词的次序（卷式 → 分组 → 寻词）：文案回答的是
 * 「用户最可能因为什么看到空」，而非谓词谁先谁后。但卷式必须压在分组之前——某分组
 * 有 3 篇 .md 而卷式选的是 html 时，成因是筛选器，说「此分组尚无篇章」就是撒谎。
 */
const emptyMessage = computed(() => {
  if (library.search.trim()) return COPY.emptySearch
  if (library.formatFilter !== 'all') return COPY.emptyFormat
  if (library.selectedFolder) {
    // 有子分组时指个路，否则下钻模型会让人以为内容丢了。
    return library.selectedChildren.length ? COPY.emptyFolderNested : COPY.emptyFolder
  }
  return COPY.emptySearch // 已不可达（全空由 files.length === 0 先接住），纯防御
})

/** 面包屑：仅选中分组时非空，为空即整行不渲染。 */
const crumbs = computed(() => folderCrumbs(library.selectedFolder))

/**
 * 下钻模型必然引出的疑问是「另外那些卷去哪了」——范围行正面回答它。
 * 寻词时列表本就递归，无需再解释；无子分组时也不必（空态文案已说清）。
 */
const scopeHint = computed(() => {
  if (!library.selectedFolder) return ''
  if (library.search.trim()) return ''
  if (!library.selectedChildren.length) return ''
  const { here, below } = library.folderScope
  return `${COPY.scopeHere} ${here} ${COPY.pieceUnit} · ${COPY.scopeBelow} ${below} ${COPY.pieceUnit}`
})

const { drag, onPick, cancelDrag } = useCardArrange({
  paths: arrangePaths,
  getGrid: () => mainRef.value?.querySelector<HTMLElement>('.arrange-grid') ?? null,
  getScroll: () => mainRef.value,
  lookupFile: (p) => byPath.value.get(p) ?? null,
  onCommit: onArrangeCommit,
})

/** 一次落子：合并回全库自定义序；首次真正排布完成时给一声轻响。 */
function onArrangeCommit(movedPath: string) {
  const wasArranged = library.arranged
  library.commitVisibleMove(movedPath, arrangePaths.value.slice())
  if (library.arranged && !wasArranged) notify(COPY.arrangeDone, 'bamboo')
}

/** 进入拖动排序：先钉自定义序基线，再把可见集投影到该序列，方便直接上手拖。 */
function startArrange() {
  if (arranging.value || !arrangeReady.value) return
  library.seedDefaultOrder()
  const visible = library.filtered.map((f) => f.relativePath)
  const rank = customRank(library.customOrder)
  arrangePaths.value = [...visible].sort((a, b) => rank(a) - rank(b))
  arranging.value = true
}

function finishArrange() {
  if (drag.value?.started) cancelDrag()
  arranging.value = false
  arrangePaths.value = []
}

/** 拖动排序中每张卡的角标：新卷示「新」，其余示序号以增强位置感；被拿起卷不标。 */
function badgeFor(path: string, i: number): string {
  if (!arranging.value) return ''
  if (drag.value?.started && drag.value.path === path) return ''
  return library.latestArrivals.includes(path) ? COPY.newBadge : String(i + 1)
}

function onWindowFocus() {
  if (arranging.value) return // 拖动排序中聚焦不再刷新，避免序列被搅动
  library.refresh()
}

/** 搜索框引用：清空后回焦、`/` 键直达。 */
const searchInput = ref<HTMLInputElement | null>(null)
const searchFocused = ref(false)

function clearSearch() {
  library.search = ''
  searchInput.value?.focus()
}

/** 非输入态按 `/` 直达寻书；拖动排序中 Esc 先撤拖拽、再按退出拖动排序。 */
function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (!arranging.value) return
    e.preventDefault()
    if (drag.value?.started) {
      cancelDrag()
      return
    }
    finishArrange()
    return
  }
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target as HTMLElement
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
  if (arranging.value) return // 拖动排序中寻书已让位
  e.preventDefault()
  searchInput.value?.focus()
}

// 拖动排序中若可见集被外部侥幸改动（如磁盘变化），干净退出避免把过期序列写回。
watch(
  () => library.files.map((f) => f.relativePath).sort().join('\u0001'),
  (next, prev) => {
    if (arranging.value && next !== prev) {
      finishArrange()
    }
  },
)

onMounted(() => {
  library.refresh()
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('keydown', onGlobalKey)
})

onBeforeUnmount(() => {
  if (drag.value) cancelDrag()
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('keydown', onGlobalKey)
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden text-ink">
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
          class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-soft"
          :title="COPY.refresh"
          :disabled="arranging"
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

    <div v-else class="flex min-h-0 flex-1">
      <aside
        class="hidden h-full w-56 shrink-0 overflow-y-auto p-4 transition-opacity duration-300 md:block"
        :class="arranging ? 'pointer-events-none opacity-40' : ''"
      >
        <button
          class="mb-2 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm text-ink-soft transition-colors duration-200 hover:bg-bamboo/10 hover:text-ink"
          :class="{ 'bg-bamboo/15 font-medium text-ink': !library.selectedFolder }"
          @click="library.selectedFolder = ''"
        >
          <span class="flex items-center gap-1.5">
            <ZIcon name="library" :size="14" class="shrink-0 text-bamboo/70" />
            {{ COPY.library }}
          </span>
          <span class="text-xs tabular-nums text-dusk">{{ library.totalCount }}</span>
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
          @menu="openFolderMenu"
        />
        <p
          v-else
          class="flex flex-col items-center px-2.5 py-4 text-xs text-dusk"
        >
          <span class="zen-breathe h-1.5 w-1.5 rounded-full bg-dusk/60"></span>
          <span class="mt-3">{{ COPY.emptyFolders }}</span>
        </p>
      </aside>

      <main ref="mainRef" class="h-full min-w-0 flex-1 overflow-y-auto p-6">
        <div
          class="flex flex-wrap items-center gap-3"
          :class="crumbs.length ? 'mb-3' : 'mb-6'"
        >
          <div
            class="relative min-w-0 max-w-md flex-1 transition-opacity duration-300"
            :class="arranging ? 'pointer-events-none opacity-50' : ''"
          >
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dusk">
              <ZIcon name="search" :size="16" />
            </span>
            <input
              ref="searchInput"
              v-model="library.search"
              :readonly="arranging"
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

          <!-- 排序胶囊：拖动排序中让位（正在编辑序列本身） -->
          <div
            v-if="!arranging"
            class="flex rounded-full bg-paper-deep/60 p-0.5"
          >
            <button
              v-for="o in visibleSorts"
              :key="o.key"
              class="rounded-full px-3 py-1 text-xs transition-colors duration-200"
              :class="
                library.displayMode === o.key
                  ? 'bg-bamboo/15 font-medium text-ink'
                  : 'text-ink-soft hover:text-ink'
              "
              @click="onSortClick(o.key)"
            >
              {{ o.label }}
            </button>
          </div>

          <!-- 卷式小签：折叠成一枚，点击展开三档；拖动排序中让位 -->
          <button
            v-if="!arranging"
            ref="formatBtn"
            type="button"
            class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-200"
            :class="formatChipClass"
            :title="COPY.formatFilterHint"
            aria-haspopup="menu"
            :aria-expanded="formatMenu.open"
            @click="openFormatMenu"
          >
            <span>
              {{ COPY.formatFilter }}：<span :class="formatCurrent.mono ? 'font-mono' : ''">{{
                formatCurrent.label
              }}</span>
            </span>
            <ZIcon name="chevron-down" :size="12" />
          </button>

          <!-- 拖动排序入口 / 完成 -->
          <button
            class="flex items-center gap-1.5 rounded-full transition-all duration-300"
            :class="
              arranging
                ? 'bg-bamboo px-4 py-1.5 text-xs text-paper hover:opacity-90'
                : 'bg-paper-deep/60 px-3.5 py-1.5 text-xs text-ink-soft hover:bg-bamboo/10 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-soft'
            "
            :title="arranging ? undefined : COPY.arrangeNeedTwo"
            :disabled="!arranging && !arrangeReady"
            @click="arranging ? finishArrange() : startArrange()"
          >
            <ZIcon
              name="grip"
              :size="14"
              :stroke-width="arranging ? 1.4 : 1.25"
            />
            {{ arranging ? COPY.arrangeFinish : COPY.arrange }}
          </button>
        </div>

        <!-- 位置与范围：仅在选中分组时现身。侧栏高亮在拖动排序中会淡到 opacity-40，
             此条恰是那时唯一的方向标，故保留可见——但必须不可点：可点的话
             selectedFolder 会在 arrangePaths 仍持旧可见集时改变，而过期序列要等到
             落子或文件集变动才会被清掉。 -->
        <div
          v-if="crumbs.length"
          class="mb-5 flex min-w-0 items-center gap-3 text-xs transition-opacity duration-300"
          :class="arranging ? 'pointer-events-none opacity-50' : ''"
        >
          <nav aria-label="分组路径" class="flex min-w-0 items-center gap-0.5">
            <button
              class="shrink-0 rounded-md px-1.5 py-0.5 text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
              @click="library.selectedFolder = ''"
            >
              {{ COPY.library }}
            </button>
            <template v-for="(c, i) in crumbs" :key="c.path">
              <ZIcon
                name="chevron-right"
                :size="12"
                class="shrink-0 text-dusk/60"
              />
              <!-- 祖先可点即「上一层」，故无需另设返回按钮 -->
              <button
                v-if="i < crumbs.length - 1"
                class="min-w-0 rounded-md px-1.5 py-0.5 text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
                :title="c.path"
                @click="library.selectedFolder = c.path"
              >
                <span class="block truncate">{{ c.name }}</span>
              </button>
              <span
                v-else
                class="min-w-0 rounded-md px-1.5 py-0.5 font-medium text-ink"
                :title="c.path"
              >
                <span class="block truncate">{{ c.name }}</span>
              </span>
            </template>
          </nav>

          <span v-if="scopeHint" class="ml-auto shrink-0 tabular-nums text-dusk">
            {{ scopeHint }}
          </span>
        </div>

        <!-- 拖动排序引导条 -->
        <div
          v-if="arranging"
          class="arrange-guide mb-5 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-bamboo/40 bg-bamboo/5 px-4 py-2.5 text-xs text-dusk"
        >
          <span class="flex items-center gap-2 text-ink-soft">
            <ZIcon name="grip" :size="14" class="text-bamboo/70" />
            {{ COPY.arrangeHint }}
          </span>
          <span class="hidden sm:inline">{{ COPY.arrangeEscHint }}</span>
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
          <span class="mt-5 font-serif">{{ emptyMessage }}</span>
        </p>

        <TransitionGroup
          v-else
          :key="gridKey"
          tag="div"
          name="arrange"
          :class="gridClass"
        >
          <DocumentCard
            v-for="(f, i) in cardsToRender"
            :key="f.relativePath"
            :file="f"
            :meta="library.index[f.relativePath]"
            :query="library.search"
            :arrange="arranging"
            :slot="arranging && drag?.started && drag.path === f.relativePath"
            :badge="badgeFor(f.relativePath, i)"
            @menu="openMenu"
            @pick="onPick"
          />
        </TransitionGroup>
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

    <ContextMenu
      :open="folderMenu.open"
      :x="folderMenu.x"
      :y="folderMenu.y"
      @close="closeFolderMenu"
    >
      <!-- 非空分组置灰：后端对整棵子树要求无文件，「点了必然失败」不如一看就懂。
           缘由**就近写在按钮里**而非挂 title——disabled 元素在 WebView2 里收不到
           指针事件，tooltip 根本不会弹出，写了等于没写。 -->
      <button
        class="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-bamboo/10 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        :class="
          folderMenu.count > 0 ? 'text-dusk' : 'text-ink-soft hover:text-ink'
        "
        :disabled="folderMenu.count > 0"
        @click="onRemoveFolder"
      >
        <ZIcon
          name="delete"
          :size="15"
          class="mt-0.5 shrink-0"
          :class="folderMenu.count > 0 ? 'text-sandal/40' : 'text-sandal'"
        />
        <span class="flex min-w-0 flex-col text-left">
          <span>{{ COPY.removeFolder }}</span>
          <span
            v-if="folderMenu.count > 0"
            class="mt-0.5 text-[11px] leading-snug text-dusk"
          >
            {{ COPY.folderNotEmpty }}
          </span>
        </span>
      </button>
    </ContextMenu>

    <!-- 卷式三档：选中行以「勾 + 加粗 + 本色」三重编码，未选中行留位对齐 -->
    <ContextMenu
      :open="formatMenu.open"
      :x="formatMenu.x"
      :y="formatMenu.y"
      @close="formatMenu.open = false"
    >
      <button
        v-for="f in FORMAT_FILTERS"
        :key="f.key"
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-bamboo/10 hover:text-ink"
        :class="library.formatFilter === f.key ? 'font-medium text-ink' : 'text-ink-soft'"
        @click="pickFormat(f.key)"
      >
        <ZIcon
          v-if="library.formatFilter === f.key"
          name="check"
          :size="14"
          class="shrink-0"
          :class="f.mark"
        />
        <span v-else class="w-3.5 shrink-0"></span>
        <span :class="f.mono ? 'font-mono' : ''">{{ f.label }}</span>
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

    <!-- 拖动排序拖拽中的浮动克隆：随指针倾浮的"被拿起卷" -->
    <Teleport to="body">
      <div
        v-if="drag?.started"
        class="arrange-ghost pointer-events-none fixed left-0 top-0 z-40 will-change-transform"
        :style="{
          width: `${drag.width}px`,
          transform: `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(-1.5deg) scale(1.02)`,
        }"
      >
        <DocumentCard
          :file="drag.file"
          :meta="library.index[drag.path]"
          :clone="true"
        />
      </div>
    </Teleport>

    <!-- 拖拽引卷遮罩：悬浮全屏提示，落点即入藏 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="dropDragging && !arranging"
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
            <p class="mt-1 text-xs text-dusk">{{ COPY.importExtHint }}</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
