import { Menu, MenuItem } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Image } from '@tauri-apps/api/image'
import { TrayIcon } from '@tauri-apps/api/tray'

import trayIconUrl from '@/assets/tray.png'
import { COPY } from '@/lib/copy'

/**
 * 系统托盘 —— 全局专注钟的门面（方向 B）。
 *
 * 应用运行期间常驻时钟旁：悬停看香的状态，右键「点香/熄香 · 打开主窗 ·
 * 退出」，左键唤回主窗。菜单行为经 hooks 回调到 useZenClock，本模块不持
 * 状态。创建失败（无托盘环境等）静默降级，不碍阅读。
 */

let tray: TrayIcon | null = null
let toggleItem: MenuItem | null = null
let hooks: { isLit: () => boolean; tooltip: () => string; onToggle: () => void } | null =
  null

/** 主窗唤回：最小化/隐藏时重新亮出。 */
async function showMainWindow(): Promise<void> {
  const win = getCurrentWindow()
  await win.show()
  await win.unminimize()
  await win.setFocus()
}

/** 燃香时关窗 = 缩入托盘续烧；真正退出走托盘菜单。 */
export async function hideToTray(): Promise<void> {
  await getCurrentWindow().hide()
}

export async function setupTray(h: {
  isLit: () => boolean
  tooltip: () => string
  onToggle: () => void
}): Promise<void> {
  if (tray) return
  hooks = h
  try {
    const bytes = new Uint8Array(await (await fetch(trayIconUrl)).arrayBuffer())
    const icon = await Image.fromBytes(bytes)
    toggleItem = await MenuItem.new({
      id: 'zen-toggle',
      text: h.isLit() ? COPY.snuff : COPY.trayIgnite,
      action: () => h.onToggle(),
    })
    const openItem = await MenuItem.new({
      id: 'zen-open',
      text: COPY.trayOpen,
      action: () => void showMainWindow(),
    })
    const quitItem = await MenuItem.new({
      id: 'zen-quit',
      text: COPY.trayQuit,
      action: () => void getCurrentWindow().destroy(),
    })
    const menu = await Menu.new({ items: [toggleItem, openItem, quitItem] })
    tray = await TrayIcon.new({
      id: 'zenreader-clock',
      icon,
      tooltip: h.tooltip(),
      menu,
      showMenuOnLeftClick: false,
      // 左键（不带菜单）唤回主窗；右击也是 'Click'，须再验按键才不出列。
      action: (e) => {
        if (e.type === 'Click' && e.button === 'Left') void showMainWindow()
      },
    })
  } catch (e) {
    console.warn('[zenreader] tray init failed:', e)
    tray = null
  }
}

/** 菜单文案与悬停提示随燃香状态刷新（由 useZenClock 驱动）。 */
export async function syncTray(): Promise<void> {
  if (!tray || !toggleItem || !hooks) return
  try {
    await toggleItem.setText(hooks.isLit() ? COPY.snuff : COPY.trayIgnite)
    await tray.setTooltip(hooks.tooltip())
  } catch {
    /* 托盘已被系统移除等——静默 */
  }
}
