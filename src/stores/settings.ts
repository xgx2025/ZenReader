import { defineStore } from 'pinia'

import { nativeFs, isTauri } from '@/lib/native'
import {
  DEFAULT_SETTINGS,
  type ReaderSettings,
  type ThemeName,
} from '@/types/settings'

const STORAGE_KEY = 'zenreader:settings'

/**
 * Browser-only fallback: previous session's settings live in localStorage.
 * In the Tauri desktop shell the settings file is the source of truth and
 * localStorage is never read (except as a one-time migration source).
 */
function loadLocal(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const useSettingsStore = defineStore('settings', {
  state: (): ReaderSettings => (isTauri() ? { ...DEFAULT_SETTINGS } : loadLocal()),

  actions: {
    /**
     * Load persisted settings exactly once, before the app mounts.
     * - Tauri: read `settings.json` from the app config dir; on first run,
     *   migrate any legacy localStorage settings into the file.
     * - Browser: keep the synchronous localStorage snapshot already in state.
     */
    async init() {
      if (!isTauri()) {
        this.applyAll()
        return
      }
      try {
        const raw = await nativeFs.readSettings()
        if (raw != null) {
          this.$patch({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettings>) })
        } else {
          const legacy = localStorage.getItem(STORAGE_KEY)
          if (legacy) {
            this.$patch({ ...DEFAULT_SETTINGS, ...(JSON.parse(legacy) as Partial<ReaderSettings>) })
          }
          await this.persist()
        }
      } catch (e) {
        console.error('[zenreader] load settings failed', e)
      }
      this.applyAll()
    },

    /** Persist to the settings file (Tauri) or localStorage (browser). */
    persist() {
      const json = JSON.stringify(this.$state)
      if (isTauri()) {
        return nativeFs.writeSettings(json).catch((e) => {
          console.error('[zenreader] write settings failed', e)
        })
      }
      localStorage.setItem(STORAGE_KEY, json)
    },

    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.theme)
    },

    applyReaderVars() {
      const root = document.documentElement
      root.style.setProperty('--reader-font-size', `${this.fontSize}px`)
      root.style.setProperty('--reader-line-height', String(this.lineHeight))
      root.style.setProperty('--reader-text-width', `${this.textWidth}rem`)
      root.style.setProperty(
        '--reader-font-family',
        this.fontFamily === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
      )
    },

    /** Apply theme + reader vars together (called on app mount). */
    applyAll() {
      this.applyTheme()
      this.applyReaderVars()
    },

    setTheme(theme: ThemeName) {
      this.theme = theme
      this.applyTheme()
      this.persist()
    },

    setZenMode(zenMode: boolean) {
      this.zenMode = zenMode
      this.persist()
    },

    setVaultPath(path: string) {
      this.vaultPath = path
      this.persist()
    },

    update(patch: Partial<ReaderSettings>) {
      Object.assign(this, patch)
      this.applyAll()
      this.persist()
    },
  },
})
