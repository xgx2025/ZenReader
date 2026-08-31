import { onBeforeUnmount, ref } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'

import { isTauri } from '@/lib/native'

/**
 * 桌面端拖放：Tauri 默认拦截 HTML5 file drop，webview 收不到 drop 事件，
 * 故经原生 onDragDropEvent 拿落点绝对路径交给回调。浏览器环境无副作用。
 */
export function useNativeDragDrop(onDrop: (paths: string[]) => void) {
  const dragging = ref(false)

  let unlisten: (() => void) | null = null
  let disposed = false

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
          onDrop(t.paths)
        }
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
  }

  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
  })

  return { dragging }
}
