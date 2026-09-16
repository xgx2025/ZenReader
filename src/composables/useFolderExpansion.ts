import { computed, ref, watch, type Ref } from 'vue'

import { TREE_ROOT_KEY, folderAncestors } from '@/lib/folderTree'
import { rewritePathPrefix } from '@/lib/vault'
import { useSettingsStore } from '@/stores/settings'

/**
 * 侧栏分组的展开态（**与选中态无关**）。
 *
 * 这是一处刻意的解耦：早期实现把「点自己 = 回书库」当成折叠开关，结果是——不切走
 * 选中就永远收不起任何子树，而点一下已选中的分组又会静默丢掉位置。现在点击行名只
 * 负责选中（取消只由「书库」行与面包屑承担），左边的折页只负责开合。
 *
 * 持久化按书库根路径分键：换库不互相污染，重开应用回到上次的开合形状。缺失键一律
 * 视为**展开**（默认看得见内容），只有显式 false 才算收起。
 */

/** localStorage 前缀。换键名即放弃旧记录，不做迁移。 */
const KEY_PREFIX = 'zenreader.folder.expanded.'
/** 记录上限：超限按插入序裁剪，防单个书库把 localStorage 撑爆。 */
const MAX_KEYS = 500

/** 路径里可能带空格、中文、盘符——压成合法且可读的键片段。 */
function storageKey(vaultPath: string): string {
  const slug = vaultPath.replace(/[^\w.-]+/g, '_').slice(-96)
  return `${KEY_PREFIX}${slug}`
}

function load(vaultPath: string): Record<string, boolean> {
  if (!vaultPath || typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey(vaultPath))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {} // 坏记录不该让侧栏开不了张
  }
}

function save(vaultPath: string, record: Record<string, boolean>): void {
  if (!vaultPath || typeof localStorage === 'undefined') return
  try {
    const keys = Object.keys(record)
    if (keys.length > MAX_KEYS) {
      // 先记先弃：只保留最近写入的 MAX_KEYS 条（插入序即写入序）。
      for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete record[k]
    }
    localStorage.setItem(storageKey(vaultPath), JSON.stringify(record))
  } catch {
    // 配额满 / 隐私模式：展开态退化为会话内有效，功能不受影响。
  }
}

// 模块级单例：展开态跨组件实例共享，`useFolderExpansion()` 可在任意处安全调用。
const expanded = ref<Record<string, boolean>>({})
let bound = ''

function bindVault(vaultPath: string): void {
  if (vaultPath === bound) return
  bound = vaultPath
  expanded.value = load(vaultPath)
}

/** 改一条记录并落盘。整表替换（而非改字段）是为了让 `expanded` 的变化可被 watch 到。 */
function setKey(key: string, value: boolean): void {
  expanded.value = { ...expanded.value, [key]: value }
  if (bound) save(bound, expanded.value)
}

export function useFolderExpansion(): {
  expanded: Ref<Record<string, boolean>>
  rootExpanded: Ref<boolean>
  isExpanded: (path: string) => boolean
  toggle: (path: string) => void
  reveal: (path: string) => void
  toggleRoot: () => void
  rekey: (from: string, to: string) => void
} {
  const settings = useSettingsStore()
  bindVault(settings.vaultPath)
  // 换库即换记录；watch 而非 computed——载入是一次性副作用，不是派生值。
  watch(() => settings.vaultPath, bindVault)

  /** 缺失即展开——只有显式 false 才是收起。 */
  function isExpanded(path: string): boolean {
    return expanded.value[path] !== false
  }

  function toggle(path: string): void {
    if (!path) return
    setKey(path, !isExpanded(path))
  }

  /** 展开祖先链（不含自身）。折叠着的高亮不可见，选中后必须让它显形。 */
  function reveal(path: string): void {
    for (const a of folderAncestors(path)) {
      if (expanded.value[a] === false) setKey(a, true)
    }
  }

  function toggleRoot(): void {
    setKey(TREE_ROOT_KEY, !(expanded.value[TREE_ROOT_KEY] !== false))
  }

  /**
   * 分组改名 / 搬家：把展开记录里的旧前缀整段换成新前缀。
   * 不换的话，改过名的分组会「自己弹开/自己合上」——记录还在旧路径上，
   * 新路径查不到记录即按默认「展开」，用户刚收起的子树会重新张开。
   */
  function rekey(from: string, to: string): void {
    if (!from || !to || from === to) return
    const next: Record<string, boolean> = {}
    let touched = false
    for (const [path, open] of Object.entries(expanded.value)) {
      const moved = rewritePathPrefix(path, from, to)
      if (moved !== path) touched = true
      next[moved] = open
    }
    if (!touched) return
    expanded.value = next
    if (bound) save(bound, next)
  }

  return {
    expanded,
    rootExpanded: computed(() => expanded.value[TREE_ROOT_KEY] !== false),
    isExpanded,
    toggle,
    reveal,
    toggleRoot,
    rekey,
  }
}
