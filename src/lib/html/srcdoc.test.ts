import { describe, expect, it } from 'vitest'

import { buildZenAssetBase, buildSrcdoc } from './srcdoc'

const AGENT = '(function(){})()'

function inject(source: string, baseHref = 'zenasset://asset/x/') {
  return buildSrcdoc(source, {
    baseHref,
    cfg: { nonce: 'n1', relPath: 'a/x.html', theme: 'light' },
    agentRaw: AGENT,
  })
}

describe('srcdoc · 装配', () => {
  it('buildZenAssetBase：目录逐段编码、库根无斜杠后缀混乱', () => {
    expect(buildZenAssetBase('')).toBe('zenasset://asset/')
    expect(buildZenAssetBase('a')).toBe('zenasset://asset/a/')
    expect(buildZenAssetBase('哲学/随笔')).toBe(
      'zenasset://asset/%E5%93%B2%E5%AD%A6/%E9%9A%8F%E7%AC%94/',
    )
    expect(buildZenAssetBase('/a//b/')).toBe('zenasset://asset/a/b/')
  })

  it('有 <head> 时插到其起始标签之后（属性也跳过）', () => {
    const src = '<html><head data-x="1"><title>T</title></head><body>b</body></html>'
    const out = inject(src)
    const at = src.indexOf('<title>')
    expect(out).toBe(
      src.slice(0, at) +
        `<base href="zenasset://asset/x/"><script>window.__ZENREADER_CFG=${JSON.stringify(
          { nonce: 'n1', relPath: 'a/x.html', theme: 'light' },
        ).replace(/</g, '\\u003c')}</script><script>${AGENT}</script>` +
        src.slice(at),
    )
  })

  it('无 head 有 <html>：插在 <html …> 之后', () => {
    const src = '<html lang="zh"><body>正文</body></html>'
    const out = inject(src)
    expect(out).toContain('<html lang="zh"><base ')
    expect(out).toContain('</script><body>正文</body></html>')
  })

  it('无任何根元素：越过 doctype/注释再插入', () => {
    const src = '<!doctype html><!-- c --><p>hi</p>'
    const out = inject(src)
    expect(out.startsWith('<!doctype html><!-- c --><base')).toBe(true)
    expect(out).toContain('</script><p>hi</p>')
  })

  it('纯片段：插在最前', () => {
    const out = inject('<p>hi</p>')
    expect(out.startsWith('<base ')).toBe(true)
    expect(out.endsWith('</script><p>hi</p>')).toBe(true)
  })

  it('不重写原文——原文正文逐字符保留', () => {
    const src = '<html><head><title>T</title></head><body>\n  <h1>卷</h1>\n</body></html>'
    const out = inject(src)
    // 抽取注入段之外的部分应等于原文顺序拼接。
    const removed = out
      .replace(
        /<base href="[^"]*"><script>window\.__ZENREADER_CFG=.*?<\/script><script>\(function\(\)\{\}\)\(\)<\/script>/,
        '',
      )
    expect(removed).toBe(src)
  })
})
