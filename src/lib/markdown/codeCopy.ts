import { COPY } from '@/lib/copy'

/**
 * 代码块复制按钮 —— 与 highlight/mermaid 同族的渲染后处理。
 *
 * 给每个 `pre` 注入一枚悬浮复制图标（与 ZIcon 细描边语言同形），
 * hover / 键盘聚焦时浮现；点击取 code 的纯文本（shiki 高亮只是换了
 * 内层 span，textContent 即源码），成功后转为竹青「已复制」短提示。
 * mermaid 块不注入（它会整块替换成图卡）。重复执行安全（按
 * .code-copy 存在性跳过）。样式见 typography.css。
 */

/* 与 ZIcon 的细描边语言一致的双纸片复制图形。 */
const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="13" height="13" x="8.5" y="8.5" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'

export function wireCodeCopy(container: HTMLElement): void {
  const pres = container.querySelectorAll<HTMLPreElement>('pre')
  for (const pre of pres) {
    if (pre.querySelector('code.language-mermaid')) continue
    if (pre.querySelector('.code-copy')) continue
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'code-copy'
    btn.title = COPY.copyCode
    btn.innerHTML = COPY_ICON
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code')?.textContent ?? ''
      navigator.clipboard
        .writeText(code)
        .then(() => {
          btn.textContent = COPY.copied
          btn.classList.add('code-copy-done')
          setTimeout(() => {
            btn.innerHTML = COPY_ICON
            btn.classList.remove('code-copy-done')
          }, 1500)
        })
        .catch(() => {
          /* 剪贴板不可用（非安全上下文）——静默作罢 */
        })
    })
    pre.appendChild(btn)
  }
}
