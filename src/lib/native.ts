import { invoke, isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

import type { VaultFile, VaultListing } from '@/types/document'
import type { Note } from '@/types/note'

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

  /** Delete an empty 分组 inside the vault; refuses any folder still holding files. */
  removeFolder(dir: string, relativePath: string): Promise<void> {
    return invoke('remove_folder', { dir, relativePath })
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

/**
 * 觉悟笔记的 SQLite 后端命令。`dir` 一律是书库根路径；相对路径由 Rust 侧
 * 拼 `.zenreader/notes.db`。参数经 Tauri 自动转 camelCase（snake_case → camelCase）。
 */
export const nativeNotes = {
  list(dir: string, relativePath: string): Promise<Note[]> {
    return invoke<Note[]>('notes_list', { dir, relativePath })
  },

  add(dir: string, note: Note): Promise<void> {
    return invoke('notes_add', { dir, note })
  },

  update(
    dir: string,
    id: string,
    noteText: string | null,
    kind: string | null,
    updatedAt: string,
  ): Promise<void> {
    return invoke('notes_update', { dir, id, noteText, kind, updatedAt })
  },

  remove(dir: string, id: string): Promise<void> {
    return invoke('notes_delete', { dir, id })
  },

  moveDocument(dir: string, from: string, to: string): Promise<void> {
    return invoke('notes_move_document', { dir, from, to })
  },

  deleteDocument(dir: string, relativePath: string): Promise<void> {
    return invoke('notes_delete_document', { dir, relativePath })
  },
}
