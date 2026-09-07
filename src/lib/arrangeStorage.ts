/**
 * 拖动排序自定义序的持久化：独立 localStorage key（不带进 settings.json）。
 *
 * 与阅读进度（progress）同类：便利态 + vault 相对路径 + 高频防抖写，独立成键只写
 * 这一小块，也让每次无关的"调适"改动不必拖上可能几十 KB 的自定义序。payload 内带
 * vaultPath 守卫——换书库打开时 load 不匹配即返回 null（干净默认），天然防串序。
 */
import type { ArrangePersisted, ArrangeSortMode } from '@/types/arrange'

const STORAGE_KEY = 'zenreader:arrange'
const PERSIST_DEBOUNCE = 600

let pending: ArrangePersisted | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let wired = false

const SORT_MODES: readonly ArrangeSortMode[] = [
  'auto',
  'modified',
  'title',
  'custom',
]

/** 校验并归一化读到的一份 payload；异常/库不匹配 → null（调用方给默认）。 */
export function loadArrange(vaultPath: string): ArrangePersisted | null {
  if (!vaultPath) return null
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<ArrangePersisted>
    if (!d || typeof d !== 'object') return null
    if (d.vaultPath !== vaultPath) return null // 换库守卫
    const customOrder = Array.isArray(d.customOrder)
      ? d.customOrder.filter((p): p is string => typeof p === 'string')
      : []
    const arranged = d.arranged === true
    const sortPreference: ArrangeSortMode = SORT_MODES.includes(
      d.sortPreference as ArrangeSortMode,
    )
      ? (d.sortPreference as ArrangeSortMode)
      : 'auto'
    return { vaultPath, customOrder, arranged, sortPreference }
  } catch {
    return null
  }
}

function commit(): void {
  if (!pending) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
  } catch {
    /* 存储满/不可用：下次再试 */
  }
  pending = null
}

/** 防抖写盘 —— 一次拖动排序内多次 drop 只落最后一次状态。 */
export function scheduleSaveArrange(s: ArrangePersisted): void {
  pending = s
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    commit()
  }, PERSIST_DEBOUNCE)
}

/** 立即落盘（离开窗口 / 隐藏时兜底，防丢最近的改动）。 */
export function flushArrange(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  commit()
}

/** 接线一次性 flush（beforeunload + 隐藏）。只绑一次。 */
export function wireArrangeFlush(): void {
  if (wired) return
  wired = true
  window.addEventListener('beforeunload', flushArrange)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushArrange()
  })
}
