import type { Highlighter } from 'shiki'
import type { ThemeName } from '@/types/settings'

// Curated language set — keeps the Shiki chunks small (lazy, per-lang).
const LANGS = [
  'javascript',
  'typescript',
  'python',
  'bash',
  'json',
  'html',
  'css',
  'markdown',
  'yaml',
  'jsx',
  'tsx',
  'text',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
  'sql',
  'shell',
  'xml',
]

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: LANGS,
      }),
    )
  }
  return highlighterPromise
}

function themeFor(theme: ThemeName): string {
  return theme === 'dark' ? 'github-dark' : 'github-light'
}

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  cpp: 'cpp',
  txt: 'text',
}

/**
 * Highlight every `<pre><code class="language-x">` in `container` in place.
 * Keeps the outer `<code class="language-x">` intact (only swaps inner spans),
 * so it can be re-run after a theme change.
 */
export async function highlightCodeBlocks(
  container: HTMLElement,
  theme: ThemeName,
): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>('pre > code'),
  )
  if (blocks.length === 0) return

  const highlighter = await getHighlighter()
  const loadedLangs = new Set(highlighter.getLoadedLanguages())

  await Promise.all(
    blocks.map(async (codeEl) => {
      const classes = codeEl.className.split(/\s+/)
      const langClass = classes.find((c) => c.startsWith('language-'))
      const langRaw = langClass?.slice('language-'.length) ?? ''
      // mermaid 块由 mermaid.ts 渲染成图，shiki 不碰。
      if (langRaw === 'mermaid') return
      const lang = LANG_ALIASES[langRaw] ?? langRaw
      const resolved = loadedLangs.has(lang) ? lang : 'text'
      const code = codeEl.textContent ?? ''

      try {
        const highlighted = highlighter.codeToHtml(code, {
          lang: resolved,
          theme: themeFor(theme),
        })
        const template = document.createElement('template')
        template.innerHTML = highlighted
        const newCode = template.content.querySelector('code')
        if (newCode) {
          codeEl.innerHTML = newCode.innerHTML
          codeEl.classList.add('shiki')
        }
      } catch {
        // Unknown language / highlight failure — leave the unstyled block.
      }
    }),
  )
}
