/**
 * 区带标题两态的快查：菜单里那两条动作（收起 / 展开全部分组）改的是行数不是别的。
 *
 *   node tools/ui-preview/shot.mjs tmp/x.png --url=... --script="import('/tools/ui-preview/scenario-section-collapse.mjs').then(m=>m.default())"
 *
 * ⚠️ 这里用 `.click()` 只为**速查状态**（行数、菜单项、disabled）——它绕不过指针
 * 序列，AGENTS.md 的「假绿」教训正在于此。真鼠标判据一律走
 * `preview-section-probe.mjs`（右键唤菜单、点两项、Alt+点击，每条两轮）。
 */
export default async function sectionActions() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const rows = () => document.querySelectorAll('.folder-row').length
  const menuItems = () =>
    [...document.querySelectorAll('[role="menu"] button')].map((b) => ({
      text: b.textContent.trim(),
      disabled: b.disabled,
    }))
  const click = (el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  const open = rows()

  // 右键区带标题（合成事件足够——这里只验「菜单内容随状态变」）
  const head = document.querySelector('.side-head')
  head.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 145 }),
  )
  await sleep(250)
  const menuWhenOpen = menuItems()

  click(document.querySelector('[role="menu"] button'))
  await sleep(500)
  const collapsed = { rows: rows(), notExpanded: document.querySelector('.side-title') !== null }

  head.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 145 }),
  )
  await sleep(250)
  const menuWhenClosed = menuItems()

  click(document.querySelectorAll('[role="menu"] button')[1])
  await sleep(500)
  const reopened = rows()

  return JSON.stringify(
    {
      open,
      menuWhenOpen,
      collapsedRows: collapsed.rows,
      menuWhenClosed,
      reopened,
      判据:
        collapsed.rows === 0 && reopened === open &&
        menuWhenOpen[0].disabled === false && menuWhenOpen[1].disabled === true &&
        menuWhenClosed[0].disabled === true && menuWhenClosed[1].disabled === false
          ? 'PASS'
          : 'FAIL',
    },
    null,
    1,
  )
}
