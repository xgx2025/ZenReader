/**
 * 「一个分组都还没有」那一态：把 read_vault 的 dirs 清空、触发一次刷新，看空态怎么排。
 *
 *   node tools/ui-preview/shot.mjs tmp/empty.png --url=... --script="import('/tools/ui-preview/scenario-empty-folders.mjs').then(m=>m.default())"
 *
 * 为什么用改写替身返回值而不是改 preview.js：空书库是**边角态**，不该是预览台的默认
 * 布景；就地劫持一次 invoke，其他场景照旧。
 */
export default async function emptyFolders() {
  const internals = window.__TAURI_INTERNALS__
  if (!internals) return JSON.stringify({ error: 'no tauri internals' })

  const orig = internals.invoke
  internals.invoke = function (cmd, args) {
    if (cmd === 'read_vault') {
      return orig.call(this, cmd, args).then((r) => ({ files: r.files, dirs: [] }))
    }
    return orig.call(this, cmd, args)
  }

  // 触发一次刷新：LibraryView 在 window focus 时会 library.refresh()
  window.dispatchEvent(new Event('focus'))
  await new Promise((r) => setTimeout(r, 900))

  const label = document.querySelector('.side-head .side-title')
  const range = document.createRange()
  if (label) range.selectNodeContents(label)
  const report = {
    rows: document.querySelectorAll('.folder-row').length,
    head: !!document.querySelector('.side-head'),
    /** 空库时这一行仍应只是标签 + ＋（第十轮起行上不再有整行开关） */
    rowButton: !!document.querySelector('.side-head-btn'),
    action: !!document.querySelector('.side-head-action'),
    emptyText: document.querySelector('.side-section > p')?.textContent?.trim() ?? null,
    /** 文字左缘：标签的缩进由自己的 padding 承担，量盒会差 24px */
    labelTextLeft: label ? +range.getBoundingClientRect().x.toFixed(1) : null,
  }
  return JSON.stringify(report, null, 1)
}
