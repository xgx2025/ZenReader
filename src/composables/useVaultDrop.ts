import { ref } from 'vue'
import { useDropZone } from '@vueuse/core'

import { isTauri } from '@/lib/native'
import { COPY } from '@/lib/copy'
import { useFileImport } from '@/composables/useFileImport'
import { useNativeDragDrop } from '@/composables/useNativeDragDrop'
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
  const { importFiles, importPaths } = useFileImport()

  const dragging = ref(false)
  const importing = ref(false)

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

  /** Wrap an ImportResult into the summary shape this page's toast consumes. */
  function summarize(r: {
    imported: number
    skipped: number
    errors: unknown[]
  }): DropImportResult {
    return { imported: r.imported, skipped: r.skipped, failed: r.errors.length }
  }

  if (isTauri()) {
    const { dragging: nativeDragging } = useNativeDragDrop((paths) => {
      beginDrop(() => importPaths(paths, getTargetFolder()).then(summarize))
    })
    // 原生通道持有 dragging 状态，此处转引以保持既有返回值。
    return { dragging: nativeDragging, importing }
  }

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
      beginDrop(async () =>
        summarize(await importFiles(files, getTargetFolder())),
      )
    },
  })

  return { dragging, importing }
}
