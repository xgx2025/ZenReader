/** 书库侧栏的横向溢出量及越过右缘的子元素。 */
export default function measureSidebarOverflow() {
  const sidebar = document.querySelector('.sidebar')
  if (!(sidebar instanceof HTMLElement)) throw new Error('找不到书库侧栏')
  const box = sidebar.getBoundingClientRect()
  const handle = sidebar.querySelector('.sidebar-resize')
  const hit = document.elementFromPoint(box.right - 2, box.top + box.height / 2)
  const excess = [...sidebar.querySelectorAll('*')]
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.right > box.right + 0.5)
    .sort((a, b) => b.rect.right - a.rect.right)
    .slice(0, 8)
    .map(({ el, rect }) => ({
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === 'string' ? el.className : '',
      right: +rect.right.toFixed(1),
      overBy: +(rect.right - box.right).toFixed(1),
    }))
  return {
    width: +box.width.toFixed(1),
    clientWidth: sidebar.clientWidth,
    scrollWidth: sidebar.scrollWidth,
    horizontalOverflow: sidebar.scrollWidth - sidebar.clientWidth,
    overflowX: getComputedStyle(sidebar).overflowX,
    resizeHandleHit: !!handle && (hit === handle || handle.contains(hit)),
    excess,
  }
}
