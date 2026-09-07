import type { ThemeName } from '@/types/settings'

/**
 * Mermaid 图表渲染 —— 与 highlight.ts 同构的 DOM 后处理。
 *
 * markdown-it 只产出普通的 `pre > code.language-mermaid`；本文档在渲染
 * 后把每个 mermaid 块替换成图卡（.mermaid-figure），源码存进
 * data-mermaid-src，主题切换时据此整图重绘（mermaid 的 SVG 一经渲染
 * 即丢失源文本，源必须自存）。
 *
 * mermaid 体积庞大，动态 import 懒加载：文档里没有 mermaid 块就永远
 * 不进包。配色从主题 CSS 变量取值，与纸墨同源；securityLevel 保持
 * strict，图表内嵌 HTML 标签由 mermaid 自行消毒。
 */

type MermaidAPI = typeof import('mermaid').default

let mermaidPromise: Promise<MermaidAPI> | null = null
/** 上次 initialize 的主题指纹，主题或配色变化才重新初始化。 */
let lastThemeKey = ''
let renderSeq = 0

function loadMermaid(): Promise<MermaidAPI> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default)
  }
  return mermaidPromise
}

/** 从根元素取主题变量；仅接受 hex 色值，异常时退回浅色纸墨的默认。 */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback
}

/**
 * 渲染容器内的全部 mermaid 块：
 * - 新块：`pre > code.language-mermaid`（markdown 渲染产物），替换为图卡；
 * - 旧图：`.mermaid-figure[data-mermaid-src]`，主题切换后整图重绘。
 * 单块渲染失败不牵连其余：该卡退回源码展示，并作错误标记。
 */
export async function renderMermaidBlocks(
  container: HTMLElement,
  theme: ThemeName,
): Promise<void> {
  const freshCodes = Array.from(
    container.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
  )
  const staleFigures = Array.from(
    container.querySelectorAll<HTMLElement>('.mermaid-figure[data-mermaid-src]'),
  )
  if (freshCodes.length === 0 && staleFigures.length === 0) return

  const mermaid = await loadMermaid()

  const ink = cssVar('--ink', '#2b2a27')
  const inkSoft = cssVar('--ink-soft', '#5a574f')
  const paperDeep = cssVar('--paper-deep', '#efe6d3')
  const bamboo = cssVar('--bamboo', '#5f7a5c')
  const themeKey = `${theme}|${ink}|${inkSoft}|${paperDeep}|${bamboo}`
  if (themeKey !== lastThemeKey) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'neutral',
      fontFamily: getComputedStyle(document.documentElement).fontFamily,
      themeVariables: {
        primaryColor: paperDeep,
        primaryTextColor: ink,
        primaryBorderColor: inkSoft,
        lineColor: inkSoft,
        activationBkgColor: paperDeep,
        sequenceNumberColor: paperDeep,
        noteBkgColor: bamboo,
        noteTextColor: paperDeep,
      },
    })
    lastThemeKey = themeKey
  }

  // 收集渲染任务：新块先摘出源码并替换占位图卡，再与旧图一起重绘。
  const jobs: { figure: HTMLElement; src: string }[] = staleFigures.map((figure) => ({
    figure,
    src: figure.dataset.mermaidSrc ?? '',
  }))
  for (const code of freshCodes) {
    const pre = code.parentElement
    if (!pre) continue
    const src = code.textContent ?? ''
    const figure = document.createElement('div')
    figure.className = 'mermaid-figure'
    figure.dataset.mermaidSrc = src
    pre.replaceWith(figure)
    jobs.push({ figure, src })
  }

  await Promise.all(
    jobs.map(async ({ figure, src }) => {
      const id = `mermaid-${++renderSeq}`
      try {
        const { svg } = await mermaid.render(id, src)
        figure.innerHTML = svg
        figure.classList.remove('mermaid-figure-error')
      } catch (e) {
        // 语法错误等：退回源码展示，不吞错误信息。
        console.warn('[zenreader] mermaid render failed:', e)
        figure.classList.add('mermaid-figure-error')
        figure.replaceChildren()
        const code = document.createElement('code')
        code.textContent = src
        figure.appendChild(code)
      }
    }),
  )
}

/**
 * 灯箱快照：取图卡内 SVG 的可放大副本与宽高比（无图返回 null）。
 * 有 viewBox 时摘掉 mermaid 写死的 max-width 与 width/height，交给灯箱
 * 按比例自适应铺满；id 必须原样保留——图内 <style> 以它作作用域锚点。
 */
export function mermaidSvgSnapshot(
  figure: HTMLElement,
): { html: string; ratio: number } | null {
  const svg = figure.querySelector('svg')
  if (!svg) return null
  const clone = svg.cloneNode(true) as SVGSVGElement
  const vb = svg.viewBox.baseVal
  if (vb.width > 0 && vb.height > 0) {
    clone.removeAttribute('style')
    clone.removeAttribute('width')
    clone.removeAttribute('height')
    return { html: clone.outerHTML, ratio: vb.width / vb.height }
  }
  // 兜底：无 viewBox 则原样带走，按当前渲染尺寸折算比例。
  const box = svg.getBoundingClientRect()
  return { html: clone.outerHTML, ratio: box.height > 0 ? box.width / box.height : 1 }
}
