/**
 * 拖动排序（手动排布）：书库展示顺序的持久化模型。
 *
 * - customOrder：vault 相对路径的完整序列（含全部活文件）。它既是"全部已入位卷"
 *   的顺序，也作为 folder/search 过滤视图在 custom 档下的排列基准（过滤即取子序列）。
 * - folderOrder：分组路径（vault 相对、`/` 分隔）的完整序列，决定同层分组谁先谁后。
 *   与 customOrder 同址同库（arrange.json），故「整库拷走」时分组顺序也随身。
 *   只记用户显式排过的分组；未记录的分组落在字典序上（见 folderTree 的排序规则）。
 * - arranged：是否完成过 ≥1 次有效排布——驱动"排布后即默认"语义（resolveDisplayMode）。
 * - sortPreference：auto 表示由系统解析（有排布→custom，否则→modified）；用户显式
 *   点过胶囊某档则存该档，重开仍记住。
 *
 * 存储独立于 settings.json（见 arrangeStorage.ts）：换书库时以 vaultPath 守卫防串序。
 */
export type ArrangeSortMode = 'auto' | 'modified' | 'title' | 'custom'
export type DisplayMode = 'modified' | 'title' | 'custom'

export interface ArrangePersisted {
  /** 书库绝对路径守卫：不匹配则视为无自定义序，防止在另一书库沿用上一库顺序。 */
  vaultPath: string
  /** 全库完整顺序：全部活文件按自定义序排列的 vault 相对路径。 */
  customOrder: string[]
  /** 分组顺序：用户排过的分组路径序列；缺席的按名字序补位。 */
  folderOrder: string[]
  /** 是否完成过 ≥1 次有效排布。 */
  arranged: boolean
  /** 用户最后显式选择的展示档；'auto' = 依 arranged 自动解析。 */
  sortPreference: ArrangeSortMode
}

/** 把偏好解析为当前生效展示档：auto → 有排布则自定义序，否则最近修改。 */
export function resolveDisplayMode(
  pref: ArrangeSortMode,
  arranged: boolean,
): DisplayMode {
  return pref === 'auto' ? (arranged ? 'custom' : 'modified') : pref
}

export const DEFAULT_ARRANGE: Omit<ArrangePersisted, 'vaultPath'> = {
  customOrder: [],
  folderOrder: [],
  arranged: false,
  sortPreference: 'auto',
}
