import { invoke, isTauri } from '@tauri-apps/api/core'

/** A markdown file discovered under a vault folder. */
export interface VaultFile {
  name: string
  /** Absolute path on disk. */
  path: string
  /** Path relative to the vault root, `/`-separated. */
  relativePath: string
}

export { isTauri }

/** Thin wrappers over the Tauri Rust filesystem commands. */
export const nativeFs = {
  /** Open a native folder picker; returns an absolute path or null if cancelled. */
  pickFolder(): Promise<string | null> {
    return invoke<string | null>('pick_folder')
  },

  /** Recursively list all `.md` files under `dir`. */
  readVault(dir: string): Promise<VaultFile[]> {
    return invoke<VaultFile[]>('read_vault', { dir })
  },

  readFile(path: string): Promise<string> {
    return invoke<string>('read_file', { path })
  },

  writeFile(path: string, content: string): Promise<void> {
    return invoke('write_file', { path, content })
  },
}
