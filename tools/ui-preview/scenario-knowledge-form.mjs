/** Prepare a new topic form; shot.mjs --click then performs the real mouse gesture. */
export default async function prepareKnowledgeForm() {
  for (let i = 0; i < 80 && !document.querySelector('.knowledge-primary'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  document.querySelector('.knowledge-primary').click()
  await new Promise((resolve) => setTimeout(resolve, 150))
  const fields = document.querySelectorAll('.knowledge-field input')
  fields[0].value = '知识如何从阅读变成判断？'
  fields[0].dispatchEvent(new Event('input', { bubbles: true }))
  fields[1].value = '学习方法'
  fields[1].dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 80))
  return { ready: !!document.querySelector('.knowledge-inspector button:not([disabled])'), title: fields[0].value }
}
