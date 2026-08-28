import { defineStore } from 'pinia'

import {
  DEFAULT_SETTINGS,
  type ReaderSettings,
  type ThemeName,
} from '@/types/settings'

const STORAGE_KEY = 'zenreader:settings'

function load(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const useSettingsStore = defineStore('settings', {
  state: (): ReaderSettings => load(),

  actions: {
    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state))
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
