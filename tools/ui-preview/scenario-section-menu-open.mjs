/** 截图前打开区带菜单（合成 contextmenu 即可——菜单只认坐标不认指针序列）。 */
export default async function openSectionMenu() {
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
  await new Promise((res) => setTimeout(res, 300))
  return JSON.stringify(
    [...document.querySelectorAll('[role="menu"] button')].map((b) => b.textContent.trim()),
  )
}
