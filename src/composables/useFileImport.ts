import { ref } from 'vue'

import { nativeFs } from '@/lib/native'
import { joinPath, vaultFile, folderPathFromRelative } from '@/lib/vault'
import { COPY } from '@/lib/copy'
import { useSettingsStore } from '@/stores/settings'
import { useLibraryStore } from '@/stores/library'
import type { ImportItem, ImportResult } from '@/types/import'

/** Only `.md` is imported - the vault scan (read_vault) lists nothing else. */
const MD_EXT = /\.md$/i

async function readFileAsText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buffer)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  // Chinese .md may be GBK - fall back when UTF-8 produced replacement chars.
  if (text.includes('�')) {
    try {
      text = new TextDecoder('gbk').decode(buffer)
    } catch {
      /* keep the UTF-8 attempt */
    }
  }
  return text
}

/** Relative target within the vault: folder-picked files keep their structure. */
function relativePathFor(file: File & { webkitRelativePath?: string }): string {
  return file.webkitRelativePath || file.name
}

/** One file to import: where it lands plus how to read its content. */
interface ImportEntry {
  fileName: string
  folderPath: string
  relPath: string
  read: () => Promise<string>
}

/**
 * Copy external `.md` files into the vault - the vault is the source of
 * truth, so "import" now means writing the file onto disk inside it.
 */
export function useFileImport() {
  const settings = useSettingsStore()
  const library = useLibraryStore()

  const items = ref<ImportItem[]>([])
  const importing = ref(false)

  /** Shared write loop: dedupe, read, write into the vault, track per-item status. */
  async function runImport(
    entries: ImportEntry[],
    skippedStart: number,
    errorsStart: ImportResult['errors'],
  ): Promise<ImportResult> {
    const existing = new Set(library.files.map((f) => f.relativePath))

    items.value = entries.map((e) => ({
      fileName: e.fileName,
      folderPath: e.folderPath,
      status: 'pending' as const,
    }))

    importing.value = true

    let imported = 0
    let skipped = skippedStart
    const errors = errorsStart

    for (let i = 0; i < entries.length; i++) {
      const { relPath, read } = entries[i]
      const item = items.value[i]

      if (existing.has(relPath)) {
        item.status = 'skipped'
        // 说清略过的缘由，不让用户猜文件为何没进来。
        item.reason = COPY.importDuplicateHint
        skipped++
        continue
      }

      item.status = 'reading'
      try {
        const content = await read()
        item.status = 'saving'
        await nativeFs.writeFile(vaultFile(settings.vaultPath, relPath), content)
        item.status = 'done'
        imported++
      } catch (e) {
        item.status = 'error'
        item.error = e instanceof Error ? e.message : String(e)
        errors.push({ fileName: entries[i].fileName, reason: item.error ?? COPY.importUnknownError })
      }
    }

    importing.value = false
    if (imported > 0) await library.refresh()
    return { imported, skipped, errors }
  }

  /** Browser channel: import dropped/picked File objects. */
  async function importFiles(
    files: File[],
    targetFolder = '',
  ): Promise<ImportResult> {
    const typed = files as (File & { webkitRelativePath?: string })[]
    const mdFiles = typed.filter((f) => MD_EXT.test(f.name))
    const skippedByExtension = typed.length - mdFiles.length

    const entries = mdFiles.map((file) => {
      const relPath = joinPath(targetFolder, relativePathFor(file))
      return {
        fileName: file.name,
        folderPath: folderPathFromRelative(relPath),
        relPath,
        read: () => readFileAsText(file),
      }
    })

    return runImport(entries, skippedByExtension, [])
  }

  /**
   * Desktop channel: import by absolute paths (Tauri native drop) - a single
   * `.md` file comes in as-is, anything else is treated as a folder whose
   * markdown files are gathered recursively, keeping their structure.
   */
  async function importPaths(
    paths: string[],
    targetFolder = '',
  ): Promise<ImportResult> {
    const entries: ImportEntry[] = []
    const errors: ImportResult['errors'] = []
    let skipped = 0

    for (const p of paths) {
      const clean = p.replace(/[\\/]+$/, '')
      const name = clean.split(/[\\/]/).pop() ?? clean
      try {
        if (MD_EXT.test(name)) {
          const relPath = joinPath(targetFolder, name)
          entries.push({
            fileName: name,
            folderPath: folderPathFromRelative(relPath),
            relPath,
            read: () => nativeFs.readFile(clean),
          })
        } else {
          // 非单文件落点视作文件夹：递归扫出其中全部 .md。
          const listing = await nativeFs.readVault(clean)
          if (listing.files.length === 0) {
            skipped++
            continue
          }
          for (const f of listing.files) {
            const relPath = joinPath(targetFolder, f.relativePath)
            entries.push({
              fileName: f.name,
              folderPath: folderPathFromRelative(relPath),
              relPath,
              read: () => nativeFs.readFile(f.path),
            })
          }
        }
      } catch (e) {
        errors.push({ fileName: name, reason: e instanceof Error ? e.message : String(e) })
      }
    }

    return runImport(entries, skipped, errors)
  }

  return { items, importing, importFiles, importPaths }
}
