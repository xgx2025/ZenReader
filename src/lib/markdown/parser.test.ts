import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './parser'
import { extractStructure, htmlToPlainText } from './structure'

describe('LaTeX 数学渲染（texmath + KaTeX）', () => {
  it('行内 $…$ 渲染为 KaTeX，内联 style 经消毒后保留', () => {
    const { html } = renderMarkdown('质能方程 $E=mc^2$ 简洁。')
    // KaTeX 视觉层存在
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-html')
    // 上下标定位依赖的内联 style 必须存活
    expect(html).toContain('style="')
    // 行内包装是 span，且可被样式定位
    expect(html).toContain('class="zen-math-inline"')
  })

  it('块级 $$…$$ 渲染为 .katex-display，包装成 .zen-math-block', () => {
    const { html } = renderMarkdown(
      '块级：\n\n$$ \\int_0^\\infty e^{-x^2}dx = \\frac{\\sqrt{\\pi}}{2} $$\n',
    )
    expect(html).toContain('katex-display')
    expect(html).toContain('class="zen-math-block"')
  })

  it('\\begin{aligned}…\\end{aligned} 环境（前置空行）被识别', () => {
    const { html, plainText } = renderMarkdown(
      '对齐环境：\n\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\n',
    )
    expect(html).toContain('katex-display')
    // 原始源码只存在于无障碍 MathML 的 <annotation>（视觉隐藏层），
    // 可见纯文本中不应出现。
    expect(plainText).not.toContain('\\begin{aligned}')
  })

  it('括号定界 \\(x+1\\) 与 \\[\\sum…\\] 也识别', () => {
    const src = '行内 \\(x+1\\)，块级：\n\n\\[ \\sum_{i=1}^n i \\]\n'
    const { html } = renderMarkdown(src)
    expect(html).toContain('katex')
    expect(html).toContain('katex-display')
  })

  it('MathML 无障碍层保留，但纯文本/目录剔除它（不重复计字、不泄露源码）', () => {
    const { html, plainText } = renderMarkdown('# 能量 $E=mc^2$ 与光速\n\n正文 $x+1$。')
    // 无障碍层仍在（screen reader 可读）
    expect(html).toContain('katex-mathml')
    expect(html).toContain('<math')
    // 纯文本里是可见字形，而非带 $ 的原始源码或 MathML 符号拼写
    expect(plainText).toContain('能量 E=mc2 与光速')
    expect(plainText).not.toContain('E=mc^2')
    expect(plainText).not.toContain('application/x-tex')
    expect(plainText).not.toContain('$E=mc')
    // 目录文本同样干净
    const { toc } = extractStructure(html)
    expect(toc[0].text).toBe('能量 E=mc2 与光速')
  })

  it('转义 \\$ 不触发公式；孤立的金额 $50 原样保留', () => {
    const { html } = renderMarkdown('转义 \\$5 不是公式。价格 $50 元整。')
    expect(html).toContain('$5')
    expect(html).toContain('$50')
    // 两处都不该有 katex 输出
    const katexCount = (html.match(/class="katex"/g) ?? []).length
    expect(katexCount).toBe(0)
  })

  it('错误的公式降级为红字而非抛异常', () => {
    const { html } = renderMarkdown('$\\frac{1}{$ 这种残缺公式不崩。')
    expect(html).toContain('katex-error')
  })

  it('既有消毒防线不因 style 放行而失守', () => {
    // markdown 写法的 javascript: 链接被 validateLink 拒掉（不渲染成 <a>）；
    // 直接注入的 HTML 则由 DOMPurify 剥掉危险协议与事件属性。
    const { html } = renderMarkdown(
      '<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a>',
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('href="javascript:')
  })

  it('既有渲染特性不受影响：任务清单、外链、标题锚点', () => {
    const { html, structure } = renderMarkdown(
      '# 标题\n\n- [ ] 待办\n\n[外链](https://example.com)\n',
    )
    expect(html).toContain('task-list-item')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('target="_blank"')
    expect(structure.toc[0].id).toBe('h-0')
  })
})
