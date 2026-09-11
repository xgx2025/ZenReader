/**
 * 宿主 ⇄ 沙箱帧 agent 的消息协议（唯一类型源）。
 *
 * 信封 { v, nonce, type, payload }：nonce 每次打开文档由 `crypto.randomUUID()`
 * 生成并注入 agent 配置；宿主校验 `event.source === iframe.contentWindow` + nonce，
 * 帧侧校验 `event.source === window.parent` + nonce。
 *
 * 安全立场：入站一律是不可信数据（agent 跑在原文所在的沙箱里，页脚本与它同源）。
 * 宿主据此不信任任何裸 `relPath`/`url`——凡影响导航、落库、外联的行为都再次自证：
 * openDoc 的 href 在宿主侧用 resolveDocLink 重新归一 + 校验扩展名；openExternal 的
 * url 只放行 http(s)/mailto。帧内 JS 能伪造本协议的任意消息，但过不了宿主侧的自证。
 */
import type { HighlightAnchor } from '@/types/note'

export type { HighlightAnchor }

export const PROTOCOL_VERSION = 1 as const

export type ZenEnvelope<P = unknown> = {
  v: typeof PROTOCOL_VERSION
  nonce: string
  /** 枚举见 HostCommand/FrameEvent；实现为 string 以便宿主侧总做白名单校验。 */
  type: string
  payload?: P
}

export type ZenMessageType = HostCommand | FrameEvent

/** 宿主 → 帧 的命令。 */
export type HostCommand =
  | 'cmd.applyAnchors'
  | 'cmd.scrollToRatio'
  | 'cmd.scrollToHeading'
  | 'cmd.scrollToNote'
  | 'cmd.scrollByFraction'
  | 'cmd.scrollEdge'
  | 'cmd.setZoom'
  | 'cmd.setTheme'
  | 'cmd.refreshOutline'
  | 'cmd.reportNow'

/** 帧 → 宿主 的事件。 */
export type FrameEvent =
  | 'evt.ready'
  | 'evt.outline'
  | 'evt.scroll'
  | 'evt.selection'
  | 'evt.openExternal'
  | 'evt.openDoc'
  | 'evt.key'

/** 注入 agent 的启动配置（嵌进 srcdoc，页面脚本可见，非机密）。 */
export interface AgentConfig {
  nonce: string
  /** 本库内文档相对路径，如 `哲学/随笔/x.html`（宿主自证互链的基准）。 */
  relPath: string
  /** 主题名——决定高亮/描边配色（agent 重发可再调）。 */
  theme: string
  /**
   * html 沉浸式阅读的「起始留白」px：给 <body> 顶部加等高的 padding，
   * 使文章起点对齐在悬浮玻璃条下沿（滚动后正文才滑入条下）。0 = 不注入。
   */
  topInset?: number
}

/** applyAnchors：整批替换——清空旧 `mark.zen-hl` 后按序重打。 */
export interface ApplyAnchorsPayload {
  items: { noteId: string; anchor: HighlightAnchor }[]
}

export interface ScrollInfo {
  /** 0..1 的阅读进度（宿主持久化，与 md 同一套）。 */
  ratio: number
  /** 当前所处的目录项下标（-1 = 首段之前）；对应宿主合成目录 `zhh-{i}`。 */
  activeIndex: number
  /** 帧内纵向滚动 px——宿主据此藏顶栏。 */
  y: number
  /** 距上次上报的滚动增量（上为正）。 */
  delta: number
}

/**
 * 划词结果。rect 是**帧视口宽高的比例**（0..1）——CSS zoom 缩放后依然对应可见位置；
 * 宿主按 iframe 实框（px）换算出父坐标再显示浮动条。
 */
export interface SelectionInfo {
  anchor: HighlightAnchor
  rect: { left: number; top: number; width: number; height: number }
}

export interface FrameRect {
  left: number
  top: number
  width: number
  height: number
}

/** 目录项：由 agent 在帧内扫 h1–h6 得出。 */
export interface OutlineItem {
  level: number
  text: string
}

/** evt.openDoc 载荷：原始 href（不信任）——宿主 resolveDocLink 自证后再路由。 */
export interface OpenDocPayload {
  href: string
}

export interface OpenExternalPayload {
  url: string
}

export interface KeyPayload {
  key: string
  shiftKey: boolean
}

export const isHostCommand = (t: string): t is HostCommand =>
  t.startsWith('cmd.')

export const isFrameEvent = (t: string): t is FrameEvent =>
  t.startsWith('evt.')
