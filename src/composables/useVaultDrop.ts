import { onBeforeUnmount, ref } from 'vue'
import { useDropZone } from '@vueuse/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'

import { isTauri, nativeFs } from '@/lib/native'
import { joinPath, vaultFile } from '@/lib/vault'
import { COPY } from '@/lib/copy'
import { useFileImport } from '@/composables/useFileImport'
import { useSettingsStore } from '@/stores/settings'
import { useLibraryStore } from '@/stores/library'
import { useToast } from '@/composables/useToast'

export interface DropImportResult {
  imported: number
  skipped: number
  failed: number
}

/**
 * 书库页拖拽引卷，双通道：
 * - 桌面端：Tauri 默认拦截 HTML5 file drop，故走原生 onDragDropEvent
 *   拿落点绝对路径，经 Rust 命令读盘后写入 vault（拖入文件夹则递归收录）。
 * - 浏览器：useDropZone 收 File 对象，复用 useFileImport 的解码与写入。
 */
export function useVaultDrop(
  getTargetFolder: () => string,
  onResult: (r: DropImportResult) => void,
) {
  const settings = useSettingsStore()
  const library = useLibraryStore()
  const { notify } = useToast()
  const { importFiles } = useFileImport()

  const dragging = ref(false)
  const importing = ref(false)

  let unlisten: (() => void) | null = null
  let disposed = false

  /** 桌面端：按绝对路径导入（单文件或整个文件夹），保留文件夹内部结构。 */
  async function importPaths(paths: string[]): Promise<DropImportResult> {
    const targetFolder = getTargetFolder()
    const existing = new Set(library.files.map((f) => f.relativePath))
    let imported = 0
    let skipped = 0
    let failed = 0

    for (const p of paths) {
      try {
        if (/\.md$/i.test(p)) {
          const name = p.split(/[\\/]/).pop() ?? p
          const rel = joinPath(targetFolder, name)
          if (existing.has(rel)) {
            skipped++
            continue
          }
          const content = await nativeFs.readFile(p)
          await nativeFs.writeFile(vaultFile(settings.vaultPath, rel), content)
          existing.add(rel)
          imported++
        } else {
          // 非单文件落点视作文件夹：递归扫出其中全部 .md。
          const listing = await nativeFs.readVault(p.replace(/[\\/]+$/, ''))
          if (listing.files.length === 0) {
            skipped++
            continue
          }
          for (const f of listing.files) {
            const rel = joinPath(targetFolder, f.relativePath)
            if (existing.has(rel)) {
              skipped++
              continue
            }
            const content = await nativeFs.readFile(f.path)
            await nativeFs.writeFile(vaultFile(settings.vaultPath, rel), content)
            existing.add(rel)
            imported++
          }
        }
      } catch {
        failed++
      }
    }

    if (imported > 0) await library.refresh()
    return { imported, skipped, failed }
  }

  function beginDrop(run: () => Promise<DropImportResult>) {
    if (!settings.vaultPath) {
      notify(COPY.vaultNotOpen, 'sandal')
      return
    }
    if (importing.value) return
    importing.value = true
    run()
      .then(onResult)
      .finally(() => {
        importing.value = false
      })
  }

  if (isTauri()) {
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const t = event.payload
        if (t.type === 'enter' || t.type === 'over') {
          dragging.value = true
        } else if (t.type === 'leave') {
          dragging.value = false
        } else if (t.type === 'drop') {
          dragging.value = false
          if (!t.paths.length) return
          beginDrop(() => importPaths(t.paths))
        }
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
  } else {
    useDropZone(document.body, {
      onEnter: () => {
        dragging.value = true
      },
      onLeave: () => {
        dragging.value = false
      },
      onDrop: (files) => {
        dragging.value = false
        if (!files?.length) return
        beginDrop(async () => {
          const r = await importFiles(files, getTargetFolder())
          return {
            imported: r.imported,
            skipped: r.skipped,
            failed: r.errors.length,
          }
        })
      },
    })
  }

  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
  })

  return { dragging, importing }
}
