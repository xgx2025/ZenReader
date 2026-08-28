import { ref } from 'vue'
import { defineStore } from 'pinia'

import { nativeFs } from '@/lib/native'
import { vaultFile, folderPathFromRelative, resolveTitle } from '@/lib/vault'
import { renderMarkdown } from '@/lib/markdown/parser'
import { parseFrontmatter } from '@/lib/markdown/frontmatter'
import { countWords, computeReadingTime, makeExcerpt } from '@/lib/markdown/structure'
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
      const source = await nativeFs.readFile(
        vaultFile(settings.vaultPath, relativePath),
      )
      const { data, content } = parseFrontmatter(source)
      const { html, plainText } = renderMarkdown(content)
      const wordCount = countWords(plainText)
      const fileName = relativePath.split('/').pop() ?? relativePath

      const doc: Document = {
        title: resolveTitle(data, fileName),
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
