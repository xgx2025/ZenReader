// Type shims for markdown-it plugins that ship no declarations.

declare module 'markdown-it-task-lists' {
  const plugin: (md: any, options?: any) => void
  export default plugin
}

declare module 'markdown-it-footnote' {
  const plugin: (md: any, options?: any) => void
  export default plugin
}
