/**
 * 临时：把「改名输入框 + 同级重名提示」这一态摆好供截图。用完即删。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async function () {
  const rows = () => [...document.querySelectorAll('.folder-row')]
  const target = rows().find((r) => r.dataset.folderRow === 'SpringBoot')
  target?.querySelector('.folder-action')?.click()
  await sleep(300)
  ;[...document.querySelectorAll('[role="menu"] button')]
    .find((b) => b.textContent.includes('重命名'))
    ?.click()
  await sleep(400)

  const input = document.querySelector('.folder-rename-input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, 'MySQL')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  return { hint: document.querySelector('.folder-rename-hint')?.textContent?.trim() }
}
