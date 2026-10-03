/** 设置弹窗六个分类的外框尺寸；供改前/改后同条件复量。 */
export default async function measureSettingsSize() {
  const opener = document.querySelector('button[aria-label="设置"]')
  if (!(opener instanceof HTMLButtonElement)) throw new Error('找不到设置入口')
  opener.click()
  await new Promise(requestAnimationFrame)

  const dialog = document.querySelector('[role="dialog"][aria-label="设置"]')
  if (!(dialog instanceof HTMLElement)) throw new Error('设置弹窗未打开')
  const tabs = [...dialog.querySelectorAll('[role="tab"]')]
  const measurements = []
  for (const tab of tabs) {
    if (!(tab instanceof HTMLButtonElement)) throw new Error('分类按钮缺失')
    tab.click()
    await new Promise(requestAnimationFrame)
    const box = dialog.getBoundingClientRect()
    const scrollArea = dialog.querySelector('.overflow-y-auto')
    measurements.push({
      category: tab.textContent?.trim().replace(/\s+/g, ' '),
      x: +box.x.toFixed(1),
      y: +box.y.toFixed(1),
      width: +box.width.toFixed(1),
      height: +box.height.toFixed(1),
      scrollHeight: scrollArea?.scrollHeight,
      clientHeight: scrollArea?.clientHeight,
    })
  }
  if (tabs[0] instanceof HTMLButtonElement) tabs[0].click()
  return measurements
}
