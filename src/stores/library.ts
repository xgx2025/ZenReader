import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { nativeFs, isTauri } from '@/lib/native'
import { deleteDocumentNotes, moveDocumentNotes, renameFolderNotes } from '@/lib/notesApi'
import {
  docFormatOf,
  isHtmlFile,
  isPathInFolder,
  resolveHtmlTitle,
  resolveTitle,
  rewritePathPrefix,
  vaultFile,
} from '@/lib/vault'
import { renderMarkdown } from '@/lib/markdown/parser'
import { parseFrontmatter } from '@/lib/markdown/frontmatter'
import { countWords, computeReadingTime, makeExcerpt } from '@/lib/markdown/structure'
import { extractHtmlText, extractHtmlTitle } from '@/lib/html/text'
import { useSettingsStore } from '@/stores/settings'
import { useProgressStore } from '@/stores/progress'
import { useToast } from '@/composables/useToast'
import { COPY } from '@/lib/copy'
import {
  buildFolderTree,
  collectFolderPaths,
  findNode,
  folderScope as scopeOf,
  inFolderScope,
  mergeFolderOrder,
  type FolderScope,
} from '@/lib/folderTree'
import { customRank, mergeVisibleMove, reconcileCustomOrder } from '@/lib/arrange'
import {
  flushArrange,
  loadArrange,
  scheduleSaveArrange,
  wireArrangeFlush,
} from '@/lib/arrangeStorage'
import {
  resolveDisplayMode,
  type ArrangePersisted,
  type ArrangeSortMode,
  type DisplayMode,
} from '@/types/arrange'
import type { FormatFilter, VaultFile, FolderNode } from '@/types/document'

/** Progressive-index metadata for a single file, filled in lazily. */
export interface IndexedMeta {
  title: string
  excerpt: string
  /** 全文纯文本，仅驻内存供书库全文搜索（不持久化）。 */
  fullText: string
  wordCount: number
  readingTime: number
  /** 索引时的文件修改时间：刷新时相同则沿用，不再重复解析。 */
  mtime: number
}

export const useLibraryStore = defineStore('library', () => {
  const settings = useSettingsStore()

  const files = ref<VaultFile[]>([])
  /** Directory paths (relative), including empty folders. */
  const dirs = ref<string[]>([])
  /** Lazy per-file metadata, keyed by relativePath. */
  const index = ref<Record<string, IndexedMeta>>({})
  const search = ref('')
  const selectedFolder = ref('')
  /** 卷式筛选（全部/md/html）；与 search 同为会话态，不落盘。 */
  const formatFilter = ref<FormatFilter>('all')
  const loading = ref(false)

  // —— 拖动排序（手动排布）：展示顺序的状态 + 持久化接线 ——
  const customOrder = ref<string[]>([])
  /** 分组顺序：用户排过的分组路径全序；缺席的按名字序补位。 */
  const folderOrder = ref<string[]>([])
  const arranged = ref(false)
  const sortPreference = ref<ArrangeSortMode>('auto')
  /** 最近一次 refresh 到达的新卷（拖动排序中供淡「新」标；refresh 即刷新）。 */
  const latestArrivals = ref<string[]>([])

  /** 当前生效展示档：auto → 有排布则自定义序，否则最近修改。 */
  const displayMode = computed<DisplayMode>(() =>
    resolveDisplayMode(sortPreference.value, arranged.value),
  )

  wireArrangeFlush()

  /** 本次会话已 hydrate 的 vaultPath（守卫：同库反复 refresh 不重复读盘）。 */
  let hydrateKey = ''

  function arrangePayload(): ArrangePersisted | null {
    const vault = settings.vaultPath
    if (!vault) return null
    return {
      vaultPath: vault,
      customOrder: customOrder.value,
      folderOrder: folderOrder.value,
      arranged: arranged.value,
      sortPreference: sortPreference.value,
    }
  }

  function saveArrangeSoon(): void {
    const p = arrangePayload()
    if (p) scheduleSaveArrange(p)
  }

  /** 把拖动排序态重置为干净默认（清库 / 读库失败时）。 */
  function resetArrange(): void {
    customOrder.value = []
    folderOrder.value = []
    arranged.value = false
    sortPreference.value = 'auto'
    latestArrivals.value = []
  }

  let indexGen = 0

  const hasVault = computed(() => settings.vaultPath.length > 0)

  const totalCount = computed(() => files.value.length)

  /**
   * 卷式过滤后的全库列表。`filtered` 的第一道谓词（最廉，先过一遍），
   * 也作范围提示行的基准——数字要与用户接下来看到的一致。
   */
  const formatFiltered = computed<VaultFile[]>(() => {
    if (formatFilter.value === 'all') return files.value
    const want = formatFilter.value
    return files.value.filter((f) => docFormatOf(f.name) === want)
  })

  const filtered = computed<VaultFile[]>(() => {
    let list = formatFiltered.value

    // 分组分支需要先知道是否在寻词，故 q 提到它之前算。
    const q = search.value.trim().toLowerCase()

    // 寻词即递归，否则下钻到本层。空路径（书库根）恒真——根就是整个书库，保持全量。
    if (selectedFolder.value) {
      const folder = selectedFolder.value
      list = list.filter((f) => inFolderScope(f.relativePath, folder, !!q))
    }

    if (q) {
      list = list.filter((f) => {
        const meta = index.value[f.relativePath]
        const title = meta?.title ?? resolveTitle({}, f.name)
        return (
          title.toLowerCase().includes(q) ||
          (meta?.excerpt ?? '').toLowerCase().includes(q) ||
          // 全文检索：中后部内容同样可寻。
          (meta?.fullText ?? '').toLowerCase().includes(q)
        )
      })
    }

    return [...list].sort((a, b) => {
      if (displayMode.value === 'custom') {
        // 自定义序为全序；rank 相等（防御性 unknown）再按 mtime 兜底防闪动。
        const rank = customRank(customOrder.value)
        return rank(a.relativePath) - rank(b.relativePath) || b.mtime - a.mtime
      }
      if (displayMode.value === 'title') {
        const ta = index.value[a.relativePath]?.title ?? resolveTitle({}, a.name)
        const tb = index.value[b.relativePath]?.title ?? resolveTitle({}, b.name)
        return ta.localeCompare(tb, 'zh')
      }
      return b.mtime - a.mtime
    })
  })

  /**
   * 侧栏分组树。按**卷式过滤后**的列表建树——侧栏数字必须与右侧所见同源，否则
   * 「卷式选 html，侧栏却还在数 md」会当场自相矛盾（分组与空目录仍全额保留）。
   */
  const folderTree = computed<FolderNode[]>(() =>
    buildFolderTree(formatFiltered.value, dirs.value, folderOrder.value),
  )

  /** Every folder path in the vault, flattened (for "move to" picking). */
  const flatFolders = computed<string[]>(() => collectFolderPaths(folderTree.value))

  /** 当前选中分组的子分组（无选中或无子分组时为空）——空态文案据它分辨「本层空」。 */
  const selectedChildren = computed<FolderNode[]>(
    () => findNode(folderTree.value, selectedFolder.value)?.children ?? [],
  )

  /**
   * 当前分组的作用域拆分（本层 / 子树其余），按卷式过滤但**不受寻词影响**——
   * 提示行的职责是解释「下钻后另外那些卷去哪了」，寻词时列表本就递归，无需解释。
   */
  const folderScope = computed<FolderScope>(() =>
    selectedFolder.value
      ? scopeOf(formatFiltered.value, selectedFolder.value)
      : { here: 0, below: 0 },
  )

  async function refresh() {
    if (!hasVault.value) {
      files.value = []
      dirs.value = []
      index.value = {}
      resetArrange()
      hydrateKey = '' // 清库后重开同一库也要重新读盘，不能沿用内存残留
      return
    }
    loading.value = true
    const path = settings.vaultPath
    try {
      const listing = await nativeFs.readVault(path)
      if (settings.vaultPath !== path) return // 读盘期间已换库/清库：丢弃这次结果
      // HTML 原样式直读的 zenasset:// 资产按"活跃书库根"收敛——开库/刷新即上报
      // 一次（fire-and-forget 兜底；reader.open 每次打开也防御性上报）。浏览器 dev 空操作。
      if (isTauri()) void nativeFs.setActiveVault(path).catch(() => {})
      // 首次开库：从 .zenreader/arrange.json 载入该库自定义序（浏览器 dev 退化读
      // localStorage）。此后同库反复 refresh 沿用内存态——文件只是重启后的入口，
      // 刷新途中不重复读盘，也不让旧文件盖掉刚排好还没落盘的新序。
      if (hydrateKey !== path) {
        hydrateKey = path
        const p = await loadArrange(path)
        if (settings.vaultPath !== path) return // 载序期间换库：等新库自己的 refresh
        customOrder.value = p?.customOrder ?? []
        folderOrder.value = p?.folderOrder ?? []
        arranged.value = p?.arranged ?? false
        sortPreference.value = p?.sortPreference ?? 'auto'
      }
      const prevPaths = new Set(files.value.map((f) => f.relativePath))
      files.value = listing.files
      dirs.value = listing.dirs
      // 自定义序与新一轮磁盘内容对齐：剪除已失卷、rename 保位、新卷立于最前。
      const { order, arrivals } = reconcileCustomOrder(
        customOrder.value,
        listing.files,
        prevPaths,
      )
      customOrder.value = order
      latestArrivals.value = arrivals
      saveArrangeSoon()
      // 增量索引：只清掉已消失的文件，未变更者沿用旧索引——
      // 窗口聚焦等频繁刷新不再让卡片元信息闪烁。
      const live = new Set(listing.files.map((f) => f.relativePath))
      for (const key of Object.keys(index.value)) {
        if (!live.has(key)) delete index.value[key]
      }
      indexVault(listing.files)
    } catch (e) {
      console.error('[zenreader] read_vault failed', e)
      files.value = []
      dirs.value = []
      resetArrange()
      hydrateKey = '' // 重试时重新读盘，不沿用残缺内存态
      // 读库失败不再静默成「尚无书籍」，轻声告知用户原因。
      useToast().notify(COPY.vaultReadFailed, 'sandal')
    } finally {
      loading.value = false
    }
  }

  async function openVault() {
    const dir = await nativeFs.pickFolder()
    if (!dir) return
    settings.setVaultPath(dir)
    await refresh()
  }

  /** 用户显式点排序胶囊某档（非 auto）——记住该档。 */
  function setSort(mode: Exclude<ArrangeSortMode, 'auto'>) {
    sortPreference.value = mode
    saveArrangeSoon()
  }

  /**
   * 首次拖动排序把基线钉成当前默认序（最近修改降序快照）。未产生任何 drop 前不改
   * `arranged`——因此"光进拖动排序不改动"不会把默认偷换成自定义序。
   */
  function seedDefaultOrder(): void {
    if (arranged.value) return
    customOrder.value = [...files.value]
      .sort((a, b) => b.mtime - a.mtime)
      .map((f) => f.relativePath)
  }

  /**
   * 提交一次"可见子序列内的单卡位移"回全库自定义序。无实际变化（no-op）不置 arranged，
   * 不算一次有效排布。
   */
  function commitVisibleMove(movedPath: string, newVisibleOrder: string[]): void {
    const next = mergeVisibleMove(customOrder.value, newVisibleOrder, movedPath)
    if (!next) return
    customOrder.value = next
    arranged.value = true
    sortPreference.value = 'auto' // 排布后即默认
    saveArrangeSoon()
  }

  /** Create a real directory (分组) inside the vault, then rescan. */
  async function createFolder(name: string) {
    const clean = name.trim()
    if (!clean || clean.includes('/') || clean.includes('\\')) return
    const parent = selectedFolder.value
    return createFolderAt(parent ? `${parent}/${clean}` : clean)
  }

  /**
   * 按**相对路径**建目录（取消选中无关的中间层）。新建分组的落点是当前选中分组，
   * 「撤销释怀」也要把分组放回原位——两处都只认路径，故不必先改选中态。
   */
  async function createFolderAt(relativePath: string) {
    const clean = relativePath.replace(/^\/+|\/+$/g, '')
    if (!clean) return
    await nativeFs.createDir(vaultFile(settings.vaultPath, clean))
    await refresh()
  }

  /**
   * Delete an empty 分组 (only empty folders can be 释怀). Refuses folders
   * that still hold any files — the error surfaces as a toast in the view.
   */
  async function removeFolder(relativePath: string) {
    await nativeFs.removeFolder(settings.vaultPath, relativePath)
    // 选中的分组若正是被删的分组（或其下），退回根分组。
    if (
      selectedFolder.value === relativePath ||
      selectedFolder.value.startsWith(`${relativePath}/`)
    ) {
      selectedFolder.value = ''
    }
    await refresh()
  }

  /**
   * 分组改名 / 搬家：改的是磁盘上的目录，同时把四份**按路径存的东西**一起迁走——
   * 觉悟笔记（SQLite，按子树批量换前缀）、阅读进度（localStorage）、卡片自定义序、
   * 分组自身顺序。少迁一份，用户就会看到「改名后笔记没了 / 读到一半的位置丢了」。
   *
   * 前后端分工：后端只认路径、只做校验与盘上操作（拒绝非法路径、搬进自身子树、
   * 目标已存在），本函数负责把数据层的路径一起改写。
   */
  async function renameFolder(from: string, to: string) {
    const cleanFrom = from.replace(/^\/+|\/+$/g, '')
    const cleanTo = to.replace(/^\/+|\/+$/g, '')
    if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return

    await nativeFs.renameDir(settings.vaultPath, cleanFrom, cleanTo)
    // 笔记批量迁前缀。失败不该让整次改名回滚（目录已经搬了），但要让调用方知道
    // 数据可能没跟上——故不吞异常，交给上层提示。
    await renameFolderNotes(settings.vaultPath, cleanFrom, cleanTo)
    useProgressStore().moveFolder(cleanFrom, cleanTo)

    customOrder.value = customOrder.value.map((p) =>
      rewritePathPrefix(p, cleanFrom, cleanTo),
    )
    folderOrder.value = folderOrder.value.map((p) =>
      rewritePathPrefix(p, cleanFrom, cleanTo),
    )
    // 选中态与展开态都指向旧路径，一并改写；否则主区会瞬间跳回书库。
    if (isPathInFolder(selectedFolder.value, cleanFrom)) {
      selectedFolder.value = rewritePathPrefix(selectedFolder.value, cleanFrom, cleanTo)
    }
    saveArrangeSoon()
    await refresh()
  }

  /**
   * 提交一次分组排序：`parents` 是「父分组路径 → 该父下子分组的完整显示序」。
   * 存储里是全局全序，故经 `mergeFolderOrder` 重建一次。
   */
  function commitFolderOrder(parents: Map<string, string[]>) {
    const next = mergeFolderOrder(folderOrder.value, parents)
    if (!next) return
    folderOrder.value = next
    saveArrangeSoon()
  }

  /** 把分组顺序恢复为名字序（设置面板 / 将来的「恢复默认」用）。 */
  function resetFolderOrder() {
    if (!folderOrder.value.length) return
    folderOrder.value = []
    saveArrangeSoon()
  }

  /** Move a document's file on disk, migrating its notes to the new path. */
  async function moveDocument(from: string, to: string) {
    await nativeFs.moveFile(
      vaultFile(settings.vaultPath, from),
      vaultFile(settings.vaultPath, to),
    )
    await moveDocumentNotes(settings.vaultPath, from, to)
    useProgressStore().move(from, to) // reading position follows the file
    await refresh()
  }

  /** Delete a document's file on disk, dropping its notes + progress. */
  async function removeDocument(relativePath: string) {
    await nativeFs.deleteFile(vaultFile(settings.vaultPath, relativePath))
    await deleteDocumentNotes(settings.vaultPath, relativePath)
    useProgressStore().drop(relativePath)
    await refresh()
  }

  /** Parse files one-by-one in the background, filling `index` as it goes. */
  async function indexVault(list: VaultFile[]) {
    const gen = ++indexGen
    for (const f of list) {
      if (gen !== indexGen) return // superseded by a newer refresh
      // mtime 未变即内容未变，直接沿用已有索引。
      if (index.value[f.relativePath]?.mtime === f.mtime) continue
      try {
        const isHtml = isHtmlFile(f.name)
        const source = isHtml
          ? await nativeFs.readHtml(f.path) // GBK/meta-charset 感知
          : await nativeFs.readFile(f.path)
        // .html 的"正文"来自 DOMParser 静态抽取——脚本不执行，索引安全；
        // .md 仍走 frontmatter + markdown-it 渲染。标题规则统一落到
        // titleFromName / resolveHtmlTitle（前文 vault 单测覆盖）。
        const fm = isHtml ? { data: {}, content: source } : parseFrontmatter(source)
        const plainText = isHtml
          ? extractHtmlText(source)
          : renderMarkdown(fm.content).plainText
        const wordCount = countWords(plainText)
        index.value[f.relativePath] = {
          title: isHtml
            ? resolveHtmlTitle(extractHtmlTitle(source), f.name)
            : resolveTitle(fm.data, f.name),
          excerpt: makeExcerpt(plainText),
          fullText: plainText,
          wordCount,
          readingTime: computeReadingTime(wordCount),
          mtime: f.mtime,
        }
      } catch {
        // leave unindexed; the card falls back to the file name
      }
      // Yield so the UI stays responsive during a large scan.
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  return {
    files,
    index,
    search,
    selectedFolder,
    formatFilter,
    loading,
    hasVault,
    totalCount,
    filtered,
    folderTree,
    flatFolders,
    selectedChildren,
    folderScope,
    // 拖动排序（手动排布）
    displayMode,
    customOrder,
    folderOrder,
    arranged,
    sortPreference,
    latestArrivals,
    setSort,
    seedDefaultOrder,
    commitVisibleMove,
    commitFolderOrder,
    resetFolderOrder,
    flushArrange,
    refresh,
    openVault,
    createFolder,
    createFolderAt,
    removeFolder,
    renameFolder,
    moveDocument,
    removeDocument,
  }
})
