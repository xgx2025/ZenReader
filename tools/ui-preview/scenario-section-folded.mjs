/**
 * 截图前把「全部分组」收起来（合成事件即可——这里只为看版面，不是判据）。
 *
 *   node tools/ui-preview/shot.mjs tmp/x.png --url=... \
 *     --script="import('/tools/ui-preview/scenario-section-folded.mjs').then(m=>m.default())"
 */
export default async function foldAllForShot() {
  const head = document.querySelector('.side-head')
  if (!head) return 'no head'
  const r = head.getBoundingClientRect()
  head.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(r.left + 50),
      clientY: Math.round(r.top + 16),
    }),
  )
  await new Promise((res) => setTimeout(res, 250))
  const collapse = document.querySelectorAll('[role="menu"] button')[0]
  collapse?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((res) => setTimeout(res, 400))
  return JSON.stringify({
    rows: document.querySelectorAll('.folder-row').length,
    emptyText: document.querySelector('.side-section > p')?.textContent?.trim() ?? null,
  })
}
