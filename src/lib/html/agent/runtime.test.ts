import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'

import raw from './runtime.js?raw'

/**
 * 把 runtime.js 的宿主桥强制为 null，暴露 `__ZEN_AGENT_API__` 供无宿主单测驱动。
 * 匹配注入处尾部的 wrapper——若拼接改动导致匹配失败，本测试立刻报错警示。
 */
function forceHeadless(code: string): string {
  const forced = code.replace(
    /}\)\(window\.parent[\s\S]*?\n\} : null\)/,
    '\n})(null)',
  )
  if (forced === code) throw new Error('runtime.js wrapper shape changed — update test')
  return forced
}

function loadAgent(html: string) {
  const dom = new JSDOM(`<!doctype html>${html}`, {
    url: 'about:srcdoc',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  })
  const w = dom.window as Window &
    typeof globalThis & {
      __ZENREADER_CFG?: { nonce?: string; relPath?: string; theme?: string }
      __ZEN_AGENT_API__?: {
        start: () => void
        applyAnchors: (items: unknown[]) => void
        jumpToFragment: (href: string) => void
        scrollInfo: () => { ratio: number; activeIndex: number }
        outlinePayload: () => { level: number; text: string }[]
      }
      NodeFilter: typeof NodeFilter
    }
  w.__ZENREADER_CFG = { nonce: 'n1', relPath: 'a/x.html', theme: 'light' }
  w.eval(forceHeadless(raw))
  if (!w.__ZEN_AGENT_API__) throw new Error('agent API not exposed')
  return { dom, api: w.__ZEN_AGENT_API__ }
}

type Win = Window & typeof globalThis

/** jsdom 不实现元素级滚动 API——装记录器，用来断言"滚没滚、滚到谁"。 */
function stubScroll(w: Win) {
  const intoView: Element[] = []
  const scrolledTo: (number | undefined)[] = []
  const proto = w.Element.prototype as unknown as Record<string, unknown>
  proto.scrollIntoView = function (this: Element) {
    intoView.push(this)
  }
  proto.scrollTo = function (opts: { top?: number }) {
    scrolledTo.push(opts && opts.top)
  }
  return { intoView, scrolledTo }
}

function click(w: Win, el: Element) {
  const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  el.dispatchEvent(ev)
  return ev
}

const DOC = '<body><h1>卷首</h1><p>第一句 正文。</p><p>第二句 正文。</p><script>bad()</script></body>'

describe('html/agent · 帧内逻辑（headless）', () => {
  it('outline 扫出正文标题、忽略 script 内容', () => {
    const { api } = loadAgent(DOC)
    expect(api.outlinePayload()).toEqual([{ level: 1, text: '卷首' }])
  })

  it('applyAnchors 按 occurrence 打 mark.zen-hl，可整批替换清旧', () => {
    const { dom, api } = loadAgent(DOC)
    const anchor = { quote: '正文', prefix: '', suffix: '', occurrence: 0 }
    api.applyAnchors([{ noteId: 'n-a', anchor }])
    const marks = dom.window.document.querySelectorAll('mark.zen-hl')
    expect(marks.length).toBe(1)
    expect(marks[0].getAttribute('data-note-id')).toBe('n-a')
    expect(marks[0].textContent).toBe('正文')

    // 二次整批（换一批）清掉旧的再打，不残留、不嵌套。
    api.applyAnchors([{ noteId: 'n-b', anchor: { ...anchor, occurrence: 1 } }])
    const marks2 = dom.window.document.querySelectorAll('mark.zen-hl')
    expect(marks2.length).toBe(1)
    expect(marks2[0].getAttribute('data-note-id')).toBe('n-b')

    // 空表 = 全部清空。
    api.applyAnchors([])
    expect(dom.window.document.querySelectorAll('mark.zen-hl').length).toBe(0)
  })

  it('quote 漂移（找不到）静默跳过，不误包', () => {
    const { dom, api } = loadAgent(DOC)
    api.applyAnchors([{ noteId: 'x', anchor: { quote: '不存在的文本', prefix: '', suffix: '', occurrence: 0 } }])
    expect(dom.window.document.querySelectorAll('mark.zen-hl').length).toBe(0)
  })

  it('页内锚点 #id 自己接管：拦默认导航、滚到 target（base 已把 #id 变成跨文档 URL）', () => {
    const { dom, api } = loadAgent(
      '<body><nav>' +
        '<a id="lr-hero" href="#hero">首页概览</a>' +
        '<a id="lr-enc" href="#%E4%B8%AD%E6%96%87">转义 id</a>' +
        '<a id="lr-name" href="#legacy">老式 name 锚点</a>' +
        '<a id="lr-miss" href="#nope">target 不存在</a>' +
        '<a id="lr-bare" href="#">光秃秃</a>' +
        '</nav><section id="hero">x</section><h2 id="中文">y</h2><a name="legacy"></a></body>',
    )
    const w = dom.window as unknown as Win
    const { intoView, scrolledTo } = stubScroll(w)
    api.start()

    const doc = dom.window.document
    const byId = (id: string) => doc.getElementById(id) as HTMLElement

    // 拦下默认导航是重点：放行 = 整帧被导航去 zenasset://…/#hero（点了没反应）。
    expect(click(w, byId('lr-hero')).defaultPrevented).toBe(true)
    expect(intoView).toEqual([byId('hero')])

    click(w, byId('lr-enc')) // id 常写成 %XX：先解码再找
    expect(intoView[1]).toBe(byId('中文'))

    click(w, byId('lr-name')) // `<a name="…">` 老式锚点兜底
    expect(intoView[2]).toBe(doc.querySelector('a[name="legacy"]'))

    // target 不存在：原地不动（与原生同语义），但默认导航照样拦。
    expect(click(w, byId('lr-miss')).defaultPrevented).toBe(true)
    expect(intoView).toHaveLength(3)

    click(w, byId('lr-bare')) // 光秃秃的 `#`：回卷首
    expect(scrolledTo).toEqual([0])
  })

  it('scrollInfo 形状稳定（无布局环境不崩）', () => {
    const { api } = loadAgent(DOC)
    const info = api.scrollInfo()
    expect(typeof info.ratio).toBe('number')
    expect(typeof info.activeIndex).toBe('number')
  })
})
