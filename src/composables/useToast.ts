import { ref } from 'vue'

export type ToastTone = 'bamboo' | 'sandal' | 'dusk'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

const toasts = ref<ToastItem[]>([])

let nextId = 0
const DURATION = 2600
const DEDUPE_WINDOW = 5000
const lastShown = new Map<string, number>()

/**
 * 底部居中的轻提示（延续「接着上次」pill 的语言）。
 * 模块级单例：任何静默失败之处一声轻唤，同文案 5 秒内不重复。
 */
export function useToast() {
  function notify(message: string, tone: ToastTone = 'bamboo') {
    const now = Date.now()
    if (now - (lastShown.get(message) ?? 0) < DEDUPE_WINDOW) return
    lastShown.set(message, now)

    const id = ++nextId
    toasts.value.push({ id, message, tone })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, DURATION)
  }

  return { toasts, notify }
}
