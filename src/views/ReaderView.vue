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
import type { IconName } from '@/components/common/ZIcon.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import SelectionToolbar from '@/components/reader/SelectionToolbar.vue'
import ImageViewer from '@/components/reader/ImageViewer.vue'
import IncenseControl from '@/components/reader/IncenseControl.vue'
import InsightComposer from '@/components/notes/InsightComposer.vue'
import NotesPanel from '@/components/notes/NotesPanel.vue'
import ShortcutSheet from '@/components/reader/ShortcutSheet.vue'

import {
  applyAnchors,
  locateQuoteOffset,
  type AppliedAnchor,
} from '@/lib/anchor/textAnchor'
import { highlightCodeBlocks } from '@/lib/markdown/highlight'
import { renderMermaidBlocks, mermaidSvgSnapshot } from '@/lib/markdown/mermaid'
import { wireCodeCopy } from '@/lib/markdown/codeCopy'
import { extractStructure } from '@/lib/markdown/structure'
import { useSelectionAnchor } from '@/composables/useSelectionAnchor'
import { useReadingScroll } from '@/composables/useReadingScroll'
import {
  useHtmlReader,
  type HtmlReaderSelection,
} from '@/composables/useHtmlReader'
import type { OutlineItem, ScrollInfo } from '@/lib/html/protocol'
import { useFullscreen } from '@/composables/useFullscreen'
import { useReaderStore } from '@/stores/reader'
import { useNotesStore } from '@/stores/notes'
import { useSettingsStore } from '@/stores/settings'
import { useProgressStore } from '@/stores/progress'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import { useToast } from '@/composables/useToast'
import { COPY } from '@/lib/copy'
import { isTauri, openExternal } from '@/lib/native'
import { resolveDocLink } from '@/lib/vault'
import { playZenEnterChime } from '@/lib/chime'
import ZenMotes from '@/components/reader/ZenMotes.vue'
import {
  ZEN_RITUAL_COMPONENTS,
  resolveZenEntry,
  type ZenRitualKey,
} from '@/components/reader/zenRituals'
import type { HighlightAnchor, Note } from '@/types/note'
import type { ThemeName } from '@/types/settings'
import { FINISHED_RATIO, RESUME_MIN_RATIO } from '@/types/progress'

const route = useRoute()
const router = useRouter()
const reader = useReaderStore()
const notesStore = useNotesStore()
const settings = useSettingsStore()
const progressStore = useProgressStore()
const { openPanel } = useSettingsPanel()
const { isFullscreen, toggle: toggleFullscreen, setZen } = useFullscreen()

const proseEl = ref<HTMLElement | null>(null)
/** 正文纯文本快照（innerHTML 落定后即取）：供笔记按引文原文先后排序，与高亮定位同源。 */
const proseText = ref('')
const { capture, visible, dismiss } = useSelectionAnchor(proseEl)
const { notify } = useToast()

const showToc = ref(false)
const showNotes = ref(false)
const showShortcuts = ref(false)
const activeNoteId = ref<string | null>(null)

interface ComposerState {
  quote: string
  initial: string
  title: string
  noteId: string | null
  anchor: HighlightAnchor | null
}
const composer = ref<ComposerState | null>(null)
const composerOpen = computed(() => composer.value !== null)

/** 续读 hint - fades away shortly after restoring a position. */
const showResumeHint = ref(false)
/** Guards progress recording while a document switch is in flight. */
const restoring = ref(false)

const doc = computed(() => reader.current)
const structure = computed(() =>
  doc.value ? extractStructure(doc.value.html) : { toc: [], hasCodeBlocks: false },
)
const toc = computed(() => structure.value.toc)
const headingIds = computed(() => toc.value.map((t) => t.id))

// 窗口标题随书名走：任务栏 / Alt+Tab 一眼可见正在读哪卷。
watch(
  doc,
  (d) => {
    document.title = d ? `${d.title} · ${COPY.appName}` : COPY.appTitle
  },
  { immediate: true },
)

function onScrollProgress(ratio: number) {
  const d = reader.current
  if (!d || restoring.value) return
  progressStore.record(d.relativePath, d.sourceHash, ratio)
}

/** Live progress for the thin top bar (0-100). */
const progressPct = computed(() => {
  const d = reader.current
  if (!d) return 0
  const e = progressStore.get(d.relativePath)
  return e ? Math.round(Math.min(1, Math.max(0, e.ratio)) * 100) : 0
})

const {
  containerRef,
  activeHeadingId,
  toolbarHidden,
  scrollTopPx,
  scrollByFraction,
  scrollToHeading: scrollToHeadingEl,
  restoreRatio,
} = useReadingScroll(headingIds, onScrollProgress)

/** 行至半卷（约 1.5 屏）后方浮现的回到卷首。 */
const showBackTop = computed(() => scrollTopPx.value > window.innerHeight * 1.5)

/** 图片灯箱：正文 img 点击后的放大查看。 */
const viewerSrc = ref<string | null>(null)
/** mermaid 图灯箱：图卡内 SVG 快照 + 宽高比（mermaidSvgSnapshot 产物）。 */
const viewerSvg = ref<{ html: string; ratio: number } | null>(null)

/** 收起灯箱：图片与 mermaid 两个分支共用。 */
function closeViewer() {
  viewerSrc.value = null
  viewerSvg.value = null
}

/** 平滑滚到卷首 / 卷尾（Home / End / 回到卷首共用）。html 时滚的是沙箱帧。 */
function scrollToEdge(edge: 'top' | 'bottom') {
  if (isHtml.value) {
    html.scrollEdge(edge)
    return
  }
  const el = containerRef.value
  if (!el) return
  el.scrollTo({ top: edge === 'top' ? 0 : el.scrollHeight, behavior: 'smooth' })
}

/**
 * 字号按钮。md：改正文字号。html：退化为整页 zoom（±0.1，0.6–1.6 封顶）——
 * 帧内容按文档自身 px 排版，改字号不可行，缩放才是"看得更舒服"的等价手段。
 */
function stepFont(delta: number) {
  if (isHtml.value) {
    const base = html.zoom.value + (delta > 0 ? 0.1 : -0.1)
    html.setZoomBy(base)
  } else {
    bumpFont(delta)
  }
}
const anchors = computed<AppliedAnchor[]>(() =>
  notesStore.notes
    .filter((n): n is Note & { anchor: HighlightAnchor } => n.anchor !== null)
    .map((n) => ({ noteId: n.id, anchor: n.anchor })),
)

// ─────────────────────────────────────────────────────────────────────────────
// HTML 原样式直读（沙箱 iframe）。只有 .html/.htm 走到这套——md 的阅读路径不触碰
// 下面任何标识符：isHtml 由 doc.format 判定，换卷即整体复位，互不污染。
// ─────────────────────────────────────────────────────────────────────────────
const isHtml = computed(() => doc.value?.format === 'html')

/**
 * 沉浸式浮条高度（px）：同时是 agent 注入到文档顶部的起始留白，让文章起点
 * 对齐在玻璃条下沿。与模板 h-14 / 面板 mt-14 同值，改动时三处需同步。
 */
const HTML_BAR_H = 56

/** 阅读滚动键（窗口冒进 html 模式时也拦默认，交给帧侧语义统一滚）。 */
const HTML_SCROLL_KEYS = new Set([
  ' ',
  'j',
  'k',
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageDown',
  'PageUp',
])

/** 沙箱 iframe：`sandbox="allow-scripts"` 且**无** allow-same-origin → 不透明源，
 *  文档自有 JS 够不到应用源/Tauri IPC；正文原样式直读、自带滚动。 */
const htmlFrameEl = ref<HTMLIFrameElement | null>(null)
/** 帧内扫出的目录（OutlineItem）→ 合成 TOC 侧栏项（id = `zhh-{i}`，宿主自持）。 */
const htmlOutline = ref<OutlineItem[]>([])
const htmlToc = computed(() =>
  htmlOutline.value.map((o, i) => ({ ...o, id: `zhh-${i}` })),
)
/** TOC 侧栏数据源：md 用 toc、html 用 htmlToc，结构同型。 */
const tocItems = computed(() => (isHtml.value ? htmlToc.value : toc.value))
/** 帧内当前目录下标（agent 布局判定，-1 = 首段之前）。 */
const htmlActiveIndex = ref(-1)
/** 帧内滚动 y（px）→ 回到卷首按钮去留。 */
const htmlScrollY = ref(0)
const htmlToolbarHidden = ref(false)
const htmlShowBackTop = computed(
  () => htmlScrollY.value > window.innerHeight * 1.5,
)
const htmlZoomPct = ref(100)
/** 帧内划词（已换算成父坐标）→ 复用现有浮动条 / composer。 */
const htmlSel = ref<HtmlReaderSelection | null>(null)
const htmlSelVisible = ref(false)
/** 续读须等帧布局就绪（evt.ready）才能发 scrollToRatio——先攒着，ready 后兑现。 */
const htmlResumeRatio = ref<number | null>(null)
let htmlResumeTimer: ReturnType<typeof setTimeout> | null = null
let htmlLastY = 0

/** 顶栏去留：md 由容器滚动判定，html 由帧内滚动判定。
 *  注意：computed 不解包 getter 返回的 ref——此处必须取 .value 解成布尔，
 *  否则 headerHidden 恒为 truthy，顶栏永远被 -translate-y-full 抬出屏外。 */
const headerHidden = computed(() =>
  isHtml.value ? htmlToolbarHidden.value : toolbarHidden.value,
)

/**
 * 顶栏外观：md 的条在文档流内；html 则浮出流外、固定悬浮在文档上方——
 * 正文 iframe 铺满整窗、从半透明毛玻璃条下掠过（沉浸式）。高度锁 h-14
 * （56px），与面板让位的 mt-14 / 玻璃条自身同值对齐，改动时需同步。
 */
const headerBarClass = computed<string[]>(() => {
  const move = headerHidden.value ? '-translate-y-full' : 'translate-y-0'
  const glide = 'transition-transform duration-400 ease-[cubic-bezier(0.4,0,0.2,1)]'
  if (isHtml.value) {
    return [
      'html-glass-bar fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between gap-2 px-3',
      glide,
      move,
    ]
  }
  return [
    'header-fade relative z-20 flex shrink-0 items-center justify-between gap-2 bg-paper/55 px-3 py-2.5 backdrop-blur-md',
    glide,
    move,
  ]
})

/** 整批同步高亮：html 帧侧没有"增量包/拆"——发全量，agent 清旧重打。 */
function syncHtmlHighlights() {
  html.applyAnchors(anchors.value)
}

function onHtmlSelection(sel: HtmlReaderSelection | null, crossBlock: boolean) {
  if (crossBlock) {
    htmlSel.value = null
    htmlSelVisible.value = false
    notify(COPY.anchorCrossBlock, 'sandal')
    return
  }
  htmlSel.value = sel
  htmlSelVisible.value = sel !== null
}

function onHtmlScroll(info: ScrollInfo) {
  if (restoring.value) return
  const d = reader.current
  if (d) progressStore.record(d.relativePath, d.sourceHash, info.ratio)
  htmlActiveIndex.value = info.activeIndex
  const item = htmlToc.value[info.activeIndex]
  activeHeadingId.value = item ? item.id : ''
  const y = info.y
  htmlScrollY.value = y
  const delta = info.delta !== 0 ? info.delta : y - htmlLastY
  htmlLastY = y
  // 与 useReadingScroll 同款的藏/露阈值：下滚过 64px 且增量超过抖动才收，回滚即现。
  if (delta > 6 && y > 64) htmlToolbarHidden.value = true
  else if (delta < -6) htmlToolbarHidden.value = false
}

function onHtmlOutline(outline: OutlineItem[]) {
  htmlOutline.value = outline
}

function onHtmlReady() {
  // 先补高亮（帧就绪才可靠）再兑现续读。
  syncHtmlHighlights()
  const ratio = htmlResumeRatio.value
  if (ratio !== null) {
    htmlResumeRatio.value = null
    html.scrollToRatio(ratio)
    showResumeHint.value = true
    setTimeout(() => {
      showResumeHint.value = false
    }, 2600)
  }
  if (htmlResumeTimer) clearTimeout(htmlResumeTimer)
  htmlResumeTimer = null
  // 帧已可用，恢复进度记录（loadDocument 里 restore 一直拦着）。
  restoring.value = false
}

function onHtmlZoom(z: number) {
  htmlZoomPct.value = Math.round(z * 100)
}

function onHtmlOpenDoc(href: string) {
  const base = route.params.path as string | undefined
  const resolved = base ? resolveDocLink(base, href) : null
  if (resolved) void router.push(`/read/${encodeURIComponent(resolved)}`)
}

function onHtmlOpenExternal(url: string) {
  // 帧侧已拦默认、只放 http(s)/mailto——这里再自证一次，过不了就静默。
  if (!/^(?:https?:\/\/|mailto:)/i.test(url)) return
  if (isTauri()) void openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

/** html 模式下一章/上一章：目录项按当前所在项平移，头尾推到卷首/卷尾。 */
function htmlJumpChapter(dir: 1 | -1) {
  const list = htmlToc.value
  if (list.length === 0) {
    html.scrollEdge(dir === 1 ? 'bottom' : 'top')
    return
  }
  const idx = htmlActiveIndex.value
  if (
    (dir === 1 && idx >= list.length - 1) ||
    (dir === -1 && (idx < 0 || idx === 0))
  ) {
    html.scrollEdge(dir === 1 ? 'bottom' : 'top')
    return
  }
  html.scrollToHeading(Math.min(list.length - 1, Math.max(0, idx + dir)))
}

/**
 * 帧内按键（焦点在 iframe 时由 agent 转发而来；或焦点在本页但处于 html 模式时
 * 由 onKeydown 兜底转进）。滚动键要自己滚帧——agent 已 preventDefault 防双滚。
 */
function onHtmlKey(e: { key: string; shiftKey: boolean }) {
  switch (e.key) {
    case 'Escape':
      if (composerOpen.value) composer.value = null
      else if (settings.zenMode) setZen(false)
      else if (showNotes.value) showNotes.value = false
      else if (showToc.value) showToc.value = false
      else if (isFullscreen.value) toggleFullscreen()
      return
    case 'j':
    case 'ArrowDown':
      html.scrollByFraction(0.8)
      return
    case 'k':
    case 'ArrowUp':
      html.scrollByFraction(-0.8)
      return
    case ' ':
      html.scrollByFraction(e.shiftKey ? -0.9 : 0.9)
      return
    case 'ArrowRight':
      htmlJumpChapter(1)
      return
    case 'ArrowLeft':
      htmlJumpChapter(-1)
      return
    case 'PageDown':
      html.scrollByFraction(0.9)
      return
    case 'PageUp':
      html.scrollByFraction(-0.9)
      return
    case 'Home':
      html.scrollEdge('top')
      return
    case 'End':
      html.scrollEdge('bottom')
      return
    case 't':
    case 'T':
      showToc.value = !showToc.value
      return
    case 'n':
    case 'N':
      showNotes.value = !showNotes.value
      return
    case 'z':
    case 'Z':
      setZen(!settings.zenMode)
      return
    case '?':
      showShortcuts.value = !showShortcuts.value
      return
  }
}

/** html 划词建笔记：宿主拿到的 anchor 已换算好，直接落库 + 整批重打高亮。 */
async function onHtmlHighlight() {
  const sel = htmlSel.value
  if (!sel) return
  const note = makeNote(sel.anchor, '', 'highlight')
  try {
    await notesStore.add(note)
    applyNoteAnchor(note.id, sel.anchor)
    htmlSel.value = null
    htmlSelVisible.value = false
  } catch {
    notify(COPY.opFailed, 'sandal')
  }
}

function onHtmlOpenComposer() {
  const sel = htmlSel.value
  if (!sel) return
  composer.value = {
    quote: sel.anchor.quote,
    initial: '',
    title: COPY.selectionNote,
    noteId: null,
    anchor: sel.anchor,
  }
  htmlSel.value = null
  htmlSelVisible.value = false
}

const html = useHtmlReader(htmlFrameEl, {
  onReady: onHtmlReady,
  onScroll: onHtmlScroll,
  onOutline: onHtmlOutline,
  onSelection: onHtmlSelection,
  onOpenDoc: onHtmlOpenDoc,
  onOpenExternal: onHtmlOpenExternal,
  onKey: onHtmlKey,
  onZoom: onHtmlZoom,
})

/** 该笔记引文在正文中的起始偏移；自由笔记（无引文）或定位失败 → -1。 */
function noteDocOffset(n: Note): number {
  const text = proseText.value
  if (!text || !n.anchor) return -1
  return locateQuoteOffset(text, n.anchor)
}

/**
 * 笔记面板按引用文本在原文中的先后排列：能定位到引文的按偏移升序在前；自由笔记与
 * 引文已漂移的垫底、按创建先后。同偏移（如同段连选多笔）以创建先后并列，稳定有序。
 */
const orderedNotes = computed<Note[]>(() => {
  const list = notesStore.notes.slice()
  const group = (p: number) => (p >= 0 ? 0 : 1)
  list.sort((a, b) => {
    const pa = noteDocOffset(a)
    const pb = noteDocOffset(b)
    const ga = group(pa)
    const gb = group(pb)
    if (ga !== gb) return ga - gb
    const byTime =
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
    return pa >= 0 && pb >= 0 ? pa - pb || byTime : byTime
  })
  return list
})

const THEME_CYCLE: ThemeName[] = ['light', 'sepia', 'dark']

/** 三态主题图标：明亮→日、暮色→落日、夜读→月。 */
const THEME_ICON: Record<ThemeName, IconName> = {
  light: 'sun',
  sepia: 'sunset',
  dark: 'moon',
}

// 香已点燃提示（由 IncenseControl 点香时触发）。
const showLitNotice = ref(false)
let litNoticeTimer: ReturnType<typeof setTimeout> | null = null

const litNoticeText = computed(
  () => `${COPY.litNotice} · ${settings.reminder.intervalMinutes}${COPY.minutes}`,
)

function onIncenseIgnited() {
  showLitNotice.value = true
  if (litNoticeTimer) clearTimeout(litNoticeTimer)
  litNoticeTimer = setTimeout(() => {
    showLitNotice.value = false
  }, 2200)
}

/**
 * 入定动画的编排全部在仪式组件（ZenRitualInk / ZenRitualLeaf /
 * ZenRitualIncense，注册表见 zenRituals.ts）内自导自演：组件按时间线
 * 推进，经 stage 事件通知此处让世界逐层退去（1 顶栏化去 → 2 面板隐
 * 去边距舒展 → 3 稳态澄明，各 UI 层的显隐由 ritualStage 门控）。轻触
 * 任意处可跳过；「轻雾」档（或系统减动效）则以一口短雾快速过场。
 */
/** 仪式阶段 0→3：0 世界完整；1 顶栏已化去；2 面板已隐、边距舒展；3 稳态澄明。 */
const ritualStage = ref(0)
const ritualActive = ref(false)
/** 本次入定所选中的仪式（随机档在入定一刻现抽）。 */
const activeRitual = ref<ZenRitualKey>('ink')
/** 出定／速入共用的一口短促纸色雾（zen-out-puff）。 */
const zenPuff = ref(false)
let puffTimer: ReturnType<typeof setTimeout> | null = null

// 持久化恢复 / 热重载 / 从书库返回时已处于禅境：直接落到稳态。
// watch 只响应变化，此时不会触发；若不补这一拍，界面会停在
// "阶段 0"（头栏可见、氛围未起），禅境按钮也会因值不变而失灵。
if (settings.zenMode) ritualStage.value = 3

function prefersReducedMotion() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** 一口短促的雾：出定时过一眼；关掉仪式时作速入过场。 */
function puff() {
  zenPuff.value = true
  if (puffTimer) clearTimeout(puffTimer)
  puffTimer = setTimeout(() => {
    zenPuff.value = false
  }, 700)
}

/** 仪式推进：世界退去一层。 */
function onRitualStage(n: number) {
  ritualStage.value = n
}

/** 轻触任意处：仪式立止，直达稳态。 */
function skipRitual() {
  ritualStage.value = 3
  ritualActive.value = false
}

/** 仪式自终：纱已散尽，卸下覆盖层。 */
function endRitual() {
  ritualActive.value = false
}

watch(
  () => settings.zenMode,
  (zen) => {
    if (zen) {
      if (settings.reminder.chime) playZenEnterChime()
      const style = resolveZenEntry(settings.zenEntry)
      if (style !== 'mist' && !prefersReducedMotion()) {
        activeRitual.value = style
        ritualActive.value = true
      } else {
        ritualStage.value = 3
        puff()
      }
    } else {
      ritualActive.value = false
      ritualStage.value = 0
      puff()
    }
  },
)

// TOC anchors by heading id, so the active one can be kept in view.
const tocItemEls = new Map<string, HTMLElement>()
function setTocItemRef(id: string, el: unknown) {
  if (el instanceof HTMLElement) tocItemEls.set(id, el)
  else tocItemEls.delete(id)
}

watch(activeHeadingId, (id) => {
  if (!id || !showToc.value) return
  tocItemEls.get(id)?.scrollIntoView({ block: 'nearest' })
})

function renderProse() {
  const el = proseEl.value
  if (!el || !doc.value) return
  el.innerHTML = doc.value.html
  // 先于 applyAnchors / mermaid / 高亮取纯文本：引文定位与排序共用同一份"原文"，
  // 后续把代码块换成图卡等改写 DOM 也不会扰动坐标。
  proseText.value = el.textContent ?? ''
  applyAnchors(el, anchors.value)
  // mermaid 先行把 `language-mermaid` 块替换为图卡，shiki 便不会再碰它们。
  renderMermaidBlocks(el, settings.theme)
  highlightCodeBlocks(el, settings.theme)
  wireCodeCopy(el)
}

/**
 * 为一条笔记落标。md：局部只包此条 <mark>（不整篇重建）。html：帧内无"增量"，
 * 走整批重发（agent 清旧重打）；notesStore.add 已在调用前落库，anchors 已含新条。
 */
function applyNoteAnchor(noteId: string, anchor: HighlightAnchor) {
  if (isHtml.value) {
    syncHtmlHighlights()
    return
  }
  const el = proseEl.value
  if (!el) return
  applyAnchors(el, [{ noteId, anchor }])
}

/** 拆掉此条笔记的高亮。md：缝回被分割的文本节点。html：整批重发（去该条）。 */
function removeNoteAnchor(id: string) {
  if (isHtml.value) {
    syncHtmlHighlights()
    return
  }
  const mark = proseEl.value?.querySelector(`mark.hl[data-note-id="${id}"]`)
  if (!mark?.parentNode) return
  const parent = mark.parentNode
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
  parent.removeChild(mark)
  parent.normalize()
}

async function loadDocument() {
  // Vue Router already decodes path params; relativePath may contain `/`.
  const relPath = route.params.path as string
  restoring.value = true
  const loaded = await reader.open(relPath)
  if (!loaded) {
    // 打不开的卷不再无声消失，说明缘由再回书库。
    notify(COPY.docOpenFailed, 'sandal')
    router.replace('/')
    return
  }
  await notesStore.load(relPath)
  await nextTick()

  if (loaded.format === 'html') {
    // HTML 分支：正文在沙箱 iframe 内原样式直读。proseText 用宿主侧静态快照，
    // 使字数/寻词/笔记排序与 md 同源；渲染与滚动都在帧内，续读推迟到
    // evt.ready（布局就绪）再发 scrollToRatio。md 的 renderProse/恢复不适用。
    proseText.value = loaded.plainText
    htmlOutline.value = []
    htmlActiveIndex.value = -1
    htmlScrollY.value = 0
    htmlLastY = 0
    htmlToolbarHidden.value = false
    htmlZoomPct.value = 100 // 新开一页 zoom 复位，字号按钮的 % 不能还挂着上一页的
    activeHeadingId.value = ''
    htmlSel.value = null
    htmlSelVisible.value = false
    const saved = progressStore.get(relPath)
    htmlResumeRatio.value =
      saved &&
      saved.hash === loaded.sourceHash &&
      saved.ratio >= RESUME_MIN_RATIO &&
      saved.ratio < FINISHED_RATIO
        ? saved.ratio
        : null
    html.open(loaded, settings.theme, HTML_BAR_H)
    // 兜底：帧若被页面 CSP 拦下而永不 ready，别把进度记录永久卡死。
    if (htmlResumeTimer) clearTimeout(htmlResumeTimer)
    htmlResumeTimer = setTimeout(() => {
      restoring.value = false
    }, 3000)
    return
  }

  renderProse()
  // Same component instance is reused across documents - reset the surface,
  // then restore the saved position (续读) if the content still matches.
  if (containerRef.value) {
    containerRef.value.scrollTop = 0
    activeHeadingId.value = ''
    toolbarHidden.value = false
    const saved = progressStore.get(relPath)
    if (
      saved &&
      saved.hash === loaded.sourceHash &&
      saved.ratio >= RESUME_MIN_RATIO &&
      saved.ratio < FINISHED_RATIO &&
      restoreRatio(saved.ratio)
    ) {
      showResumeHint.value = true
      setTimeout(() => {
        showResumeHint.value = false
      }, 2600)
    }
  }
  // Let pending scroll events from the previous document drain first.
  setTimeout(() => {
    restoring.value = false
  }, 0)
}

function makeNote(anchor: HighlightAnchor, note: string, kind: Note['kind']): Note {
  const ts = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    relativePath: doc.value!.relativePath,
    kind,
    quote: anchor.quote,
    note,
    anchor,
    createdAt: ts,
    updatedAt: ts,
  }
}

function makeFreeNote(note: string): Note {
  const ts = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    relativePath: doc.value!.relativePath,
    kind: 'free',
    quote: '',
    note,
    anchor: null,
    createdAt: ts,
    updatedAt: ts,
  }
}

async function onHighlight() {
  if (isHtml.value) {
    await onHtmlHighlight()
    return
  }
  const cap = capture.value
  if (!cap) return
  const note = makeNote(cap.anchor, '', 'highlight')
  try {
    await notesStore.add(note)
    applyNoteAnchor(note.id, cap.anchor)
    dismiss()
  } catch {
    notify(COPY.opFailed, 'sandal')
  }
}

function onOpenComposer() {
  if (isHtml.value) {
    onHtmlOpenComposer()
    return
  }
  const cap = capture.value
  if (!cap) return
  composer.value = {
    quote: cap.anchor.quote,
    initial: '',
    title: COPY.selectionNote,
    noteId: null,
    anchor: cap.anchor,
  }
  dismiss()
}

function onEditNote(id: string) {
  const n = notesStore.notes.find((x) => x.id === id)
  if (!n) return
  composer.value = {
    quote: n.quote,
    initial: n.note,
    title: n.kind === 'highlight' ? COPY.selectionNote : COPY.editInsight,
    noteId: id,
    anchor: n.anchor,
  }
}

function onNewFreeNote() {
  composer.value = {
    quote: '',
    initial: '',
    title: COPY.newInsight,
    noteId: null,
    anchor: null,
  }
}

async function onSaveNote(text: string) {
  const c = composer.value
  if (!c) return
  try {
    if (c.noteId) {
      // 编辑只改心得文本，锚点不变——正文无需任何重渲染。
      const target = notesStore.notes.find((x) => x.id === c.noteId)
      await notesStore.update(
        c.noteId,
        target?.kind === 'highlight' ? { note: text, kind: 'note' } : { note: text },
      )
    } else if (c.anchor) {
      const note = makeNote(c.anchor, text, 'note')
      await notesStore.add(note)
      applyNoteAnchor(note.id, c.anchor)
    } else {
      await notesStore.add(makeFreeNote(text))
    }
    notify(COPY.noteSaved)
    composer.value = null
  } catch {
    // 留住弹层与已输入的内容，让用户知道没存上。
    notify(COPY.opFailed, 'sandal')
  }
}

const deleteTarget = ref<Note | null>(null)

function onRequestDelete(id: string) {
  deleteTarget.value = notesStore.notes.find((x) => x.id === id) ?? null
}

async function onConfirmDelete() {
  const n = deleteTarget.value
  if (!n) return
  deleteTarget.value = null
  try {
    await notesStore.remove(n.id)
    if (activeNoteId.value === n.id) activeNoteId.value = null
    removeNoteAnchor(n.id)
  } catch {
    notify(COPY.opFailed, 'sandal')
  }
}

const EXTERNAL_HREF = /^(?:https?:\/\/|mailto:)/i

function onProseClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const mark = target.closest('mark.hl')
  if (mark) {
    const id = mark.getAttribute('data-note-id')
    if (id) {
      activeNoteId.value = id
      showNotes.value = true
    }
    return
  }
  const anchor = target.closest('a[href]')
  if (!anchor) {
    // 无链之图与 mermaid 图卡：入灯箱静观（带链的图交给链接逻辑）。
    // 渲染失败的 mermaid 卡（.mermaid-figure-error）是源码，留给选中复制。
    const fig = target.closest('.mermaid-figure:not(.mermaid-figure-error)')
    if (fig) {
      viewerSvg.value = mermaidSvgSnapshot(fig as HTMLElement)
      return
    }
    const img = target.closest('img')
    if (img) viewerSrc.value = img.getAttribute('src')
    return
  }
  const href = anchor.getAttribute('href') ?? ''
  if (!href || href.startsWith('#')) return // 页内锚点（含脚注）走默认行为
  if (EXTERNAL_HREF.test(href)) {
    // 系统浏览器接管外链，WebView 原地不动；浏览器 dev 走默认新标签。
    if (isTauri()) {
      e.preventDefault()
      void openExternal(href)
    }
    return
  }
  // 其余一律不导航，防止 WebView 跑出去回不来。
  e.preventDefault()
  const resolved = route.params.path
    ? resolveDocLink(route.params.path as string, href)
    : null
  if (resolved) {
    // 互链走应用内路由；目标缺失时由 loadDocument 的失败流提示并回书库。
    void router.push(`/read/${encodeURIComponent(resolved)}`)
  }
}

function jumpToHighlight(id: string) {
  // html：锚点在帧内，命令 agent 滚到该条高亮（mark 本身持续可见，无 pulse）。
  if (isHtml.value) {
    html.scrollToNote(id)
    return
  }
  const mark = proseEl.value?.querySelector(`mark.hl[data-note-id="${id}"]`)
  if (!mark) return
  mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
  mark.classList.remove('hl-pulse')
  void (mark as HTMLElement).offsetWidth
  mark.classList.add('hl-pulse')
}

function onSelectNote(id: string) {
  const n = notesStore.notes.find((x) => x.id === id)
  activeNoteId.value = id
  if (n && n.anchor) jumpToHighlight(id)
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
  // TOC 侧栏点击共用入口：html 项 id 是合成的 `zhh-{i}`，md 是正文标题 id。
  if (isHtml.value) {
    const m = /^zhh-(\d+)$/.exec(id)
    if (m) html.scrollToHeading(Number(m[1]))
    return
  }
  scrollToHeadingEl(id)
}

/** Jump to the previous/next heading relative to the reader's position. */
function jumpChapter(dir: 1 | -1) {
  const ids = headingIds.value
  if (ids.length === 0) return
  const current = activeHeadingId.value
  let index = current ? ids.indexOf(current) : -1
  index = Math.min(ids.length - 1, Math.max(0, index + dir))
  // Already on the last/first heading - nudge to the document's end/start.
  if (
    (dir === 1 && current === ids[ids.length - 1]) ||
    (dir === -1 && current === '')
  ) {
    const el = containerRef.value
    if (el) {
      el.scrollTo({
        top: dir === 1 ? el.scrollHeight : 0,
        behavior: 'smooth',
      })
    }
    return
  }
  scrollToHeading(ids[index])
}

/** True when keystrokes would land in a text field - skip shortcuts. */
function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target
  if (!(t instanceof HTMLElement)) return false
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isTypingTarget(e)) return

  // html：阅读区就是沙箱 iframe。滚动/面板键统一交给帧侧语义（与 agent 转发一致），
  // 防止窗口键冒进 md 的容器滚动逻辑（容器在 html 下并不滚动）。
  if (isHtml.value) {
    if (HTML_SCROLL_KEYS.has(e.key)) e.preventDefault()
    onHtmlKey({ key: e.key, shiftKey: e.shiftKey })
    return
  }

  switch (e.key) {
    case 'Escape':
      if (composerOpen.value) {
        composer.value = null
      } else if (settings.zenMode) {
        setZen(false)
      } else if (showNotes.value) {
        showNotes.value = false
      } else if (showToc.value) {
        showToc.value = false
      } else if (isFullscreen.value) {
        toggleFullscreen()
      }
      return
    case 'j':
    case 'ArrowDown':
      scrollByFraction(0.8)
      return
    case 'k':
    case 'ArrowUp':
      scrollByFraction(-0.8)
      return
    case ' ':
      e.preventDefault() // keep the page itself from scrolling
      scrollByFraction(e.shiftKey ? -0.9 : 0.9)
      return
    case 'ArrowRight':
      jumpChapter(1)
      return
    case 'ArrowLeft':
      jumpChapter(-1)
      return
    case 'Home':
      scrollToEdge('top')
      return
    case 'End':
      scrollToEdge('bottom')
      return
    case 't':
    case 'T':
      showToc.value = !showToc.value
      return
    case 'n':
    case 'N':
      showNotes.value = !showNotes.value
      return
    case 'z':
    case 'Z':
      setZen(!settings.zenMode)
      return
    case '?':
      showShortcuts.value = !showShortcuts.value
      return
  }
}

watch(
  () => settings.theme,
  (t) => {
    // html：正文自带样式不动，只需重调帧内高亮的配色（agent 换 CSS var）。
    if (isHtml.value) {
      html.setTheme(t)
      return
    }
    if (proseEl.value && doc.value) {
      // mermaid 图卡内藏源码（data-mermaid-src），主题切换整图重绘。
      renderMermaidBlocks(proseEl.value, settings.theme)
      highlightCodeBlocks(proseEl.value, settings.theme)
    }
  },
)

onMounted(() => {
  loadDocument()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.title = COPY.appTitle
  if (puffTimer) clearTimeout(puffTimer)
  if (htmlResumeTimer) {
    clearTimeout(htmlResumeTimer)
    htmlResumeTimer = null
  }
  progressStore.flush()
})

function onBeforeUnload() {
  progressStore.flush()
}

watch(() => route.params.path, loadDocument)
</script>

<template>
  <div class="flex h-screen flex-col bg-paper text-ink">
    <!-- 禅境氛围光：常驻透明层，仪式末息方才亮起（渐隐在 CSS 里过渡）；
         微尘/萤火与之同息，为稳态添一点活气。 -->
    <div
      class="zen-ambient"
      :class="{ 'zen-ambient-on': settings.zenMode && ritualStage >= 3 }"
      aria-hidden="true"
    ></div>
    <ZenMotes
      :active="settings.zenMode && ritualStage >= 3"
      :theme="settings.theme"
    />

    <!-- Top toolbar (hidden in 禅境; tucks away while scrolling down) -->
    <Transition name="zen-header">
      <!-- z-20：backdrop-blur 令本栏自成层叠上下文，若无 z 则与后面的阅读区同为 0 层、
           阅读区按 DOM 序盖在其上——香浮层即使 z-50 也逃不出本栏，点击全被透明阅读区接走。
           给本栏一个 z-index 让整棵子树（含下拉浮层）抬到阅读区之上。 -->
      <header
        v-if="!settings.zenMode || ritualStage < 1"
        :class="headerBarClass"
      >
        <div class="flex min-w-0 items-center gap-1">
          <IncenseControl
            v-if="settings.reminder.enabled"
            variant="toolbar"
            @ignite="onIncenseIgnited"
          />
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
            @click="stepFont(-1)"
          >
            <ZIcon name="minus" :size="15" />
          </button>
          <span class="w-9 text-center text-xs text-dusk tabular-nums">{{
            isHtml ? `${htmlZoomPct}%` : settings.fontSize
          }}</span>
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
            @click="stepFont(1)"
          >
            <ZIcon name="plus" :size="15" />
          </button>
  
          <span class="mx-1 h-5 w-px bg-line" />
  
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
            :title="COPY.theme"
            @click="cycleTheme"
          >
            <ZIcon :name="THEME_ICON[settings.theme]" :size="17" />
          </button>
          <button
            v-if="!isHtml"
            class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
            :class="{ 'text-bamboo': settings.fontFamily === 'sans' }"
            :title="COPY.font"
            @click="toggleFontFamily"
          >
            <span class="font-serif text-sm">字</span>
          </button>
  
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
            :title="COPY.settings"
            @click="openPanel"
          >
            <ZIcon name="settings" :size="18" />
          </button>
  
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
            :title="COPY.shortcutSheet"
            @click="showShortcuts = true"
          >
            <ZIcon name="keyboard" :size="16" />
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
            class="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
            :title="isFullscreen ? COPY.exitFullscreen : COPY.fullscreen"
            @click="toggleFullscreen"
          >
            <ZIcon :name="isFullscreen ? 'shrink' : 'expand'" :size="17" />
          </button>
  
        <button
          class="flex h-9 items-center gap-1.5 rounded-full bg-bamboo/15 px-3 text-sm text-bamboo transition-colors hover:bg-bamboo/25"
          :title="COPY.zenMode"
          @click="setZen(true)"
        >
          <ZIcon name="zen" :size="16" />
          {{ COPY.zenMode }}
        </button>
        </div>
      </header>
    </Transition>

    <div class="relative flex min-h-0 flex-1">
      <!-- TOC sidebar -->
      <Transition name="fade-slide">
        <aside
          v-if="showToc && (!settings.zenMode || ritualStage < 2)"
          class="flex w-64 shrink-0 flex-col overflow-hidden border-r border-line"
          :class="isHtml && !headerHidden ? 'mt-14' : ''"
        >
          <div class="border-b border-line px-4 py-3">
            <h2 class="font-serif text-base">{{ COPY.toc }}</h2>
          </div>
          <nav class="flex-1 space-y-0.5 overflow-y-auto p-3">
            <p
              v-if="tocItems.length === 0"
              class="flex flex-col items-center px-2 py-6 text-xs text-dusk"
            >
              <span class="zen-breathe h-1.5 w-1.5 rounded-full bg-dusk/60"></span>
              <span class="mt-3">{{ COPY.emptyToc }}</span>
            </p>
            <a
              v-for="item in tocItems"
              :key="item.id"
              :ref="(el) => setTocItemRef(item.id, el)"
              :href="`#${item.id}`"
              class="block truncate rounded-md px-2.5 py-1.5 text-sm transition-colors"
              :class="
                activeHeadingId === item.id
                  ? 'bg-bamboo/10 text-bamboo'
                  : 'text-ink-soft hover:bg-bamboo/10 hover:text-ink'
              "
              :style="{ paddingLeft: `${(item.level - 1) * 12 + 10}px` }"
              @click.prevent="scrollToHeading(item.id)"
            >
              {{ item.text }}
            </a>
          </nav>
        </aside>
      </Transition>

      <!-- Reading surface -->
      <div ref="containerRef" class="min-w-0 flex-1 overflow-y-auto">
        <!-- HTML 原样式直读：沙箱 iframe 撑满阅读区、自带滚动（md 用下面 prose 区）。
             sandbox 仅 allow-scripts → 不透明源；sandbox 不含 allow-same-origin，
             文档自身 JS 永远够不到应用源 / Tauri IPC。 -->
        <iframe
          v-if="isHtml && doc"
          ref="htmlFrameEl"
          class="block h-full w-full border-0"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          :title="doc.title"
        ></iframe>
        <div
          v-else
          class="px-6 py-10 transition-[padding] duration-700 ease-zen md:px-12"
          :class="{ 'py-16': settings.zenMode && ritualStage >= 2 }"
        >
          <!-- 翻卷中：首次打开文档时的呼吸圆点 -->
          <div
            v-if="reader.loading && !doc"
            class="flex flex-col items-center py-32 text-dusk"
          >
            <div class="zen-breathe h-2 w-2 rounded-full bg-bamboo/50"></div>
            <p class="mt-6 font-serif text-lg">{{ COPY.loadingDoc }}</p>
          </div>
          <article
            v-else
            ref="proseEl"
            class="zen-prose"
            :data-indent="settings.paragraphIndent ? 'true' : 'false'"
            :data-justify="settings.justify ? 'true' : 'false'"
            @click="onProseClick"
          ></article>
        </div>
      </div>

      <!-- Notes panel -->
      <Transition name="fade-slide">
        <aside
          v-if="showNotes && (!settings.zenMode || ritualStage < 2)"
          class="w-80 shrink-0 border-l border-line"
          :class="isHtml && !headerHidden ? 'mt-14' : ''"
        >
          <NotesPanel
            :notes="orderedNotes"
            :active-id="activeNoteId"
            @close="showNotes = false"
            @select="onSelectNote"
            @edit="onEditNote"
            @delete="onRequestDelete"
            @create="onNewFreeNote"
            @zoom-image="viewerSrc = $event"
            @zoom-figure="viewerSvg = $event"
          />
        </aside>
      </Transition>
    </div>

    <!-- 阅读进度 - a wisp of bamboo, present even in 禅境 -->
    <div
      class="pointer-events-none fixed inset-x-0 top-0 z-30 h-0.5 bg-transparent"
    >
      <div
        class="h-full bg-bamboo/70 transition-[width] duration-200 ease-zen"
        :style="{ width: `${progressPct}%` }"
      />
    </div>

    <!-- 禅境 exit hint：乘纱将揭未揭之际迟到半拍浮现（zen-arrive），
         出定时随眨纱同息，无需离场动画。 -->
    <p
      v-if="settings.zenMode && ritualStage >= 3"
      class="zen-arrive pointer-events-none fixed bottom-5 right-5 text-xs text-dusk"
    >
      {{ COPY.escToReturn }}
    </p>

    <!-- 禅境迷你香 -- header 已隐，唯香常随 -->
    <div
      v-if="settings.zenMode && settings.reminder.enabled && ritualStage >= 3"
      class="zen-arrive fixed right-4 top-4 z-30"
    >
      <IncenseControl variant="zen" @ignite="onIncenseIgnited" />
    </div>

    <!-- 续读 hint -->
    <Transition name="fade">
      <p
        v-if="showResumeHint"
        class="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-paper/90 px-3.5 py-1.5 text-xs text-ink-soft shadow-zen-sm backdrop-blur-sm"
      >
        <ZIcon name="bookmark" :size="13" class="text-sandal" />
        {{ COPY.resumeReading }}
      </p>
    </Transition>

    <!-- 香已点燃 hint -->
    <Transition name="fade">
      <p
        v-if="showLitNotice"
        class="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-paper/90 px-3.5 py-1.5 text-xs text-ink-soft shadow-zen-sm backdrop-blur-sm"
      >
        <ZIcon name="incense" :size="13" class="text-sandal" />
        {{ litNoticeText }}
      </p>
    </Transition>

    <SelectionToolbar
      :rect="isHtml ? (htmlSel?.rect ?? null) : (capture?.rect ?? null)"
      :visible="isHtml ? htmlSelVisible : visible"
      @highlight="onHighlight"
      @note="onOpenComposer"
    />

    <InsightComposer
      :open="composerOpen"
      :quote="composer?.quote ?? ''"
      :initial="composer?.initial ?? ''"
      :title="composer?.title ?? COPY.selectionNote"
      @save="onSaveNote"
      @cancel="composer = null"
    />

    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="COPY.deleteNote"
      :message="COPY.deleteNoteHint"
      :confirm-label="COPY.delete"
      @confirm="onConfirmDelete"
      @close="deleteTarget = null"
    />

    <ShortcutSheet
      :open="showShortcuts"
      @close="showShortcuts = false"
    />

    <!-- 回到卷首：行至半卷方才浮现，回顶即隐；禅境不设，免扰清净。 -->
    <Transition name="fade">
      <button
        v-if="(isHtml ? htmlShowBackTop : showBackTop) && !settings.zenMode"
        class="fixed bottom-6 right-6 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paper/90 font-serif text-sm text-ink-soft shadow-zen-sm backdrop-blur-sm transition-colors hover:text-ink"
        :title="COPY.backToTop"
        @click="scrollToEdge('top')"
      >
        顶
      </button>
    </Transition>

    <ImageViewer :src="viewerSrc" :svg="viewerSvg" @close="closeViewer" />

    <!-- 入定仪式（风格由设置「入定动画」决定，注册表见 zenRituals.ts）：
         墨韵/落叶/香篆各自按契约推进——纱起、各自意象展开，世界退去
         一层→两层→稳态，末景水洗漫开纱散。轻触任意处可跳过。 -->
    <Transition name="fade">
      <component
        :is="ZEN_RITUAL_COMPONENTS[activeRitual]"
        v-if="ritualActive"
        @stage="onRitualStage"
        @skip="skipRitual"
        @finish="endRitual"
      />
    </Transition>

    <!-- 出定／速入的短雾 -->
    <div v-if="zenPuff" class="zen-veil-out-mist" aria-hidden="true"></div>

  </div>
</template>

<style scoped>
/*
 * html 直读的沉浸式顶栏：浮出文档流、压在正文 iframe 上方。
 * 半透纸色 + 毛玻璃，正文滚动时从条下掠过；图标仍用应用主题的
 * ink/bamboo，靠这条玻璃自身保证与任意底色的可读对比。
 * 高 h-14 = 56px——与模板里面板让位的 mt-14 同值，改高度务必同步。
 */
.html-glass-bar {
  background: color-mix(in srgb, var(--paper) 58%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(1.5);
  backdrop-filter: blur(18px) saturate(1.5);
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 9%, transparent);
  box-shadow: 0 14px 32px -20px rgba(0, 0, 0, 0.42);
}
</style>
