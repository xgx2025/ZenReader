// Type shims for markdown-it plugins that ship no declarations.

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
