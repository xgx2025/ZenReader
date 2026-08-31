import { invoke, isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

import type { VaultFile, VaultListing } from '@/types/document'

export type { VaultFile, VaultListing }
export { isTauri }

/**
 * 用系统默认浏览器打开外部链接；非 Tauri 环境（浏览器 dev）返回 false，
 * 交给浏览器自身的默认行为（新标签）。
 */
export async function openExternal(url: string): Promise<boolean> {
  if (!isTauri()) return false
  try {
    await openUrl(url)
    return true
  } catch (e) {
    console.error('[zenreader] open external url failed:', url, e)
    return false
  }
}

/** Thin wrappers over the Tauri Rust filesystem commands. */
export const nativeFs = {
  /** Open a native folder picker; returns an absolute path or null if cancelled. */
  pickFolder(): Promise<string | null> {
    return invoke<string | null>('pick_folder')
  },

  /** Recursively list all `.md` files and directories under `dir`. */
  readVault(dir: string): Promise<VaultListing> {
    return invoke<VaultListing>('read_vault', { dir })
  },

  readFile(path: string): Promise<string> {
    return invoke<string>('read_file', { path })
  },

  writeFile(path: string, content: string): Promise<void> {
    return invoke('write_file', { path, content })
  },

  deleteFile(path: string): Promise<void> {
    return invoke('delete_file', { path })
  },

  createDir(path: string): Promise<void> {
    return invoke('create_dir', { path })
  },

  moveFile(from: string, to: string): Promise<void> {
    return invoke('move_file', { from, to })
  },

  /** Read the persisted settings JSON from the app config dir; null if absent. */
  readSettings(): Promise<string | null> {
    return invoke<string | null>('read_settings')
  },

  /** Write settings JSON to the app config dir (file-based persistence). */
  writeSettings(content: string): Promise<void> {
    return invoke('write_settings', { content })
  },
}
