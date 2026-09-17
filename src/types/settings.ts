export type ThemeName = 'light' | 'sepia' | 'dark'
export type ReaderFont = 'serif' | 'sans'
/** 宣纸纹理强度三档：无 / 微（默认）/ 显。 */
export type PaperTextureLevel = 'off' | 'subtle' | 'rich'

/**
 * 入定动画六档：墨韵圆相 / 落叶听禅 / 香篆引定 / 星河入砚 / 轻雾速入 /
 * 随机轮换。轻雾即旧版「关闭仪式」的快速短雾；随机在除轻雾外的各档中现抽。
 */
export type ZenEntryStyle =
  | 'ink'
  | 'leaf'
  | 'incense'
  | 'galaxy'
  | 'mist'
  | 'random'

/** 歇息提醒动作：散行 / 饮水 / 望远 / 静息。 */
export type ReminderAction = 'stretch' | 'water' | 'eyes' | 'breathe'

/** 禅钟（连续专注歇息提醒）配置。 */
export interface ReminderSettings {
  /** 是否开启提醒。 */
  enabled: boolean
  /** 一炷香时长（分钟）：连续专注达此时长后提醒歇息。 */
  intervalMinutes: number
  /** 轮换提醒的动作（空则退为散行）。 */
  actions: ReminderAction[]
  /** 燃香预提示：香将尽时在工具栏显一星极淡微光，悬停方见剩余。 */
  preHint: boolean
  /** 香尽钟音：香燃尽时轻声颂钵音（WebAudio 合成，无音频文件）。 */
  chime: boolean
}

export interface ReaderSettings {
  theme: ThemeName
  /** Base reading font size, in px. */
  fontSize: number
  /** Unitless line-height multiplier. */
  lineHeight: number
  /** Max text column width, in rem. */
  textWidth: number
  fontFamily: ReaderFont
  /** 段首缩进 - classic Chinese book indentation (2em). */
  paragraphIndent: boolean
  /** 两端对齐 - flush margins for CJK prose. */
  justify: boolean
  zenMode: boolean
  /** 入定动画 —— 进入禅境时的过场仪式风格；轻雾为约 1 秒的快速短雾。 */
  zenEntry: ZenEntryStyle
  /**
   * 沉浸全屏 - 禅境包含全屏：入禅境时自动进入全屏，出定时仅当全屏是
   * 被本次入定自动开启的才一并退去。全屏本身（F11 / 工具栏）不牵动禅境。
   */
  immersiveFullscreen: boolean
  /** 宣纸颗粒纹理（WebGL 静态叠层，不可用时静默退回纯色纸底）。 */
  paperTexture: PaperTextureLevel
  /**
   * 书库侧栏宽度（px）。侧栏要装「Java 核心技术 卷I」这类长分组名，固定宽度
   * 必然截断，故给一条可拖的手柄 + 一个设置项；两处共用这个值。
   */
  sidebarWidth: number
  /** 禅钟歇息提醒。 */
  reminder: ReminderSettings
  /** The vault folder (书库目录) on disk; empty string = no vault open. */
  vaultPath: string
}

/** 侧栏宽度的可拖范围（px）：窄到还能放下「分组」二字与计数，宽到不挤占主区。 */
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 420

/** 夹到合法范围并取整——拖拽与设置项都经这里，落盘的值永远是合法的。 */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SETTINGS.sidebarWidth
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)))
}

export const DEFAULT_REMINDER: ReminderSettings = {
  enabled: true,
  intervalMinutes: 30,
  actions: ['stretch', 'water', 'eyes', 'breathe'],
  preHint: true,
  chime: true,
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  fontSize: 17,
  lineHeight: 1.95,
  textWidth: 56,
  fontFamily: 'serif',
  paragraphIndent: false,
  justify: false,
  zenMode: false,
  zenEntry: 'ink',
  immersiveFullscreen: true,
  paperTexture: 'subtle',
  sidebarWidth: 224,
  reminder: DEFAULT_REMINDER,
  vaultPath: '',
}
