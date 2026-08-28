import { invoke, isTauri } from '@tauri-apps/api/core'

import type { VaultFile, VaultListing } from '@/types/document'

export type { VaultFile, VaultListing }
export { isTauri }

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
}
