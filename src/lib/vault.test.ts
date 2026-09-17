import { describe, expect, it } from 'vitest'

import {
  isPathInFolder,
  rewritePathPrefix,
  titleFromName,
  isHtmlFile,
  isDocFile,
  docFormatOf,
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

  it('docFormatOf 归入两类卷式（大小写不敏感）', () => {
    expect(docFormatOf('a.md')).toBe('markdown')
    expect(docFormatOf('b.markdown')).toBe('markdown')
    expect(docFormatOf('c.MD')).toBe('markdown')
    expect(docFormatOf('d.html')).toBe('html')
    expect(docFormatOf('e.htm')).toBe('html')
    expect(docFormatOf('f.HTML')).toBe('html')
  })

  it('docFormatOf 与 isDocFile 同域：非文档名不落进书库', () => {
    // 回落 markdown 是记录在案的约定，不是意外——调用方已由 isDocFile 过滤。
    expect(docFormatOf('note.txt')).toBe('markdown')
    expect(isDocFile('note.txt')).toBe(false)
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

/**
 * 分组改名 / 搬家要同时改写四份按路径存的东西（笔记、阅读进度、卡片序、分组序），
 * 它们共用这一条前缀改写。边界错一处就是「改了名，进度丢了」这类静默数据事故。
 */
describe('vault · 路径前缀改写', () => {
  it('分组自身与其整棵子树都换前缀', () => {
    expect(rewritePathPrefix('Java', 'Java', 'JVM')).toBe('JVM')
    expect(rewritePathPrefix('Java/并发.md', 'Java', 'JVM')).toBe('JVM/并发.md')
    expect(rewritePathPrefix('Java/深水区/锁.md', 'Java', 'JVM')).toBe('JVM/深水区/锁.md')
  })

  it('不碰同前缀的兄弟分组（Java 改名不该动 JavaScript）', () => {
    expect(rewritePathPrefix('JavaScript/原型.md', 'Java', 'JVM')).toBe(
      'JavaScript/原型.md',
    )
  })

  it('不在前缀下的原样返回', () => {
    expect(rewritePathPrefix('Redis/持久化.md', 'Java', 'JVM')).toBe('Redis/持久化.md')
    expect(rewritePathPrefix('Java', '', 'JVM')).toBe('Java') // 空 from 不做任何事
  })

  it('搬进另一层时新前缀也跟着变', () => {
    expect(rewritePathPrefix('Java/深水区/锁.md', 'Java', '归档/Java')).toBe(
      '归档/Java/深水区/锁.md',
    )
  })

  it('isPathInFolder 认自身与子树，不认同前缀兄弟', () => {
    expect(isPathInFolder('Java', 'Java')).toBe(true)
    expect(isPathInFolder('Java/并发.md', 'Java')).toBe(true)
    expect(isPathInFolder('JavaScript/原型.md', 'Java')).toBe(false)
    expect(isPathInFolder('任意', '')).toBe(true) // 空路径 = 书库根，恒真
  })
})
