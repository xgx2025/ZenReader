import { ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { isTauri } from '@/lib/native'
import { useSettingsStore } from '@/stores/settings'

/**
 * Window fullscreen state, shared app-wide so the toolbar button, the global
 * F11 shortcut, and Esc all agree on the same value.
 *
 * 全屏 (fullscreen) 与 禅境 (zen mode) 是包含关系：禅境含全屏，全屏只是全屏。
 * 入禅境（按钮 / Z 键）按「沉浸全屏」设置自动进入全屏，出定时仅当全屏是
 * 被本次入定自动开启的才一并退去；手动进的全屏（F11 / 工具栏按钮）与
 * 禅境互不牵动。
 */
const isFullscreen = ref(false)

/** 本次禅境是否「自动开启」了全屏（用于出定时的智能恢复）。 */
let fsAutoOn = false

let unlisten: (() => void) | null = null
let wired = false

export function useFullscreen() {
  /**
   * 禅境状态变化时，按设置联动全屏：入定自动全屏，出定时仅当全屏确由
   * 本次入定自动开启才一并退去。
   */
  async function applyZenLinkage(zen: boolean) {
    const settings = useSettingsStore()
    if (!settings.immersiveFullscreen) return
    if (zen) {
      fsAutoOn = !isFullscreen.value
      if (!isFullscreen.value) await toggle()
    } else if (fsAutoOn && isFullscreen.value) {
      await toggle()
    }
  }

  /**
   * 用户主动出入禅境（按钮 / Z 键 / Esc）的统一入口：先改禅境再联动全屏。
   */
  async function setZen(zen: boolean) {
    useSettingsStore().setZenMode(zen)
    await applyZenLinkage(zen)
  }

  /** Reconcile the local flag with the actual window state. */
  async function sync() {
    if (!isTauri()) return
    const fs = await getCurrentWindow().isFullscreen()
    if (fs !== isFullscreen.value) {
      isFullscreen.value = fs
      // 全屏一经任何途径退出，入定时自动开启的全屏即告作废，不再追溯。
      if (!fs) fsAutoOn = false
    }
  }

  async function toggle() {
    if (!isTauri()) return
    await getCurrentWindow().setFullscreen(!isFullscreen.value)
    await sync() // update flag, even if no resize event fired
  }

  /**
   * Attach the resize listener once. Entering/leaving fullscreen always resizes
   * the window, so this keeps the flag true to the OS even when the change came
   * from outside the app (macOS green button, some Linux WMs).
   */
  async function wire() {
    if (!isTauri() || wired) return
    wired = true
    await sync()
    unlisten = await getCurrentWindow().onResized(sync)
  }

  return { isFullscreen, toggle, setZen, sync, wire }
}
