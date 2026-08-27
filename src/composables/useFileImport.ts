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
import { nativeFs, isTauri } from '@/lib/native'
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

function folderPathFromRelative(relativePath: string): string {
  const parts = relativePath.split('/')
  parts.pop()
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
  fileName: string,
  folderPath: string,
): Document {
  const { data, content } = parseFrontmatter(source)
  const { html, plainText } = renderMarkdown(content)
  const wordCount = countWords(plainText)
  const ts = now()

  return {
    id: crypto.randomUUID(),
    title: titleFrom(data, fileName),
    source,
    html,
    plainText,
    sourceHash: hashString(source),
    frontmatter: data,
    excerpt: makeExcerpt(plainText),
    wordCount,
    readingTime: computeReadingTime(wordCount),
    fileName,
    folderPath,
    createdAt: ts,
    updatedAt: ts,
    lastOpenedAt: ts,
  }
}

function fullRelativePath(doc: Document): string {
  return doc.folderPath ? `${doc.folderPath}/${doc.fileName}` : doc.fileName
}

async function persist(docs: Document[]): Promise<void> {
  for (let i = 0; i < docs.length; i += WRITE_CHUNK) {
    await documentRepo.bulkAdd(docs.slice(i, i + WRITE_CHUNK))
  }
}

export function useFileImport() {
  const items = ref<ImportItem[]>([])
  const importing = ref(false)
  /** Documents produced by the last import — target of "保存到文件夹". */
  const lastImportedDocs = ref<Document[]>([])

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
      const folderPath = folderPathOf(file)
      const key = `${folderPath}/${file.name}`

      if (existingKeys.has(key)) {
        item.status = 'skipped'
        skipped++
        continue
      }

      item.status = 'reading'
      try {
        const source = await readFileAsText(file)
        item.status = 'parsing'
        docs.push(buildDocument(source, file.name, folderPath))
        item.status = 'saving'
        item.status = 'done'
      } catch (e) {
        item.status = 'error'
        item.error = e instanceof Error ? e.message : String(e)
        errors.push({ fileName: file.name, reason: item.error ?? '未知错误' })
      }
    }

    await persist(docs)
    lastImportedDocs.value = docs
    importing.value = false
    return { imported: docs.length, skipped, errors }
  }

  /** Tauri: pick a folder and import every `.md` under it (reads from disk). */
  async function importFromVault(): Promise<ImportResult> {
    const empty = { imported: 0, skipped: 0, errors: [] as ImportResult['errors'] }
    if (!isTauri()) return empty

    const dir = await nativeFs.pickFolder()
    if (!dir) return empty

    const vaultFiles = await nativeFs.readVault(dir)

    items.value = vaultFiles.map((f) => ({
      fileName: f.name,
      folderPath: folderPathFromRelative(f.relativePath),
      status: 'pending' as const,
    }))

    importing.value = true

    const existing = await documentRepo.getAll()
    const existingKeys = new Set(
      existing.map((d) => `${d.folderPath}/${d.fileName}`),
    )

    const docs: Document[] = []
    const errors: ImportResult['errors'] = []
    let skipped = 0

    for (let i = 0; i < vaultFiles.length; i++) {
      const f = vaultFiles[i]
      const item = items.value[i]
      const folderPath = folderPathFromRelative(f.relativePath)
      const key = `${folderPath}/${f.name}`

      if (existingKeys.has(key)) {
        item.status = 'skipped'
        skipped++
        continue
      }

      item.status = 'reading'
      try {
        const source = await nativeFs.readFile(f.path)
        item.status = 'parsing'
        docs.push(buildDocument(source, f.name, folderPath))
        item.status = 'saving'
        item.status = 'done'
      } catch (e) {
        item.status = 'error'
        item.error = e instanceof Error ? e.message : String(e)
        errors.push({ fileName: f.name, reason: item.error ?? '未知错误' })
      }
    }

    await persist(docs)
    lastImportedDocs.value = docs
    importing.value = false
    return { imported: docs.length, skipped, errors }
  }

  /** Tauri: write the last-imported documents into a user-chosen folder. */
  async function saveToFolder(): Promise<{ dir: string | null; saved: number }> {
    if (!isTauri() || lastImportedDocs.value.length === 0) {
      return { dir: null, saved: 0 }
    }
    const dir = await nativeFs.pickFolder()
    if (!dir) return { dir: null, saved: 0 }

    let saved = 0
    for (const doc of lastImportedDocs.value) {
      const target = `${dir}/${fullRelativePath(doc)}`
      await nativeFs.writeFile(target, doc.source)
      saved++
    }
    return { dir, saved }
  }

  return {
    items,
    importing,
    lastImportedDocs,
    importFiles,
    importFromVault,
    saveToFolder,
  }
}
