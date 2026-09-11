import { ref } from 'vue'
import { defineStore } from 'pinia'

import { nativeFs, isTauri } from '@/lib/native'
import {
  vaultFile,
  folderPathFromRelative,
  isHtmlFile,
  resolveHtmlTitle,
  resolveTitle,
} from '@/lib/vault'
import { renderMarkdown } from '@/lib/markdown/parser'
import { parseFrontmatter } from '@/lib/markdown/frontmatter'
import { countWords, computeReadingTime, makeExcerpt } from '@/lib/markdown/structure'
import { extractHtmlText, extractHtmlTitle } from '@/lib/html/text'
import { hashString } from '@/lib/hash'
import { useSettingsStore } from '@/stores/settings'
import type { Document } from '@/types/document'

export const useReaderStore = defineStore('reader', () => {
  const current = ref<Document | null>(null)
  const loading = ref(false)

  async function open(relativePath: string): Promise<Document | null> {
    loading.value = true
    try {
      const settings = useSettingsStore()
      const absolute = vaultFile(settings.vaultPath, relativePath)
      // 原样式 HTML 直读时，zenasset:// 资产协议按"活跃书库根"收敛——打开任何文档
      // 都顺带上报一次（fire-and-forget，纯防御性兜底），确保相对媒体总能解析。
      if (isTauri()) {
        void nativeFs.setActiveVault(settings.vaultPath).catch(() => {})
      }
      const fileName = relativePath.split('/').pop() ?? relativePath
      const source = isHtmlFile(fileName)
        ? await nativeFs.readHtml(absolute) // GBK/meta-charset 感知
        : await nativeFs.readFile(absolute)

      const isHtml = isHtmlFile(fileName)
      // .html 不做 markdown 渲染：原文交给 HtmlDocumentPane 沙箱直读，
      // `html` 留空、`plainText` 取静态正文（供字数/寻词/笔记排序同源）。
      const { data, content } = isHtml
        ? { data: {}, content: source }
        : parseFrontmatter(source)
      const { html, plainText } = isHtml
        ? { html: '', plainText: extractHtmlText(source) }
        : renderMarkdown(content)
      const wordCount = countWords(plainText)

      const doc: Document = {
        title: isHtml
          ? resolveHtmlTitle(extractHtmlTitle(source), fileName)
          : resolveTitle(data, fileName),
        format: isHtml ? 'html' : 'markdown',
        source,
        html,
        plainText,
        sourceHash: hashString(source),
        frontmatter: data,
        excerpt: makeExcerpt(plainText),
        wordCount,
        readingTime: computeReadingTime(wordCount),
        fileName,
        folderPath: folderPathFromRelative(relativePath),
        relativePath,
      }
      current.value = doc
      return doc
    } finally {
      loading.value = false
    }
  }

  function close() {
    current.value = null
  }

  return { current, loading, open, close }
})
