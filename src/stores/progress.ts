import { ref } from 'vue'
import { defineStore } from 'pinia'

import { rewritePathPrefix } from '@/lib/vault'
import type { ProgressEntry, ProgressIndex } from '@/types/progress'

const STORAGE_KEY = 'zenreader:progress'
const PERSIST_DEBOUNCE = 800
const MAX_ENTRIES = 300

function load(): ProgressIndex {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProgressIndex
    }
  } catch {
    /* corrupt - start fresh */
  }
  return {}
}

/**
 * Reading positions, keyed by vault-relative path. Lives in localStorage
 * (like settings): it is convenience state, not content - updates arrive
 * on every scroll, so persistence is debounced and dirt-cheap.
 */
export const useProgressStore = defineStore('progress', () => {
  const entries = ref<ProgressIndex>(load())

  let timer: ReturnType<typeof setTimeout> | null = null

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.value))
  }

  /** Keep only the most recent entries so the index cannot grow forever. */
  function prune() {
    const keys = Object.keys(entries.value)
    if (keys.length <= MAX_ENTRIES) return
    const byAge = keys
      .map((k) => ({ k, at: entries.value[k].at }))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
    for (const { k } of byAge.slice(MAX_ENTRIES)) delete entries.value[k]
  }

  /** Debounced persist - many records land during a single scroll. */
  function schedulePersist() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      prune()
      persist()
    }, PERSIST_DEBOUNCE)
  }

  /** Write through immediately (leaving the reader / closing the tab). */
  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    persist()
  }

  function get(relativePath: string): ProgressEntry | null {
    return entries.value[relativePath] ?? null
  }

  /** Record the current scroll ratio; hash guards against stale positions. */
  function record(relativePath: string, hash: string, ratio: number) {
    entries.value[relativePath] = { ratio, hash, at: new Date().toISOString() }
    schedulePersist()
  }

  function drop(relativePath: string) {
    delete entries.value[relativePath]
    schedulePersist()
  }

  /** Follow a file move so the position survives the new path. */
  function move(from: string, to: string) {
    if (!(from in entries.value)) return
    entries.value[to] = entries.value[from]
    delete entries.value[from]
    schedulePersist()
  }

  /**
   * 分组改名 / 搬家：整棵子树内所有条目的路径前缀一起换。
   * 用整表替换触发响应式（`entries` 是 ref，原地改键不会通知）。
   */
  function moveFolder(from: string, to: string) {
    if (!from) return
    const next: ProgressIndex = {}
    let touched = false
    for (const [path, entry] of Object.entries(entries.value)) {
      const moved = rewritePathPrefix(path, from, to)
      if (moved !== path) touched = true
      next[moved] = entry
    }
    if (!touched) return
    entries.value = next
    schedulePersist()
  }

  return { entries, get, record, drop, move, moveFolder, flush }
})
