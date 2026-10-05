/** 用真实 Markdown / Shiki 管线复现树形纯文本代码块，量相邻可见行的距离。 */
export default async function measureCodeSpacing() {
  const { renderMarkdown } = await import('/src/lib/markdown/parser.ts')
  const { highlightCodeBlocks } = await import('/src/lib/markdown/highlight.ts')

  const source = [
    'Java 后端知识体系',
    '├── Java 基础（集合、并发、JVM…）',
    '├── 数据库（SQL、索引、事务隔离级别…）',
    '├── 框架',
    '│   ├── Spring Framework',
    '│   │   ├── IoC / DI',
    '│   │   ├── AOP',
    '│   │   ├── 事务管理  ← 你在这里',
    '│   │   │   ├── 声明式事务（@Transactional）',
    '│   │   │   ├── 编程式事务（TransactionTemplate）',
    '│   │   │   ├── 事务抽象（PlatformTransactionManager）',
    '│   │   │   └── 事务同步机制（TransactionSynchronizationManager）★',
    '│   │   └── …',
    '│   ├── Spring Boot',
    '│   └── MyBatis / JPA',
    '└── 分布式 / 中间件（Redis、MQ、分布式事务…）',
  ].join('\n')

  const surface = document.createElement('article')
  surface.className = 'zen-prose'
  surface.style.cssText = 'position:fixed;inset:0;z-index:9999;max-width:none;padding:12px 16px;background:var(--paper);overflow:auto'
  surface.innerHTML = renderMarkdown(`\`\`\`\n${source}\n\`\`\``).html
  document.body.appendChild(surface)
  const theme = JSON.parse(localStorage.getItem('zenreader:settings') || '{}').theme || 'light'
  await highlightCodeBlocks(surface, theme)

  const code = surface.querySelector('pre > code')
  const lines = [...code.querySelectorAll('.line')]
  const y = lines.map((line) => +line.getBoundingClientRect().y.toFixed(2))

  const blankProbe = document.createElement('div')
  blankProbe.className = 'zen-prose'
  blankProbe.style.cssText = 'position:absolute;left:-10000px'
  blankProbe.innerHTML = renderMarkdown('```\none\n\ntwo\n```').html
  document.body.appendChild(blankProbe)
  await highlightCodeBlocks(blankProbe, theme)
  const blankLines = [...blankProbe.querySelectorAll('.line')]
  const blankGap = +(
    blankLines[2].getBoundingClientRect().y - blankLines[0].getBoundingClientRect().y
  ).toFixed(2)
  blankProbe.remove()

  return {
    theme,
    visibleLines: source.split('\n').length,
    renderedLines: lines.length,
    interstitialNewlines: [...code.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes('\n')).length,
    lineHeight: getComputedStyle(lines[0]).lineHeight,
    firstGaps: y.slice(1, 5).map((value, i) => +(value - y[i]).toFixed(2)),
    blankGap,
    preHeight: +surface.querySelector('pre').getBoundingClientRect().height.toFixed(2),
  }
}
