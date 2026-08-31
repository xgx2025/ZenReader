import { defineStore } from 'pinia'

import { nativeFs, isTauri } from '@/lib/native'
import {
  DEFAULT_SETTINGS,
  type ReaderSettings,
  type ReminderSettings,
  type ThemeName,
} from '@/types/settings'

const STORAGE_KEY = 'zenreader:settings'

/** 拖动滑杆时每个刻度都会触发写入，防抖合并为一次落盘。 */
let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistFlushWired = false

/**
 * 浅合并之上，对 reminder 再深合并一层：旧版本持久化里存量的 reminder 对象
 * 会整体覆盖默认值，新增字段（如 chime）若无深合并将悄悄丢失。
 * 另做一条迁移：旧版布尔开关 zenRitual（关=快速短雾）由 zenEntry 枚举取代
 * ——曾关掉仪式的老用户落「轻雾」，其余落默认「墨韵」，并剥掉旧键。
 */
function mergeSettings(parsed: Partial<ReaderSettings>): ReaderSettings {
  const merged: ReaderSettings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
    reminder: { ...DEFAULT_SETTINGS.reminder, ...(parsed.reminder ?? {}) },
  }
  if (parsed.zenEntry === undefined) {
    merged.zenEntry =
      (parsed as Partial<ReaderSettings> & { zenRitual?: unknown }).zenRitual ===
      false
        ? 'mist'
        : DEFAULT_SETTINGS.zenEntry
  }
  delete (merged as Partial<ReaderSettings> & { zenRitual?: unknown }).zenRitual
  return merged
}

/**
 * Browser-only fallback: previous session's settings live in localStorage.
 * In the Tauri desktop shell the settings file is the source of truth and
 * localStorage is never read (except as a one-time migration source).
 */
function loadLocal(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return mergeSettings(JSON.parse(raw) as Partial<ReaderSettings>)
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
          this.$patch(mergeSettings(JSON.parse(raw) as Partial<ReaderSettings>))
          // 镜像到 localStorage：index.html 的首帧防闪烁脚本只读得到这里。
          this.mirrorLocal()
        } else {
          const legacy = localStorage.getItem(STORAGE_KEY)
          if (legacy) {
            this.$patch(mergeSettings(JSON.parse(legacy) as Partial<ReaderSettings>))
          }
          await this.persist()
        }
      } catch (e) {
        console.error('[zenreader] load settings failed', e)
      }
      this.wirePersistFlush()
      this.applyAll()
    },

    /** 关窗或切后台前把尚未落盘的防抖写入冲刷掉，最后一次调整不丢。 */
    wirePersistFlush() {
      if (persistFlushWired) return
      persistFlushWired = true
      const flush = () => {
        if (!persistTimer) return
        clearTimeout(persistTimer)
        persistTimer = null
        this.persist()
      }
      window.addEventListener('beforeunload', flush)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush()
      })
    },

    /** Persist to the settings file (Tauri) or localStorage (browser). */
    persist() {
      const json = JSON.stringify(this.$state)
      this.mirrorLocal()
      if (isTauri()) {
        return nativeFs.writeSettings(json).catch((e) => {
          console.error('[zenreader] write settings failed', e)
        })
      }
    },

    /**
     * 把当前设置镜像进 localStorage。Tauri 下 settings.json 才是真源，
     * 但 index.html 的首帧防闪烁内联脚本读不到文件、只读得到 localStorage
     * ——不镜像的话，改过主题的机器首帧会闪回遗留的旧主题。
     */
    mirrorLocal() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state))
      } catch {
        /* 隐私模式等存不进去就算了，不影响主存储 */
      }
    },

    /** Debounced persist：高频更新（滑杆拖动）只落最后一次。 */
    persistSoon() {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        this.persist()
      }, 400)
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
      this.persistSoon()
    },

    /** 更新禅钟提醒配置（不影响主题/排版，仅持久化）。 */
    updateReminder(patch: Partial<ReminderSettings>) {
      this.reminder = { ...this.reminder, ...patch }
      this.persistSoon()
    },
  },
})
