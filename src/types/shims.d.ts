// Type shims for markdown-it plugins that ship no declarations.

// Test-only: jsdom ships no types; the agent headless tests import { JSDOM }.
declare module 'jsdom' {
  export class JSDOM {
    constructor(
      html?: string | Buffer,
      options?: {
        url?: string
        runScripts?: 'dangerously' | 'outside-only'
        pretendToBeVisual?: boolean
        [key: string]: unknown
      },
    )
    window: Window & typeof globalThis
  }
}

declare module 'markdown-it-task-lists' {
  const plugin: (md: any, options?: any) => void
  export default plugin
}

declare module 'markdown-it-footnote' {
  const plugin: (md: any, options?: any) => void
  export default plugin
}

declare module 'markdown-it-texmath' {
  const plugin: (
    md: any,
    options?: {
      engine?: { renderToString(tex: string, options?: Record<string, unknown>): string }
      delimiters?: string | string[]
      katexOptions?: Record<string, unknown>
      outerSpace?: boolean
      macros?: Record<string, string>
    },
  ) => void
  export default plugin
}
