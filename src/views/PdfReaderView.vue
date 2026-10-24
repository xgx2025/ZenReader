<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import ZIcon from '@/components/common/ZIcon.vue'
import { useProgressStore } from '@/stores/progress'
import { useSettingsStore } from '@/stores/settings'
import { nativeFs } from '@/lib/native'
import { COPY } from '@/lib/copy'
import { clampPdfPage, pageFromProgress, pdfProgress } from '@/lib/pdf'
import { titleFromName } from '@/lib/vault'
import { FINISHED_RATIO, RESUME_MIN_RATIO } from '@/types/progress'

GlobalWorkerOptions.workerSrc = workerUrl

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

class VaultPdfTransport extends PDFDataRangeTransport {
  private closed = false
  constructor(
    length: number,
    private dir: string,
    private relativePath: string,
    private onFailure: (error: unknown) => void,
  ) { super(length, null) }

  override requestDataRange(begin: number, end: number) {
    void nativeFs.readPdfRange(this.dir, this.relativePath, begin, end)
      .then((data) => { if (!this.closed) this.onDataRange(begin, decodeBase64(data)) })
      .catch((error) => { if (!this.closed) this.onFailure(error) })
  }

  override abort() { this.closed = true }
}

interface PdfOutlineItem { title: string; depth: number; page: number }
type RawOutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number]

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const progress = useProgressStore()
const relativePath = computed(() => String(route.params.path ?? ''))
const title = computed(() => titleFromName(relativePath.value.split('/').pop() ?? 'PDF'))

const pdf = shallowRef<PDFDocumentProxy | null>(null)
const page = ref(1)
const pageInput = ref('1')
const pageCount = ref(0)
const zoom = ref<number | 'fit'>('fit')
const effectiveZoom = ref(1)
const paneWidth = ref(900)
const showOutline = ref(false)
const outline = ref<PdfOutlineItem[]>([])
const loading = ref(true)
const rendering = ref(false)
const error = ref('')
const canvasEl = ref<HTMLCanvasElement | null>(null)
const textEl = ref<HTMLElement | null>(null)
const pageHostEl = ref<HTMLElement | null>(null)
const paneEl = ref<HTMLElement | null>(null)
const progressPct = computed(() => pageCount.value ? Math.round(pdfProgress(page.value, pageCount.value) * 100) : 0)

let loadTask: ReturnType<typeof getDocument> | null = null
let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null
let textLayer: TextLayer | null = null
let loadGeneration = 0
let renderGeneration = 0
let resizeObserver: ResizeObserver | null = null
let restoring = false

function goToPage(value: number) {
  if (!pageCount.value) return
  page.value = clampPdfPage(value, pageCount.value)
  pageInput.value = String(page.value)
}

function commitPageInput() {
  const requested = Number(pageInput.value)
  goToPage(requested)
  pageInput.value = String(page.value)
}

function zoomBy(delta: number) {
  const current = zoom.value === 'fit' ? effectiveZoom.value : zoom.value
  zoom.value = Math.max(0.4, Math.min(3, Math.round((current + delta) * 10) / 10))
}

async function readOutline(document: PDFDocumentProxy, generation: number) {
  const tree = await document.getOutline()
  const list: PdfOutlineItem[] = []
  async function visit(nodes: RawOutlineItem[], depth: number) {
    for (const node of nodes) {
      if (generation !== loadGeneration) return
      let destination = node.dest
      if (typeof destination === 'string') destination = await document.getDestination(destination)
      if (Array.isArray(destination) && destination[0]) {
        try {
          const first = destination[0]
          const index = typeof first === 'number' ? first : await document.getPageIndex(first)
          list.push({ title: node.title, depth: Math.min(depth, 4), page: index + 1 })
        } catch { /* broken outline entry: keep reading other entries */ }
      }
      if (node.items?.length) await visit(node.items as RawOutlineItem[], depth + 1)
    }
  }
  if (tree?.length) await visit(tree, 0)
  if (generation === loadGeneration) outline.value = list
}

async function openPdf() {
  const generation = ++loadGeneration
  ++renderGeneration
  renderTask?.cancel()
  textLayer?.cancel()
  await loadTask?.destroy().catch(() => {})
  loadTask = null
  pdf.value = null
  pageCount.value = 0
  page.value = 1
  pageInput.value = '1'
  outline.value = []
  zoom.value = 'fit'
  error.value = ''
  loading.value = true
  restoring = true
  document.title = `${title.value} · ${COPY.appName}`
  try {
    await nativeFs.setActiveVault(settings.vaultPath)
    if (generation !== loadGeneration) return
    const length = await nativeFs.pdfFileSize(settings.vaultPath, relativePath.value)
    if (generation !== loadGeneration) return
    const assetRoot = new URL('/pdfjs-assets/', window.location.href).href
    const transport = new VaultPdfTransport(length, settings.vaultPath, relativePath.value, (cause) => {
      console.error('[zenreader] PDF range read failed', cause)
      error.value = '读取 PDF 时发生错误。'
      void loadTask?.destroy()
    })
    loadTask = getDocument({
      range: transport,
      rangeChunkSize: 65536,
      disableAutoFetch: true,
      disableStream: true,
      cMapUrl: `${assetRoot}cmaps/`,
      standardFontDataUrl: `${assetRoot}standard_fonts/`,
      wasmUrl: `${assetRoot}wasm/`,
      enableXfa: false,
    })
    const document = await loadTask.promise
    if (generation !== loadGeneration) return
    pdf.value = document
    pageCount.value = document.numPages
    const fingerprint = document.fingerprints[0] ?? relativePath.value
    const saved = progress.get(relativePath.value)
    if (saved && saved.hash === fingerprint && saved.ratio >= RESUME_MIN_RATIO && saved.ratio < FINISHED_RATIO) {
      page.value = pageFromProgress(saved.ratio, document.numPages)
    }
    pageInput.value = String(page.value)
    void readOutline(document, generation).catch(() => {})
  } catch (cause) {
    if (generation === loadGeneration) {
      console.error('[zenreader] PDF open failed', cause)
      error.value = '无法打开此 PDF，请确认文件仍在书库中且未损坏。'
    }
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      restoring = false
      await nextTick()
      if (pdf.value) void renderPage()
    }
  }
}

async function renderPage() {
  const document = pdf.value
  const canvas = canvasEl.value
  const textContainer = textEl.value
  const host = pageHostEl.value
  if (!document || !canvas || !textContainer || !host) return
  const generation = ++renderGeneration
  renderTask?.cancel()
  textLayer?.cancel()
  try { await renderTask?.promise } catch { /* expected cancellation */ }
  if (generation !== renderGeneration) return
  rendering.value = true
  try {
    const pdfPage = await document.getPage(page.value)
    if (generation !== renderGeneration) return
    const base = pdfPage.getViewport({ scale: 1 })
    const scale = zoom.value === 'fit'
      ? Math.max(0.4, Math.min(3, (paneWidth.value - 64) / base.width))
      : zoom.value
    effectiveZoom.value = scale
    const viewport = pdfPage.getViewport({ scale })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.ceil(viewport.width * dpr)
    canvas.height = Math.ceil(viewport.height * dpr)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    host.style.width = `${viewport.width}px`
    host.style.height = `${viewport.height}px`
    textContainer.replaceChildren()
    textContainer.style.setProperty('--total-scale-factor', String(scale))
    renderTask = pdfPage.render({
      canvas,
      viewport,
      transform: [dpr, 0, 0, dpr, 0, 0],
    })
    await renderTask.promise
    if (generation !== renderGeneration) return
    textLayer = new TextLayer({
      textContentSource: await pdfPage.getTextContent(),
      container: textContainer,
      viewport,
    })
    if (generation !== renderGeneration) return
    await textLayer.render()
  } catch (cause) {
    if (generation === renderGeneration) {
      console.error('[zenreader] PDF page render failed', cause)
      error.value = '这一页暂时无法显示。'
    }
  } finally {
    if (generation === renderGeneration) rendering.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return
  if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
    event.preventDefault()
    goToPage(page.value + 1)
  } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
    event.preventDefault()
    goToPage(page.value - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    goToPage(1)
  } else if (event.key === 'End') {
    event.preventDefault()
    goToPage(pageCount.value)
  } else if (event.key.toLowerCase() === 't') {
    showOutline.value = !showOutline.value
  }
}

watch(() => route.params.path, () => { void openPdf() }, { immediate: true })
watch([page, zoom, paneWidth, pdf], () => { void renderPage() }, { flush: 'post' })
watch(page, (value) => {
  pageInput.value = String(value)
  paneEl.value?.scrollTo({ top: 0, left: 0 })
  if (!restoring && pdf.value) {
    progress.record(relativePath.value, pdf.value.fingerprints[0] ?? relativePath.value, pdfProgress(value, pageCount.value))
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  resizeObserver = new ResizeObserver((entries) => {
    paneWidth.value = entries[0]?.contentRect.width ?? paneWidth.value
  })
  if (paneEl.value) resizeObserver.observe(paneEl.value)
})

onBeforeUnmount(() => {
  ++loadGeneration
  ++renderGeneration
  window.removeEventListener('keydown', onKeydown)
  resizeObserver?.disconnect()
  renderTask?.cancel()
  textLayer?.cancel()
  void loadTask?.destroy()
  progress.flush()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-paper text-ink">
    <header class="z-20 flex min-h-14 items-center justify-between gap-4 border-b border-line bg-paper/80 px-4 backdrop-blur-md">
      <div class="flex min-w-0 items-center gap-2">
        <button class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-bamboo/10 hover:text-ink" :title="COPY.scopeBack" :aria-label="COPY.scopeBack" @click="router.push('/')"><ZIcon name="back" :size="18" /></button>
        <span class="truncate font-serif text-base">{{ title }}</span>
        <span class="shrink-0 rounded border border-dusk/30 bg-dusk/10 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">pdf</span>
      </div>
      <div class="flex shrink-0 items-center gap-3 text-sm">
        <button class="rounded-full px-2.5 py-1.5 text-ink-soft hover:bg-bamboo/10 hover:text-ink" :aria-pressed="showOutline" @click="showOutline = !showOutline"><ZIcon name="toc" :size="16" /> <span class="hidden lg:inline">{{ COPY.toc }}</span></button>
        <div class="flex items-center gap-1 rounded-full bg-paper-deep/70 px-2 py-1">
          <button class="rounded-full px-2 text-ink-soft hover:text-ink disabled:opacity-30" :disabled="page <= 1" aria-label="上一页" @click="goToPage(page - 1)">‹</button>
          <input v-model="pageInput" class="w-10 bg-transparent text-center tabular-nums outline-none" inputmode="numeric" aria-label="页码" @keydown.enter="commitPageInput" @blur="commitPageInput" />
          <span class="text-dusk">/ {{ pageCount || '—' }}</span>
          <button class="rounded-full px-2 text-ink-soft hover:text-ink disabled:opacity-30" :disabled="page >= pageCount" aria-label="下一页" @click="goToPage(page + 1)">›</button>
        </div>
        <div class="flex items-center gap-1 rounded-full bg-paper-deep/70 px-2 py-1">
          <button class="flex h-6 w-6 items-center justify-center text-ink-soft hover:text-ink" aria-label="缩小页面" @click="zoomBy(-0.1)"><ZIcon name="minus" :size="14" /></button>
          <button class="min-w-16 text-center tabular-nums text-ink-soft hover:text-ink" aria-label="适合宽度" @click="zoom = 'fit'">{{ zoom === 'fit' ? '适合宽度' : `${Math.round(effectiveZoom * 100)}%` }}</button>
          <button class="flex h-6 w-6 items-center justify-center text-ink-soft hover:text-ink" aria-label="放大页面" @click="zoomBy(0.1)"><ZIcon name="plus" :size="14" /></button>
        </div>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <aside v-if="showOutline" class="w-64 shrink-0 overflow-y-auto border-r border-line bg-paper/60 p-3">
        <h2 class="border-b border-line px-2 py-2 font-serif">{{ COPY.toc }}</h2>
        <p v-if="!outline.length" class="px-2 py-5 text-sm text-dusk">{{ COPY.emptyToc }}</p>
        <button v-for="(item, index) in outline" :key="index" class="block w-full truncate rounded-md py-1.5 pr-2 text-left text-sm text-ink-soft hover:bg-bamboo/10 hover:text-ink" :style="{ paddingLeft: `${8 + item.depth * 14}px` }" :title="item.title" @click="goToPage(item.page)">{{ item.title }}</button>
      </aside>

      <main ref="paneEl" class="min-w-0 flex-1 overflow-auto bg-paper-deep/35">
        <div v-if="loading" class="flex h-full items-center justify-center text-sm text-dusk">正在打开 PDF…</div>
        <div v-else-if="error" class="flex h-full flex-col items-center justify-center gap-4 text-sm text-dusk"><p>{{ error }}</p><button class="rounded-full bg-bamboo/10 px-4 py-2 text-bamboo" @click="openPdf">重试</button></div>
        <div v-else class="flex min-h-full justify-center p-8">
          <div ref="pageHostEl" class="relative shrink-0 bg-white shadow-zen-lg" :aria-label="`第 ${page} 页，共 ${pageCount} 页`">
            <canvas ref="canvasEl" class="block" />
            <div ref="textEl" class="pdf-text-layer" />
            <div v-if="rendering" class="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/50 text-sm text-dusk">正在排版…</div>
          </div>
        </div>
      </main>
    </div>
    <div class="pointer-events-none fixed inset-x-0 top-0 z-30 h-0.5"><div class="h-full bg-bamboo/70" :style="{ width: `${progressPct}%` }" /></div>
  </div>
</template>

<style scoped>
/* PDF.js TextLayer creates absolutely positioned spans over the page canvas. */
.pdf-text-layer { position: absolute; inset: 0; overflow: clip; line-height: 1; text-align: initial; transform-origin: 0 0; --min-font-size: 1; --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv: calc(1 / var(--min-font-size)); }
.pdf-text-layer :deep(span), .pdf-text-layer :deep(br) { position: absolute; color: transparent; white-space: pre; cursor: text; transform-origin: 0 0; user-select: text; }
.pdf-text-layer :deep(> :not(.markedContent)), .pdf-text-layer :deep(.markedContent span:not(.markedContent)) { --font-height: 0; --scale-x: 1; --rotate: 0deg; font-size: calc(var(--text-scale-factor) * var(--font-height)); transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
.pdf-text-layer :deep(.markedContent) { display: contents; }
.pdf-text-layer :deep(::selection) { background: rgba(95, 122, 92, 0.28); color: transparent; }
</style>
