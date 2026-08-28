export type ThemeName = 'light' | 'sepia' | 'dark'
export type ReaderFont = 'serif' | 'sans'

export interface ReaderSettings {
  theme: ThemeName
  /** Base reading font size, in px. */
  fontSize: number
  /** Unitless line-height multiplier. */
  lineHeight: number
  /** Max text column width, in rem. */
  textWidth: number
  fontFamily: ReaderFont
  zenMode: boolean
  /** The vault folder (书库目录) on disk; empty string = no vault open. */
  vaultPath: string
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  fontSize: 17,
  lineHeight: 1.95,
  textWidth: 42,
  fontFamily: 'serif',
  zenMode: false,
  vaultPath: '',
}
