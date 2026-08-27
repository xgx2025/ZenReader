import { ref } from 'vue'

import { renderMarkdown } from '@/lib/markdown/parser'
import { parseFrontmatter } from '@/lib/markdown/frontmatter'
import {
  computeReadingTime,
  countWords,
  makeExcerpt,
} from '@/lib/markdown/structure'
import { hashString } from '@/lib/hash'
import { documentRepo } from '@/lib/db/documents'
import type { Document } from '@/types/document'
import type { ImportItem, ImportResult } from '@/types/import'

const WRITE_CHUNK = 100

function now(): string {
  return new Date().toISOString()
}

function folderPathOf(file: File & { webkitRelativePath?: string }): string {
  const rel = file.webkitRelativePath
  if (!rel) return ''
  const parts = rel.split('/')
  parts.pop() // drop the filename
  return parts.join('/')
}

function titleFrom(frontmatter: Record<string, unknown>, fileName: string): string {
  const t = frontmatter.title
  if (typeof t === 'string' && t.trim()) return t.trim()
  return fileName.replace(/\.md$/i, '')
}

async function readFileAsText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buffer)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  // Chinese .md may be GBK — fall back when UTF-8 produced replacement chars.
  if (text.includes('�')) {
    try {
      text = new TextDecoder('gbk').decode(buffer)
    } catch {
      /* keep the UTF-8 attempt */
    }
  }
  return text
}

function buildDocument(
  source: string,
  file: File & { webkitRelativePath?: string },
): Document {
  const { data, content } = parseFrontmatter(source)
  const { html, plainText } = renderMarkdown(content)
  const wordCount = countWords(plainText)
  const ts = now()

  return {
    id: crypto.randomUUID(),
    title: titleFrom(data, file.name),
    source,
    html,
    plainText,
    sourceHash: hashString(source),
    frontmatter: data,
    excerpt: makeExcerpt(plainText),
    wordCount,
    readingTime: computeReadingTime(wordCount),
    fileName: file.name,
    folderPath: folderPathOf(file),
    createdAt: ts,
    updatedAt: ts,
    lastOpenedAt: ts,
  }
}

export function useFileImport() {
  const items = ref<ImportItem[]>([])
  const importing = ref(false)

  async function importFiles(files: File[]): Promise<ImportResult> {
    const typed = files as (File & { webkitRelativePath?: string })[]
    const mdFiles = typed.filter((f) => /\.md$/i.test(f.name))
    const skippedByExtension = typed.length - mdFiles.length

    items.value = mdFiles.map((f) => ({
      fileName: f.name,
      folderPath: folderPathOf(f),
      status: 'pending' as const,
    }))

    importing.value = true

    // Dedupe: skip files already present at the same folder+name.
    const existing = await documentRepo.getAll()
    const existingKeys = new Set(
      existing.map((d) => `${d.folderPath}/${d.fileName}`),
    )

    const docs: Document[] = []
    const errors: ImportResult['errors'] = []
    let skipped = skippedByExtension

    for (let i = 0; i < mdFiles.length; i++) {
      const file = mdFiles[i]
      const item = items.value[i]
      const key = `${folderPathOf(file)}/${file.name}`

      if (existingKeys.has(key)) {
        item.status = 'skipped'
        skipped++
        continue
      }

      item.status = 'reading'
      try {
        const source = await readFileAsText(file)
        item.status = 'parsing'
        const doc = buildDocument(source, file)
        item.status = 'saving'
        docs.push(doc)
        item.status = 'done'
      } catch (e) {
        item.status = 'error'
        item.error = e instanceof Error ? e.message : String(e)
        errors.push({ fileName: file.name, reason: item.error ?? '未知错误' })
      }
    }

    for (let i = 0; i < docs.length; i += WRITE_CHUNK) {
      await documentRepo.bulkAdd(docs.slice(i, i + WRITE_CHUNK))
    }

    importing.value = false
    return { imported: docs.length, skipped, errors }
  }

  return { items, importing, importFiles }
}
