<script setup lang="ts">
/**
 * 觉悟笔记的 Markdown 面：心得正文走与阅读页同源的一套管线——
 * renderMarkdown（markdown-it + 消毒 + KaTeX）产出 HTML，再过 mermaid
 * 图卡、shiki 高亮与代码复制三道 DOM 后处理，纸墨排版原样承袭。
 *
 * 笔记无目录，标题 id 无用武之地——而 renderMarkdown 的 id 是全局计数
 * （h-0、h-1…），笔记卡片批量渲染会与正文撞 id，干扰 useReadingScroll
 * 的全局 getElementById 查询；故注入后剥净容器内全部 id（脚注跳转随之
 * 降级为无动作，短心得里可接受）。
 */
import { onMounted, ref, watch } from 'vue'

import { renderMarkdown } from '@/lib/markdown/parser'
import { renderMermaidBlocks, mermaidSvgSnapshot } from '@/lib/markdown/mermaid'
import { highlightCodeBlocks } from '@/lib/markdown/highlight'
import { wireCodeCopy } from '@/lib/markdown/codeCopy'
import { useSettingsStore } from '@/stores/settings'
import { isTauri, openExternal } from '@/lib/native'

const props = defineProps<{ source: string }>()
const emit = defineEmits<{
  zoomImage: [src: string]
  zoomFigure: [svg: { html: string; ratio: number }]
}>()

const settings = useSettingsStore()
const el = ref<HTMLElement | null>(null)

function render() {
  const root = el.value
  if (!root) return
  root.innerHTML = renderMarkdown(props.source).html
  root.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
  // mermaid 先行把 `language-mermaid` 块替换为图卡，shiki 便不会再碰它们。
  void renderMermaidBlocks(root, settings.theme)
  void highlightCodeBlocks(root, settings.theme)
  wireCodeCopy(root)
}

/** 主题切换只重绘随主题而变的两样，不整篇重建。 */
function retheme() {
  const root = el.value
  if (!root) return
  void renderMermaidBlocks(root, settings.theme)
  void highlightCodeBlocks(root, settings.theme)
}

const EXTERNAL_HREF = /^(?:https?:\/\/|mailto:)/i

function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const anchor = target.closest('a[href]')
  if (!anchor) {
    // 无链之图与 mermaid 图卡：交上层开灯箱静观（渲染失败的卡是源码，不放大）。
    const fig = target.closest('.mermaid-figure:not(.mermaid-figure-error)')
    if (fig) {
      const snapshot = mermaidSvgSnapshot(fig as HTMLElement)
      if (snapshot) {
        e.stopPropagation()
        emit('zoomFigure', snapshot)
      }
      return
    }
    const img = target.closest('img')
    if (img) {
      e.stopPropagation()
      emit('zoomImage', img.getAttribute('src') ?? '')
    }
    return
  }
  // 链接与图各有去处，拦下冒泡，免得笔记卡片的「选中跳转」跟着凑热闹。
  e.stopPropagation()
  const href = anchor.getAttribute('href') ?? ''
  if (EXTERNAL_HREF.test(href)) {
    // 系统浏览器接管外链，WebView 原地不动；浏览器 dev 走默认新标签。
    if (isTauri()) {
      e.preventDefault()
      void openExternal(href)
    }
    return
  }
  // 页内锚与相对链在笔记里无处可去，一律拦下，防止 WebView 跑出去回不来。
  e.preventDefault()
}

onMounted(render)
watch(() => props.source, render)
watch(() => settings.theme, retheme)
</script>

<template>
  <div ref="el" class="zen-prose note-prose" @click="onClick"></div>
</template>
