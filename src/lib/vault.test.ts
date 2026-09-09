import { describe, expect, it } from 'vitest'

import {
  titleFromName,
  isHtmlFile,
  isDocFile,
  resolveDocLink,
  resolveHtmlTitle,
} from './vault'

describe('vault · html 拓宽', () => {
  it('titleFromName 剥去 html/htm 后缀', () => {
    expect(titleFromName('静夜思.md')).toBe('静夜思')
    expect(titleFromName('c.HTML')).toBe('c')
    expect(titleFromName('untitled.htm')).toBe('untitled')
  })

  it('isHtmlFile / isDocFile 判断扩展名', () => {
    expect(isHtmlFile('a.html')).toBe(true)
    expect(isHtmlFile('b.HTM')).toBe(true)
    expect(isHtmlFile('c.md')).toBe(false)
    expect(isDocFile('c.md')).toBe(true)
    expect(isDocFile('d.markdown')).toBe(true)
    expect(isDocFile('e.html')).toBe(true)
    expect(isDocFile('f.htm')).toBe(true)
    expect(isDocFile('g.txt')).toBe(false)
  })

  it('resolveDocLink 放行 .html/.htm 互链', () => {
    // md → html：同目录
    expect(resolveDocLink('a/note.md', './guide.html')).toBe('a/guide.html')
    // html → md：跨层
    expect(resolveDocLink('a/readme.html', '../哲学/静夜思.md')).toBe('哲学/静夜思.md')
    // 锚点/查询剥去
    expect(resolveDocLink('x.md', 'y.html#top?z=1')).toBe('y.html')
    // 非文档目标仍为 null
    expect(resolveDocLink('a.md', 'image.png')).toBeNull()
    expect(resolveDocLink('a.md', 'https://example.com/z.html')).toBeNull()
  })

  it('通用文件名回退到 <title>，普通文件名用文件名', () => {
    expect(resolveHtmlTitle('静夜思', 'index.html')).toBe('静夜思')
    expect(resolveHtmlTitle('  卷首语  ', 'index.html')).toBe('卷首语')
    expect(resolveHtmlTitle('标题', '哲学随想.html')).toBe('哲学随想')
    expect(resolveHtmlTitle('标题', 'untitled.htm')).toBe('标题')
    expect(resolveHtmlTitle(null, 'default.HTML')).toBe('default')
    expect(resolveHtmlTitle('标题', 'document.html')).toBe('document')
    expect(resolveHtmlTitle('', 'main.html')).toBe('main')
  })
})
