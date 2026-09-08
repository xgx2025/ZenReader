/**
 * 拖动排序自定义序的持久化：独立小文件（不进 settings.json）。
 *
 * 原实现写 localStorage——WebView 存储随应用更新/重装即失，用户排好的序会丢。现在
 * Tauri 环境落盘到书库内的 `.zenreader/arrange.json`（与觉悟笔记 notes.db 同址）：
 * 更新/重装不丢、整库拷走顺序随身。文件放书库内也天然按库隔离——它只属于所在的那本
 * 书库，库被搬走/改名后重开仍能认回，比旧"payload 带 vaultPath、换库不匹配即弃"更稳
 * （文件内容里仍记 vaultPath 以便与旧版 localStorage 语义对得上，读文件时以位置为准）。
 *
 * 浏览器 dev 非 Tauri 时继续走 localStorage；loadArrange 读文件失败（首启/尚未排布）
 * 会回退读 localStorage——把旧版本写下的序迁成磁盘文件，此后不再依赖易失存储。
 */
import { isTauri, nativeFs } from '@/lib/native'
import { vaultFile } from '@/lib/vault'
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

/** 该库的排布文件绝对路径（书库内 .zenreader/arrange.json；read_vault 已跳过隐藏目录）。 */
function arrangeFilePath(vaultPath: string): string {
  return vaultFile(vaultPath, '.zenreader/arrange.json')
}

/**
 * 保留各路径的最后一次出现、去掉早前副本——展示靠末次位置定秩，只留末次即序不变。
 * 旧版在"重启后首次 refresh"会把整条已持久化序复制到最前，历史数据里可能攒下重复项，
 * 读入时自愈成干净排列，避免 merge 撞上旧副本导致首次拖动失效。
 */
function dedupeKeepLast(paths: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    if (seen.has(p)) {
      const i = out.indexOf(p)
      if (i !== -1) out.splice(i, 1)
    }
    seen.add(p)
    out.push(p)
  }
  return out
}

/** 校验并归一化一段 JSON；结构异常 → null（调用方给默认）。 */
function parsePayload(raw: string): Omit<ArrangePersisted, 'vaultPath'> | null {
  try {
    const d = JSON.parse(raw) as Partial<ArrangePersisted>
    if (!d || typeof d !== 'object') return null
    const customOrder = dedupeKeepLast(
      Array.isArray(d.customOrder)
        ? d.customOrder.filter((p): p is string => typeof p === 'string')
        : [],
    )
    const arranged = d.arranged === true
    const sortPreference: ArrangeSortMode = SORT_MODES.includes(
      d.sortPreference as ArrangeSortMode,
    )
      ? (d.sortPreference as ArrangeSortMode)
      : 'auto'
    return { customOrder, arranged, sortPreference }
  } catch {
    return null
  }
}

/** 从旧版 localStorage 读，并做换库守卫；无/结构异常/库不匹配 → null。 */
function legacyLocalPayload(vaultPath: string): ArrangePersisted | null {
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
    if (d.vaultPath !== vaultPath) return null // 旧实现守卫：不在另一书库沿用上一库序
    const p = parsePayload(raw)
    return p ? { vaultPath, ...p } : null
  } catch {
    return null
  }
}

/**
 * 载入某书库的自定义序；从未排布过 → null（调用方落默认）。
 * 读盘失败不抛错——文件缺失/损坏都当"无自定义序"，让 UI 走干净默认。
 */
export async function loadArrange(
  vaultPath: string,
): Promise<ArrangePersisted | null> {
  if (!vaultPath) return null
  if (isTauri()) {
    try {
      const raw = await nativeFs.readFile(arrangeFilePath(vaultPath))
      const p = parsePayload(raw)
      // 文件即"该库的序"：即使内容里记的 vaultPath 因整库搬移已过时，也按当前位置认领。
      if (p) return { vaultPath, ...p }
    } catch {
      /* 文件缺失/读失败 → 回退 localStorage 迁移旧数据 */
    }
    const legacy = legacyLocalPayload(vaultPath)
    if (legacy) {
      // 首启迁移：把旧 WebView 存储里的序落成磁盘文件，此后不再依赖易失存储。
      try {
        await nativeFs.writeFile(
          arrangeFilePath(vaultPath),
          JSON.stringify(legacy),
        )
      } catch {
        /* 写不进（只读库等）不致命：本次会话仍用旧值，下次再试 */
      }
    }
    return legacy
  }
  return legacyLocalPayload(vaultPath)
}

function commit(): void {
  if (!pending) return
  const s = pending
  pending = null
  if (isTauri()) {
    nativeFs
      .writeFile(arrangeFilePath(s.vaultPath), JSON.stringify(s))
      .catch(() => {
        /* 写盘失败（库被移除/权限）静默：下次防抖还会再落一次 */
      })
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch {
      /* 存储满/不可用：下次再试 */
    }
  }
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
