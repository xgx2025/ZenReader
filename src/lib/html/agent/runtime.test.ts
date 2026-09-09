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
        applyAnchors: (items: unknown[]) => void
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

  it('scrollInfo 形状稳定（无布局环境不崩）', () => {
    const { api } = loadAgent(DOC)
    const info = api.scrollInfo()
    expect(typeof info.ratio).toBe('number')
    expect(typeof info.activeIndex).toBe('number')
  })
})
