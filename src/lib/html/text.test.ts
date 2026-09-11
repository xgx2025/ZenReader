import { describe, expect, it } from 'vitest'

import { extractHtmlText, extractHtmlTitle } from './text'

describe('html/text · 静态抽取（不执行脚本）', () => {
  it('extractHtmlText 取 body 文本、剔除 script/style 内容', () => {
    const src = [
      '<!doctype html><html><head><title>卷题</title></head>',
      '<body>',
      '<style>p{color:red}</style>',
      '<h1> 卷  首 </h1>',
      '<script>alert(1)</script>',
      '<p>正文  段。</p>',
      '<template><span>不应出现</span></template>',
      '<noscript>也不出现</noscript>',
      '</body></html>',
    ].join('')
    // 空白折成单空格，script/style/template/noscript 的内容与 title 皆不在列。
    expect(extractHtmlText(src)).toBe('卷 首 正文 段。')
  })

  it('extractHtmlTitle 取 <title> 纯文本并 trim', () => {
    expect(extractHtmlTitle('<html><head><title>  卷首语 </title></head><body>x</body></html>')).toBe(
      '卷首语',
    )
    expect(extractHtmlTitle('<title>a &amp; b</title>')).toBe('a & b')
    expect(extractHtmlTitle('<html><body>没标题</body></html>')).toBeNull()
    expect(extractHtmlTitle('<title>  </title>')).toBeNull()
  })

  it('坏输入静默降级，不抛异常', () => {
    expect(extractHtmlText('')).toBe('')
    expect(extractHtmlTitle('')).toBeNull()
  })

  it('纯文本输入当作 body 文本', () => {
    expect(extractHtmlText('只有一行文字')).toBe('只有一行文字')
  })
})
