import { ref } from 'vue'

import { nativeFs } from '@/lib/native'
import { joinPath, vaultFile, folderPathFromRelative } from '@/lib/vault'
import { COPY } from '@/lib/copy'
import { useSettingsStore } from '@/stores/settings'
import { useLibraryStore } from '@/stores/library'
import type { ImportItem, ImportResult } from '@/types/import'

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

/** Relative target within the vault: folder-picked files keep their structure. */
function relativePathFor(file: File & { webkitRelativePath?: string }): string {
  return file.webkitRelativePath || file.name
}

/**
 * Copy external `.md` files into the vault — the vault is the source of
 * truth, so "import" now means writing the file onto disk inside it.
 */
export function useFileImport() {
  const settings = useSettingsStore()
  const library = useLibraryStore()

  const items = ref<ImportItem[]>([])
  const importing = ref(false)

  async function importFiles(
    files: File[],
    targetFolder = '',
  ): Promise<ImportResult> {
    const typed = files as (File & { webkitRelativePath?: string })[]
    const mdFiles = typed.filter((f) => /\.md$/i.test(f.name))
    const skippedByExtension = typed.length - mdFiles.length

    const existing = new Set(library.files.map((f) => f.relativePath))
    const entries = mdFiles.map((file) => {
      const relPath = joinPath(targetFolder, relativePathFor(file))
      return { file, relPath, folderPath: folderPathFromRelative(relPath) }
    })

    items.value = entries.map((e) => ({
      fileName: e.file.name,
      folderPath: e.folderPath,
      status: 'pending' as const,
    }))

    importing.value = true

    let imported = 0
    let skipped = skippedByExtension
    const errors: ImportResult['errors'] = []

    for (let i = 0; i < entries.length; i++) {
      const { file, relPath } = entries[i]
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
        const content = await readFileAsText(file)
        item.status = 'saving'
        await nativeFs.writeFile(vaultFile(settings.vaultPath, relPath), content)
        item.status = 'done'
        imported++
      } catch (e) {
        item.status = 'error'
        item.error = e instanceof Error ? e.message : String(e)
        errors.push({ fileName: file.name, reason: item.error ?? COPY.importUnknownError })
      }
    }

    importing.value = false
    await library.refresh()
    return { imported, skipped, errors }
  }

  return { items, importing, importFiles }
}
