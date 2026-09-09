import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import type { Document } from '@/types/document'
import {
  PROTOCOL_VERSION,
  isFrameEvent,
  type AgentConfig,
  type ApplyAnchorsPayload,
  type FrameRect,
  type HighlightAnchor,
  type KeyPayload,
  type OutlineItem,
  type ScrollInfo,
  type ZenEnvelope,
} from '@/lib/html/protocol'
import { buildSrcdoc, buildZenAssetBase } from '@/lib/html/srcdoc'
import agentRaw from '@/lib/html/agent/runtime.js?raw'

if (agentRaw.includes('</script')) {
  // 注入会被页面误闭合——宁可在开发期直接崩，也不带病上线。
  throw new Error('agent runtime.js must not contain a literal `</script`')
}

/** rect（帧视口比例）换算成父视口 px——宿主浮动条按此定位。 */
function fracToViewportRect(
  iframe: HTMLIFrameElement,
  frac: { left: number; top: number; width: number; height: number },
): FrameRect {
  const box = iframe.getBoundingClientRect()
  const w = iframe.clientWidth || box.width
  const h = iframe.clientHeight || box.height
  return {
    left: box.left + frac.left * w,
    top: box.top + frac.top * h,
    width: frac.width * w,
    height: frac.height * h,
  }
}

export interface HtmlReaderSelection {
  /** 选中的文本锚（落库用）。 */
  anchor: HighlightAnchor
  /** 已换算成父视口坐标的选区外框（浮动条定位用）。 */
  rect: FrameRect
}

export interface HtmlReaderHandlers {
  /** 帧内 agent 就绪（首帧布局/脚本就绪）——宿主此刻可续读、打高亮。 */
  onReady?: () => void
  /** 帧内滚动（节流）——宿主记录进度 / 藏顶栏 / 更新当前目录。 */
  onScroll?: (info: ScrollInfo) => void
  /** 目录结构（DOMContentLoaded / load / 主动请求）。 */
  onOutline?: (outline: OutlineItem[]) => void
  /** 划词结果；null = 收起浮动条；crossBlock = 跨段（与 md 同 toast）。 */
  onSelection?: (sel: HtmlReaderSelection | null, crossBlock: boolean) => void
  /** 点开库内互链（href 未自证——宿主 resolveDocLink 后再路由）。 */
  onOpenDoc?: (href: string) => void
  /** 外链（http/https/mailto，agent 已过滤但宿主再验）。 */
  onOpenExternal?: (url: string) => void
  /** 帧内按键转发（焦点在帧内、宿主统一裁决面板开合/滚动）。 */
  onKey?: (key: KeyPayload) => void
  /** 缩放变化（宿主显示 %）。 */
  onZoom?: (zoom: number) => void
}

/**
 * 沙箱 iframe 直读的宿主编排：持有 iframe 元素、非ce 与一条 `message` 监听。
 *
 * 安全：只认 `event.source === iframe.contentWindow` 且信封 nonce/版本匹配的信，
 * 命令白名单由 agent 路由；宿主发命令前等待 ready（帧可能还没解析到 agent）。
 */
export function useHtmlReader(
  iframe: Ref<HTMLIFrameElement | null>,
  handlers: HtmlReaderHandlers,
) {
  const ready = ref(false)
  const zoom = ref(1)
  /** 每次打开重置：旧文档的信（含页面伪造）全部失效。 */
  let nonce = ''
  let theme = 'light'

  function send(type: string, payload?: unknown) {
    const win = iframe.value?.contentWindow
    if (!win) return
    const env: ZenEnvelope = { v: PROTOCOL_VERSION, nonce, type, payload }
    win.postMessage(env, '*')
  }

  function applyAnchors(items: { noteId: string; anchor: HighlightAnchor }[]) {
    send('cmd.applyAnchors', { items } satisfies ApplyAnchorsPayload)
  }

  function scrollToRatio(ratio: number) {
    send('cmd.scrollToRatio', { ratio })
  }
  function scrollToHeading(index: number) {
    send('cmd.scrollToHeading', { index })
  }
  function scrollToNote(noteId: string) {
    send('cmd.scrollToNote', { noteId })
  }
  function scrollByFraction(fraction: number) {
    send('cmd.scrollByFraction', { fraction })
  }
  function scrollEdge(edge: 'top' | 'bottom') {
    send('cmd.scrollEdge', { edge })
  }
  function requestOutline() {
    send('cmd.refreshOutline')
  }
  function reportNow() {
    send('cmd.reportNow')
  }

  function setZoom(z: number) {
    const clamped = Math.min(1.6, Math.max(0.6, Math.round(z * 10) / 10))
    zoom.value = clamped
    send('cmd.setZoom', { zoom: clamped })
    handlers.onZoom?.(clamped)
  }

  function setTheme(t: string) {
    theme = t
    send('cmd.setTheme', { theme: t })
  }

  function onMessage(e: MessageEvent) {
    if (e.source !== iframe.value?.contentWindow) return
    const d = e.data as ZenEnvelope | null
    if (!d || d.v !== PROTOCOL_VERSION || d.nonce !== nonce) return
    const type = d.type
    if (!isFrameEvent(type)) return
    switch (type) {
      case 'evt.ready':
        ready.value = true
        // 重发主题，确保帧就绪后高亮色一致；宿主借 onReady 续读/打高亮。
        send('cmd.setTheme', { theme })
        handlers.onReady?.()
        break
      case 'evt.outline':
        handlers.onOutline?.(d.payload as OutlineItem[])
        break
      case 'evt.scroll':
        handlers.onScroll?.(d.payload as ScrollInfo)
        break
      case 'evt.selection': {
        const p = d.payload as
          | { state: 'select'; anchor: HighlightAnchor; rect: FrameRect }
          | { state: 'dismiss' }
          | { state: 'crossBlock' }
        if (p.state === 'crossBlock') handlers.onSelection?.(null, true)
        else if (p.state === 'select') {
          const el = iframe.value
          if (el) {
            handlers.onSelection?.(
              { anchor: p.anchor, rect: fracToViewportRect(el, p.rect) },
              false,
            )
          }
        } else handlers.onSelection?.(null, false)
        break
      }
      case 'evt.openDoc':
        handlers.onOpenDoc?.((d.payload as { href: string }).href)
        break
      case 'evt.openExternal':
        handlers.onOpenExternal?.((d.payload as { url: string }).url)
        break
      case 'evt.key':
        handlers.onKey?.(d.payload as KeyPayload)
        break
    }
  }

  /**
   * 换文档：重置状态、装新 srcdoc。theme 初始即注入 agent。
   * topInsetPx：沉浸式玻璃条下方给文档的起始留白（px），0 = 不注入。
   */
  function open(doc: Document, initialTheme: string, topInsetPx = 0) {
    theme = initialTheme
    nonce = crypto.randomUUID()
    ready.value = false
    zoom.value = 1
    const el = iframe.value
    if (!el) return
    const cfg: AgentConfig = {
      nonce,
      relPath: doc.relativePath,
      theme: initialTheme,
      topInset: topInsetPx,
    }
    el.srcdoc = buildSrcdoc(doc.source, {
      baseHref: buildZenAssetBase(doc.folderPath),
      cfg,
      agentRaw,
    })
  }

  /** dispose：尽力上报最后进度再拆监听。 */
  function dispose() {
    reportNow()
  }

  onMounted(() => window.addEventListener('message', onMessage))
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    dispose()
  })

  return {
    ready,
    zoom,
    open,
    dispose,
    applyAnchors,
    scrollToRatio,
    scrollToHeading,
    scrollToNote,
    scrollByFraction,
    scrollEdge,
    requestOutline,
    setZoomBy: setZoom,
    setTheme,
  }
}
