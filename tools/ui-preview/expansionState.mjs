/**
 * 展开态预置（页面内脚本片段，供 `Page.addScriptToEvaluateOnNewDocument` 用）。
 *
 * 为什么单独放一处：这条键的 slug 规则是 `useFolderExpansion.storageKey()` 的实现细节。
 * 探针里另抄一份（曾抄成 `D__Documents_My_Knowledge`，双下划线）就会在替身换 vaultPath
 * 时悄悄对不上——而**对不上也不会报错**：`--expanded` 只是失效，页面照样出图，出的是
 * 默认态。所以这里一律按**前缀扫**，不拼完整键。
 */

const PREFIX = 'zenreader.folder.expanded.'

/** 清掉所有书库的展开记录（缺键＝展开，于是页面从「全开」起步）。 */
export const CLEAR_EXPANSION_STATE = `(() => {
  try {
    Object.keys(localStorage)
      .filter((k) => k.indexOf(${JSON.stringify(PREFIX)}) === 0)
      .forEach((k) => localStorage.removeItem(k))
  } catch (e) { /* 隐私模式等：忽略 */ }
})()`

/**
 * 把展开态写成指定书库键。`vaultSlug` 是 vaultPath 经
 * `replace(/[^\w.-]+/g, '_').slice(-96)` 的结果；缺省用预览替身那份的 slug。
 */
export function setExpansionState(json, vaultSlug = 'D_Documents_My_Knowledge') {
  return `(() => {
  try {
    Object.keys(localStorage)
      .filter((k) => k.indexOf(${JSON.stringify(PREFIX)}) === 0)
      .forEach((k) => localStorage.removeItem(k))
    localStorage.setItem(${JSON.stringify(PREFIX)} + ${JSON.stringify(vaultSlug)}, ${JSON.stringify(json)})
  } catch (e) { /* 忽略 */ }
})()`
}
