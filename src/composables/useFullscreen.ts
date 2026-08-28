import { ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { isTauri } from '@/lib/native'
import { useSettingsStore } from '@/stores/settings'

/**
 * Window fullscreen state, shared app-wide so the toolbar button, the global
 * F11 shortcut, and Esc all agree on the same value.
 *
 * 全屏 (fullscreen) 与 禅境 (zen mode) 的「沉浸联动」：默认情况下进入全屏自动
 * 开启禅境，退出时智能恢复——仅当禅境是被本次全屏自动开启时才关闭，尊重用户
 * 原本已开启、或全屏中手动切换的状态。可用「沉浸全屏」设置关闭该联动。
 */
const isFullscreen = ref(false)

/** 本次全屏是否「自动开启」了禅境（用于退出时的智能恢复）。 */
let zenAutoOn = false

let unlisten: (() => void) | null = null
let wired = false

export function useFullscreen() {
  /** 全屏状态变化时，按设置联动禅境（进＝开启，退＝智能恢复）。 */
  function applyLinkage(fullscreen: boolean) {
    const settings = useSettingsStore()
    if (!settings.immersiveFullscreen) return
    if (fullscreen) {
      zenAutoOn = !settings.zenMode
      if (!settings.zenMode) settings.setZenMode(true)
    } else if (zenAutoOn) {
      settings.setZenMode(false)
      zenAutoOn = false
    }
  }

  /** Reconcile the local flag with the actual window state. */
  async function sync() {
    if (!isTauri()) return
    const fs = await getCurrentWindow().isFullscreen()
    if (fs !== isFullscreen.value) {
      isFullscreen.value = fs
      applyLinkage(fs)
    }
  }

  async function toggle() {
    if (!isTauri()) return
    await getCurrentWindow().setFullscreen(!isFullscreen.value)
    await sync() // update flag + linkage, even if no resize event fired
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

  return { isFullscreen, toggle, sync, wire }
}
