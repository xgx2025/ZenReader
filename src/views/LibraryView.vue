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
import { useFolderDrag } from '@/composables/useFolderDrag'
import { useFolderExpansion } from '@/composables/useFolderExpansion'
import { customRank } from '@/lib/arrange'
import { planFolderDrop, type FolderDropSpot } from '@/lib/folderDrag'
import { COPY } from '@/lib/copy'
import {
  checkFolderName,
  collectFolderPaths,
  findNode,
  flattenVisibleRows,
  folderCrumbs,
  folderNameTaken,
  folderParentOf,
} from '@/lib/folderTree'
import { folderPathFromRelative, isPathInFolder, rewritePathPrefix } from '@/lib/vault'
import type { ThemeName } from '@/types/settings'
import { DEFAULT_SETTINGS, SIDEBAR_MAX, SIDEBAR_MIN, clampSidebarWidth } from '@/types/settings'
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

// —— 侧栏分组树：选中、开合、行操作、键盘 ——
//
// 「选中」与「展开」刻意分开：点行名只选中（不再「点自己回书库」——那会静默丢掉
// 位置），点折页只开合（收起内含当前选中的分组时，主区内容也不跟着变）。取消选中
// 只有两个出口：「书库」行与面包屑。
const { expanded, rootExpanded, isExpanded, toggle: toggleExpand, reveal, toggleRoot, rekey: rekeyExpanded } =
  useFolderExpansion()

/** 展平后的可见行：键盘上下移动、role="tree" 的层级都只需在这一条序列上做。 */
const folderRows = computed(() =>
  flattenVisibleRows(library.folderTree, expanded.value),
)

// 键盘导航（WAI-ARIA tree 惯例）：↑↓ 同可视序移动，→ 展开/进子层，← 收起/回父层，
// Enter/Space 选中，Home/End 首尾，Menu/Shift+F10 唤菜单。焦点用 roving tabindex。
const focusedFolder = ref('')
const sidebarRef = ref<HTMLElement | null>(null)
/** 屏幕阅读器的活口提示：禁用态收不到 tooltip，缘由得念叨出来。 */
const ariaMessage = ref('')

const activeRowPath = computed(() => {
  const rows = folderRows.value
  if (!rows.length) return ''
  if (focusedFolder.value && rows.some((r) => r.node.path === focusedFolder.value)) {
    return focusedFolder.value
  }
  return library.selectedFolder
})

function rowEl(path: string): HTMLElement | null {
  if (!path) return null
  return sidebarRef.value?.querySelector<HTMLElement>(
    `[data-folder-row="${CSS.escape(path)}"]`,
  ) ?? null
}

function focusRow(path: string) {
  const el = rowEl(path)
  if (!el) return
  focusedFolder.value = path
  el.focus()
  el.scrollIntoView({ block: 'nearest' })
}

/** 方向键的落点：前/后邻居、父行、首尾。 */
function navTarget(path: string, dir: 'prev' | 'next' | 'parent' | 'first' | 'last'): string {
  const rows = folderRows.value
  if (!rows.length) return ''
  const i = rows.findIndex((r) => r.node.path === path)
  if (i < 0) return rows[dir === 'last' ? rows.length - 1 : 0].node.path
  switch (dir) {
    case 'prev':
      return rows[Math.max(0, i - 1)].node.path
    case 'next':
      return rows[Math.min(rows.length - 1, i + 1)].node.path
    case 'parent': {
      const depth = rows[i].depth
      for (let j = i - 1; j >= 0; j -= 1) {
        if (rows[j].depth < depth) return rows[j].node.path
      }
      return '' // 已在顶层：键盘上的「父层」是书库行（不在本行序列里）
    }
    case 'first':
      return rows[0].node.path
    default:
      return rows[rows.length - 1].node.path
  }
}

function selectFolder(path: string) {
  library.selectedFolder = path
}

function onFolderSelect(path: string) {
  selectFolder(path)
  // 焦点跟着意图走：再按方向键时从刚点过的那一行继续，而非从旧位置。
  focusedFolder.value = path
  nextTick(() => focusRow(path))
}

/** 折页只开合，不动选中——主区内容不该因为「把树收起来」而变。 */
function onFolderToggle(path: string) {
  toggleExpand(path)
}

function onRowKeydown(e: KeyboardEvent, path: string) {
  const row = folderRows.value.find((r) => r.node.path === path)
  const dir = e.key === 'ArrowDown' ? 'next' : e.key === 'ArrowUp' ? 'prev' : null
  if (dir) {
    e.preventDefault()
    focusRow(navTarget(path, dir))
    return
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault()
    if (row?.expandable && !isExpanded(path)) toggleExpand(path)
    else focusRow(navTarget(path, 'next'))
    return
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    if (row?.expandable && isExpanded(path)) {
      toggleExpand(path)
      return
    }
    const parent = navTarget(path, 'parent')
    // 顶层分组的「父层」就是书库（不在这份行序列里）：留在原处，不去抢主区焦点。
    if (parent) focusRow(parent)
    return
  }
  if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    focusRow(navTarget(path, e.key === 'Home' ? 'first' : 'last'))
    return
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onFolderSelect(path)
    return
  }
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault()
    openMenuForRow(path)
    return
  }
  focusedFolder.value = path
}

/** 键盘唤菜单：没有指针坐标，锚在该行的左下角（ContextMenu 自会夹取视口）。 */
function openMenuForRow(path: string) {
  const node = folderRows.value.find((r) => r.node.path === path)?.node
  if (!node) return
  const r = rowEl(path)?.getBoundingClientRect()
  openFolderMenu({
    path,
    count: node.count,
    x: r?.left ?? 0,
    y: (r?.bottom ?? 0) + 4,
  })
}

/** 「回到书库」：同一件事有两个入口（书库行、面包屑），故抽成一处。 */
function backToLibrary() {
  focusedFolder.value = ''
  selectFolder('')
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

// —— 分组改名：行内输入，原地改，不弹窗 ——
//
// 名字的两种毛病分开答：自身非法（空、含分隔符）由 checkFolderName 判，同级重名由
// folderNameTaken 对照当前树判。两者都在输入时即时给，故「提交后才知道」几乎不发生。
const renamePath = ref('')
const renameDraft = ref('')
const renameError = ref('')

/** 树里全部已存在的分组路径——同级重名就查它。 */
const allFolderPaths = computed(() => collectFolderPaths(library.folderTree))

function siblingNamesTaken(path: string, name: string): boolean {
  return folderNameTaken(allFolderPaths.value, folderParentOf(path), name, path)
}

/** 即时校验：返回用户可读的缘由，没毛病则空串。 */
function renameIssue(path: string, name: string): string {
  if (!name.trim()) return ''
  const issue = checkFolderName(name)
  if (issue === 'separator') return COPY.folderNameInvalid
  if (siblingNamesTaken(path, name)) return COPY.renameConflict
  return ''
}

function startRename(path: string) {
  closeFolderMenu()
  renamePath.value = path
  renameDraft.value = path.split('/').pop() ?? path
  renameError.value = ''
  // 改名是「对某一行做的事」，焦点也该落在那一行，键盘用户不至于悬空。
  focusedFolder.value = path
}

function cancelRename() {
  renamePath.value = ''
  renameDraft.value = ''
  renameError.value = ''
}

function onRenameInput(value: string) {
  renameDraft.value = value
  renameError.value = renameIssue(renamePath.value, value)
}

/**
 * 提交改名。四个出口各自保留：自身非法与同级重名都**留在编辑态**并把缘由写在行上
 * （不留编辑态的话，用户刚打的字会被吞掉，再想改就得从菜单重来）。
 */
async function commitRename() {
  const from = renamePath.value
  if (!from) return
  const name = renameDraft.value.trim()

  if (name === (from.split('/').pop() ?? from)) {
    cancelRename()
    return
  }
  const issue = checkFolderName(name)
  if (issue) {
    renameError.value = issue === 'empty' ? COPY.folderNameEmpty : COPY.folderNameInvalid
    focusedFolder.value = from
    return
  }
  if (siblingNamesTaken(from, name)) {
    renameError.value = COPY.renameConflict
    focusedFolder.value = from
    return
  }

  const parent = folderParentOf(from)
  const to = parent ? `${parent}/${name}` : name
  const wasSelected = library.selectedFolder
  cancelRename()
  try {
    await library.renameFolder(from, to)
  } catch {
    notify(COPY.renameFailed, 'sandal')
    ariaMessage.value = COPY.renameFailed
    return
  }
  rekeyExpanded(from, to)
  if (isPathInFolder(wasSelected, from)) {
    selectFolder(rewritePathPrefix(wasSelected, from, to))
  }
  focusedFolder.value = to
  notify(COPY.folderRenamed)
}

// —— 分组拖拽：拖动排序 + 拖拽移动 ——
//
// 一条手势表达两件事，靠落点位置区分：行的上/下 1/4 是「排到前面/后面」，中间是
// 「放进它里面」。同层前后＝排序，跨层＝移动（后端走 rename_dir，与改名同一条路）。
//
// 手势本身是**指针事件**（`useFolderDrag`），不是 HTML5 拖放：后者在 Windows 的
// WebView2 里会丢 drop（拖到一半松手毫无反应），详见该 composable 的说明。
// 判定是纯函数（`lib/folderDrag`），这里只负责「按判定去改数据」。
const folderRowsRef = computed(() =>
  folderRows.value.map((r) => ({ path: r.node.path, expandable: r.expandable })),
)

const {
  drag: folderDrag,
  over: folderDragOver,
  onPointerDown: onRowPointerDown,
  shouldSwallowClick: swallowRowClick,
} = useFolderDrag({
  getEl: () => sidebarRef.value?.querySelector<HTMLElement>('.folder-fold') ?? null,
  getRows: () => folderRowsRef.value,
  onStart: () => {
    // 拿起时把落点清空：还没移动过，不该先亮一条插入线。
    folderDragOver.value = null
  },
  onOver: () => {
    // 落点已由 composable 持有的 ref 承载，模板直接读它；这里无需额外动作。
  },
  onDrop: (moved, path, spot) => {
    // 只拖了没落点（指针不在任何一行上）或没真拖动，都不构成一次排序。
    if (!moved || !path || !spot) return
    void commitFolderDrop(path, spot)
  },
})

/** 该父分组下、按当前显示序排列的直接子分组路径——排序与落点都按它算。 */
function childrenInDisplayOrder(parent: string): string[] {
  const nodes = parent ? (findNode(library.folderTree, parent)?.children ?? []) : library.folderTree
  return nodes.map((n) => n.path)
}

/**
 * 松手落子：把「被拖的组 + 落点」折成一次动作再执行。
 *
 * 判定（排到第几位 / 是否搬家 / 放进自己子树要拒）全在 `planFolderDrop` 这个纯函数里，
 * 这里只管两件事——把拒绝的缘由说给用户听，以及把动作落到 store。
 */
async function commitFolderDrop(dragged: string, spot: FolderDropSpot): Promise<void> {
  // 放进自己或自己的子树里会让整棵子树消失，后端也会拒绝——先把理由说白。
  if (
    spot.mode === 'inside' &&
    (spot.path === dragged || spot.path.startsWith(`${dragged}/`))
  ) {
    notify(COPY.moveFolderFailed, 'sandal')
    ariaMessage.value = COPY.moveFolderFailed
    return
  }

  const plan = planFolderDrop(dragged, spot, childrenInDisplayOrder)
  if (!plan) return

  if (plan.kind === 'reorder') {
    library.commitFolderOrder(new Map([[plan.parent, plan.order]]))
    return
  }

  const { from, to, parent: targetParent } = plan
  const name = from.split('/').pop() ?? from
  if (folderNameTaken(allFolderPaths.value, targetParent, name, from)) {
    notify(COPY.renameConflict, 'sandal')
    ariaMessage.value = COPY.renameConflict
    return
  }

  // 跨层：交给 renameFolder（它会把笔记/进度/顺序一并迁走）。
  const wasSelected = library.selectedFolder
  try {
    await library.renameFolder(from, to)
  } catch {
    notify(COPY.moveFolderFailed, 'sandal')
    ariaMessage.value = COPY.moveFolderFailed
    return
  }
  rekeyExpanded(from, to)
  if (isPathInFolder(wasSelected, from)) {
    selectFolder(rewritePathPrefix(wasSelected, from, to))
  }
  // 目标父级展开，让用户看见东西落进去了。
  reveal(to)
  focusedFolder.value = to

  // 顺序：源父级与目标父级都用新的显示序重写一遍，否则落点的「第几位」白算。
  const sourceParent = folderParentOf(from)
  const nextSource = childrenInDisplayOrder(sourceParent).filter((p) => p !== from)
  const nextTarget = childrenInDisplayOrder(targetParent)
  library.commitFolderOrder(
    new Map([
      [sourceParent, nextSource],
      [targetParent, nextTarget],
    ]),
  )
  notify(`${COPY.folderMoved} · ${targetParent || COPY.library}`, 'bamboo')
}

/**
 * 释怀一个空分组 = 删一个空目录：纯本地、可逆，故不再走重确认弹窗（ConfirmDialog
 * 留给删文件），而是**先做再给一条可撤销的轻提示**。撤销即按原路径重建同名目录，
 * 并把父级重新展开、选中复原——用户回到删除前的样子。
 */
async function removeFolderWithUndo(path: string) {
  const name = path.split('/').pop() ?? path
  const parent = folderPathFromRelative(`${path}/x`)
  const wasSelected = library.selectedFolder === path
  try {
    await library.removeFolder(path)
  } catch {
    // 兜底：read_vault 只报 .md/.html/.htm 且跳过隐藏目录，而后端对**任何**文件都
    // 拒绝——一个只含 cover.png 的分组会显示 0 却删不掉，UI 无从预判。
    notify(COPY.folderNotEmpty, 'sandal')
    ariaMessage.value = COPY.folderNotEmpty
    return
  }
  notify(COPY.folderRemoved, 'bamboo', {
    label: COPY.folderRemovedUndo,
    onClick: () => {
      void library
        .createFolderAt(path)
        .then(() => {
          if (parent) reveal(parent)
          if (wasSelected) selectFolder(path)
          notify(COPY.folderRestored)
        })
        .catch(() => notify(COPY.opFailed, 'sandal'))
      // 「撤销」按下了：把 focus 与行序对齐，键盘用户不至于悬在半空。
      focusedFolder.value = ''
    },
  })
}

async function onRemoveFolder() {
  const { path, count } = folderMenu.value
  closeFolderMenu()
  if (!path || count > 0) {
    if (path && count > 0) ariaMessage.value = COPY.folderNotEmpty
    return
  }
  await removeFolderWithUndo(path)
}

/** 侧栏行上直接「释怀」（空分组才露出这枚按钮）。 */
function onRowRemove(path: string) {
  focusedFolder.value = path
  void removeFolderWithUndo(path)
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
/** 非法名的缘由。按钮**不禁用**——禁用只让人怀疑按钮坏了，说不出为什么。 */
const newFolderError = ref('')

/**
 * 新建分组的落点由当前选中分组暗定（store 侧也是这么建的），所以必须写在输入框
 * 上方：刚点开某个分组再点「新建分组」的人，十有八九以为自己在建顶层。
 */
const newFolderParentLabel = computed(() => {
  if (!library.selectedFolder) return COPY.newFolderUnderRoot
  return `${COPY.library} / ${library.selectedFolder.split('/').join(' / ')}`
})

function startCreating() {
  creating.value = true
  newFolderName.value = ''
  newFolderError.value = ''
  nextTick(() => newFolderInput.value?.focus())
}

function cancelCreating() {
  creating.value = false
  newFolderName.value = ''
  newFolderError.value = ''
}

/** 有错则即时清掉：用户已经在改了，再摆着红字就是唠叨。 */
function onFolderNameInput() {
  if (newFolderError.value) newFolderError.value = ''
}

function validateFolderName(): boolean {
  const n = newFolderName.value.trim()
  if (!n) {
    newFolderError.value = COPY.folderNameEmpty
    return false
  }
  if (n.includes('/') || n.includes('\\')) {
    newFolderError.value = COPY.folderNameInvalid
    return false
  }
  newFolderError.value = ''
  return true
}

/** 输入框为空时按钮置灰（省一次无谓点击），有内容则可点、由校验给缘由。 */
function canCreate() {
  return newFolderName.value.trim().length > 0
}

async function submitFolder() {
  if (!validateFolderName()) {
    newFolderInput.value?.focus()
    return
  }
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

  if (r.imported > 0) showArrival(library.selectedFolder)

  const parts: string[] = []
  if (r.imported) parts.push(`${COPY.importDone} ${r.imported}`)
  if (r.skipped) parts.push(`${COPY.importSkipped} ${r.skipped}`)
  if (r.failed) parts.push(`${COPY.importError} ${r.failed}`)
  if (cleared) parts.push(COPY.importFilterCleared)
  if (!parts.length) return
  notify(parts.join(' · '), r.imported ? 'bamboo' : 'sandal')
}

/**
 * 新卷落在哪个分组里，原来的侧栏是无从知道的（拖入一个文件夹，几十卷静悄悄散进
 * 各自的子目录）。给落点分组记一笔，侧栏上亮一枚竹色小点并浮出可点的提示条。
 */
const arrival = ref<{ folder: string; count: number } | null>(null)
let arrivalTimer: ReturnType<typeof setTimeout> | undefined

function showArrival(folder: string) {
  arrival.value = { folder, count: library.latestArrivals.length }
  if (arrivalTimer) clearTimeout(arrivalTimer)
  arrivalTimer = setTimeout(() => {
    arrival.value = null
  }, 6000)
}

/** 提示条上的分组名：根就是「书库」。 */
const arrivalLabel = computed(() =>
  arrival.value?.folder
    ? (arrival.value.folder.split('/').pop() ?? arrival.value.folder)
    : COPY.library,
)

/** 提示条文案：`3 篇已入 · Java`。 */
const arrivalText = computed(() =>
  arrival.value ? `${arrival.value.count} ${COPY.pieceUnit}${COPY.arrivalIn}` : '',
)

function gotoArrival() {
  const target = arrival.value?.folder ?? ''
  if (target) reveal(target)
  selectFolder(target)
  arrival.value = null
}

const { dragging: dropDragging } = useVaultDrop(
  () => library.selectedFolder,
  onDropResult,
  // 拖动排序中不受新卷，避免正在排的序列被 refresh 打乱。
  () => !arranging.value,
)

/**
 * 引卷落点：拖拽经过某个分组行时亮起它，遮罩文案随之从「松手引卷入藏」变成
 * 「松手入『Java』」——否则整屏只有一句笼统的提示，用户并不知道会落在哪。
 * 松手后落点仍是 `selectedFolder`（原生通道拿不到指针下的行），故这层提示
 * **只作视觉预告**：让用户先点中目标分组，再拖进来的路径依然成立。
 */
const dropHover = ref('')

watch(dropDragging, (on) => {
  if (!on) dropHover.value = ''
})

/** 遮罩文案：有落点就报出分组名——用户得先知道「会落在哪」。 */
const dropTargetLabel = computed(() => {
  if (!dropHover.value) return ''
  return dropHover.value.split('/').pop() ?? dropHover.value
})

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

// 换分组即换内容：主区回到卷首。留着旧滚动位置的话，从长列表底部切进小分组会落在
// 一片空白上，像「什么都没发生」。拖动排序中不动（正在编辑的序列位置就是上下文）。
watch(
  () => library.selectedFolder,
  () => {
    if (!arranging.value) mainRef.value?.scrollTo({ top: 0 })
  },
)

// 拖动排序中若可见集被外部侥幸改动（如磁盘变化），干净退出避免把过期序列写回。
watch(
  () => library.files.map((f) => f.relativePath).sort().join('\u0001'),
  (next, prev) => {
    if (arranging.value && next !== prev) {
      finishArrange()
    }
  },
)

// —— 侧栏宽度：拖右缘调整 ——
//
// 拖动过程只改本地 draft（即时跟手、不写盘），松手才落进设置——否则每一帧都过
// 一次防抖写盘，且会把中间态写进 settings.json。双击手柄复位成默认宽度。
const widthDraft = ref<number | null>(null)
const sidebarWidth = computed(() => widthDraft.value ?? settings.sidebarWidth)
const sidebarStyle = computed(() => ({ width: `${sidebarWidth.value}px` }))

function onResizeStart(e: PointerEvent) {
  const startX = e.clientX
  const startWidth = sidebarWidth.value
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)

  const onMove = (m: PointerEvent) => {
    widthDraft.value = clampSidebarWidth(startWidth + (m.clientX - startX))
  }
  const onUp = () => {
    el.releasePointerCapture?.(e.pointerId)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const settled = widthDraft.value
    widthDraft.value = null
    if (settled !== null) settings.update({ sidebarWidth: settled })
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/** 双击复位：拖窄了想回默认，不必再对着像素找位置。 */
function resetSidebarWidth() {
  widthDraft.value = null
  settings.update({ sidebarWidth: DEFAULT_SETTINGS.sidebarWidth })
}

onMounted(() => {
  library.refresh()
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('keydown', onGlobalKey)
})

onBeforeUnmount(() => {
  if (drag.value) cancelDrag()
  if (arrivalTimer) clearTimeout(arrivalTimer)
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
        ref="sidebarRef"
        class="sidebar relative hidden h-full shrink-0 overflow-y-auto p-3 transition-opacity duration-300 md:block"
        :class="arranging ? 'pointer-events-none opacity-40' : ''"
        :style="sidebarStyle"
      >
        <!-- 侧栏的排版契约在 motion.css 里：书库行、区带标题、树行共用同一条
             三列栅格（折页槽 · 文字列 · 尾列），故「书库」二字、区带标题与分组名
             必然落在同一条竖线上——对齐靠栅格，不靠逐个调间距。 -->
        <nav aria-label="书库导航" class="flex flex-col">
          <!-- 区带一 · 书库（根视图）。它是**一块可点中的地面**，不是树的条目：
               不带折页（那会让人以为折页控制的是它自己），靠书架图标 + 14px 字表态。
               回到书库根由此一条明路解决，故底部不再挂「回到书库」按钮。 -->
          <button
            class="side-row side-row-root"
            :class="!library.selectedFolder ? 'side-row-on' : ''"
            :title="COPY.scopeBack"
            @click="backToLibrary"
          >
            <span class="side-cv">
              <ZIcon name="library" :size="16" class="side-root-icon" />
            </span>
            <span class="side-name side-title truncate">{{ COPY.library }}</span>
            <span class="side-fill"></span>
            <span class="side-count" :class="!library.selectedFolder ? 'text-ink-soft' : ''">
              {{ library.totalCount }}
            </span>
          </button>

          <!-- 区带二 · 分组。区带标题与条目同栅格、同起笔线，只是矮一档、小一号：
               它是标签而非条目，故不与下面的分组名争重心。收起整棵树的折页挂在这里
               （全收是对整区做的事），新建的 ＋ 落在尾列。 -->
          <div class="side-section">
            <div class="side-head">
              <button
                v-if="library.folderTree.length"
                type="button"
                class="side-cv side-head-toggle"
                :title="rootExpanded ? COPY.folderCollapseAll : COPY.folderExpandAll"
                :aria-label="rootExpanded ? COPY.folderCollapseAll : COPY.folderExpandAll"
                :aria-expanded="rootExpanded"
                @click="toggleRoot"
              >
                <ZIcon name="chevron-down" :size="12" :stroke-width="1.4" class="folder-chevron" />
              </button>
              <span v-else class="side-cv"></span>
              <h2 class="side-name side-title truncate">{{ COPY.groupSection }}</h2>
              <button
                v-if="!creating"
                type="button"
                class="side-head-action"
                :title="COPY.newFolder"
                :aria-label="COPY.newFolder"
                @click="startCreating"
              >
                <ZIcon name="plus" :size="15" :stroke-width="1.4" />
              </button>
            </div>

          <div v-if="creating" class="side-form">
            <!-- 落点由当前选中分组暗定；不说出来就一定会有人建错层 -->
            <p class="text-[11px] leading-snug text-ink-soft/85">
              {{ COPY.newFolderUnder }}
              <span class="text-ink-soft">{{ newFolderParentLabel }}</span>
            </p>
            <input
              ref="newFolderInput"
              v-model="newFolderName"
              :placeholder="COPY.folderName"
              :aria-invalid="!!newFolderError"
              class="w-full rounded-lg bg-paper-deep/60 px-2.5 py-1.5 text-sm text-ink caret-bamboo outline-none placeholder:text-dusk transition-colors focus:bg-paper-deep"
              @keydown.enter="submitFolder"
              @keydown.esc="cancelCreating"
              @input="onFolderNameInput"
            />
            <!-- 非法名说清缘由：按钮不禁用——禁用不解释「为什么点不动」 -->
            <p v-if="newFolderError" class="text-[11px] text-sandal">
              {{ newFolderError }}
            </p>
            <div class="flex gap-1.5">
              <button
                class="side-form-btn bg-bamboo text-paper hover:opacity-90 disabled:opacity-40"
                :disabled="!canCreate()"
                @click="submitFolder"
              >
                {{ COPY.save }}
              </button>
              <button
                class="side-form-btn text-ink-soft hover:bg-bamboo/10 hover:text-ink"
                @click="cancelCreating"
              >
                {{ COPY.cancel }}
              </button>
            </div>
          </div>

          <FolderTree
            v-if="library.folderTree.length"
            :rows="folderRows"
            :selected="library.selectedFolder"
            :expanded="expanded"
            :open="rootExpanded"
            :dropping="dropDragging"
            :drop-hover="dropHover"
            :active-path="activeRowPath"
            :renaming="renamePath"
            :rename-draft="renameDraft"
            :rename-error="renameError"
            :dragging-folder="folderDrag?.path ?? ''"
            :drag-over="folderDragOver ?? undefined"
            :swallow-click="swallowRowClick()"
            @select="onFolderSelect"
            @toggle="onFolderToggle"
            @menu="openFolderMenu"
            @remove="onRowRemove"
            @keydown="onRowKeydown"
            @focus-row="focusedFolder = $event"
            @drop-hover="dropHover = $event"
            @drop-leave="dropHover = ''"
            @rename-input="onRenameInput"
            @rename-commit="commitRename"
            @rename-cancel="cancelRename"
            @row-pointer-down="onRowPointerDown"
          />
          <p
            v-else
            class="flex flex-col items-center px-2.5 py-4 text-xs text-dusk"
          >
            <span class="zen-breathe h-1.5 w-1.5 rounded-full bg-dusk/60"></span>
            <span class="mt-3">{{ COPY.emptyFolders }}</span>
          </p>
        </div>

        <!-- 导入落点提示：新卷落在哪个分组里，原来的侧栏无从知道 -->
        <Transition name="fade-slide">
          <button
            v-if="arrival"
            class="side-row mt-1.5 border border-bamboo/25 bg-bamboo/10 text-xs text-ink-soft hover:text-ink"
            @click="gotoArrival"
          >
            <span class="side-cv">
              <span class="zen-breathe h-1.5 w-1.5 rounded-full bg-bamboo/70"></span>
            </span>
            <span class="min-w-0 truncate text-left">
              {{ arrivalText }} {{ arrivalLabel }}
            </span>
            <ZIcon name="chevron-right" :size="12" class="justify-self-end text-dusk" />
          </button>
        </Transition>
        </nav>

        <!-- 宽度手柄：贴在侧栏右缘的一条窄带，平时隐形、悬停才浮出一根竹色细线。
             拖动排序中整栏已 pointer-events-none，手柄随之失效——那会儿宽度不是重点。 -->
        <div
          class="sidebar-resize"
          role="separator"
          aria-orientation="vertical"
          :aria-label="COPY.sidebarWidth"
          :aria-valuenow="sidebarWidth"
          :aria-valuemin="SIDEBAR_MIN"
          :aria-valuemax="SIDEBAR_MAX"
          tabindex="0"
          :title="COPY.sidebarWidthHint"
          @pointerdown.prevent="onResizeStart"
          @dblclick="resetSidebarWidth"
          @keydown.left.prevent="settings.update({ sidebarWidth: clampSidebarWidth(sidebarWidth - 16) })"
          @keydown.right.prevent="settings.update({ sidebarWidth: clampSidebarWidth(sidebarWidth + 16) })"
        ></div>
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
              @click="backToLibrary"
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
                @click="selectFolder(c.path)"
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
      <!-- 重命名：分组名与路径都是本地操作，是这一区里最常用的一项，故排在最前。 -->
      <button
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
        @click="startRename(folderMenu.path)"
      >
        <ZIcon name="edit" :size="15" class="shrink-0 text-bamboo" />
        {{ COPY.renameFolder }}
      </button>
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
              {{ dropTargetLabel ? `${COPY.dropToNamed}「${dropTargetLabel}」` : COPY.dropToImport }}
            </p>
            <p class="mt-1 text-xs text-dusk">
              {{
                dropTargetLabel
                  ? `${COPY.importTo}${dropTargetLabel}`
                  : COPY.importExtHint
              }}
            </p>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 读屏活口：禁用态的元素收不到 tooltip、Toast 又常常一闪而过，
         把「为什么不能做」这句话单独留个通道。 -->
    <p class="sr-only" role="status" aria-live="polite">{{ ariaMessage }}</p>
  </div>
</template>
