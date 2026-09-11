import { ref } from 'vue'

import { nativeFs } from '@/lib/native'
import { joinPath, vaultFile, folderPathFromRelative, DOC_EXT, isHtmlFile } from '@/lib/vault'
import { COPY } from '@/lib/copy'
import { useSettingsStore } from '@/stores/settings'
import { useLibraryStore } from '@/stores/library'
import type { ImportItem, ImportResult } from '@/types/import'

/** Only `.md` goes through the UTF-8 text path (existing behaviour, untouched). */
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

/** Chunked binary → base64 (spread per chunk avoids stack overflow on big files). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** Relative target within the vault: folder-picked files keep their structure. */
function relativePathFor(file: File & { webkitRelativePath?: string }): string {
  return file.webkitRelativePath || file.name
}

/**
 * One file to import. `write` knows *how* to land the bytes at the absolute
 * destination — HTML copies raw bytes (a text round-trip would re-encode e.g.
 * GBK content while leaving its `<meta charset>` intact, so read_html would
 * later mis-decode it); `.md` keeps its historical UTF-8 text path.
 */
interface ImportEntry {
  fileName: string
  folderPath: string
  relPath: string
  write: (destAbs: string) => Promise<void>
}

/**
 * Copy external `.md`/`.html` files into the vault - the vault is the source of
 * truth, so "import" now means writing the file onto disk inside it.
 */
export function useFileImport() {
  const settings = useSettingsStore()
  const library = useLibraryStore()

  const items = ref<ImportItem[]>([])
  const importing = ref(false)

  /** Shared write loop: dedupe, write into the vault, track per-item status. */
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
      const { relPath, write } = entries[i]
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
        item.status = 'saving'
        await write(vaultFile(settings.vaultPath, relPath))
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
    const docFiles = typed.filter((f) => DOC_EXT.test(f.name))
    const skippedByExtension = typed.length - docFiles.length

    const entries = docFiles.map((file) => {
      const relPath = joinPath(targetFolder, relativePathFor(file))
      return {
        fileName: file.name,
        folderPath: folderPathFromRelative(relPath),
        relPath,
        // .md 沿用文本路径；.html 按原始字节 base64 落盘。
        write: isHtmlFile(file.name)
          ? async (dest: string) =>
              nativeFs.writeBase64(dest, arrayBufferToBase64(await file.arrayBuffer()))
          : async (dest: string) => nativeFs.writeFile(dest, await readFileAsText(file)),
      }
    })

    return runImport(entries, skippedByExtension, [])
  }

  /**
   * Desktop channel: import by absolute paths (Tauri native drop). A single
   * `.md`/`.html` file comes in as-is; anything else is treated as a folder
   * whose supported documents are gathered recursively, keeping structure.
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
            write: async (dest: string) =>
              nativeFs.writeFile(dest, await nativeFs.readFile(clean)),
          })
        } else if (isHtmlFile(name)) {
          // 单个 .html 落点按文件导入——绝不能当文件夹递归 readVault（会把本文件当根，
          // 得出空 relativePath 而误写）。原样字节拷贝进书库。
          const relPath = joinPath(targetFolder, name)
          entries.push({
            fileName: name,
            folderPath: folderPathFromRelative(relPath),
            relPath,
            write: async (dest: string) => nativeFs.copyFile(clean, dest),
          })
        } else {
          // 其它落点视作文件夹：递归扫出全部 .md/.html，各按格式保字节。
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
              write: isHtmlFile(f.name)
                ? async (dest: string) => nativeFs.copyFile(f.path, dest)
                : async (dest: string) =>
                    nativeFs.writeFile(dest, await nativeFs.readFile(f.path)),
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
