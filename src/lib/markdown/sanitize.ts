import DOMPurify from 'dompurify'

/**
 * Neutralize injected HTML / `javascript:` URLs. markdown-it runs with
 * `html: true`, so this is the security backstop before we persist & render.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // mathMl：KaTeX 为无障碍输出的 `<math>` 层（视觉层是 .katex-html）。
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['input'],
    // Keep heading ids (`id`), highlight classes (`class`), task-list
    // checkbox state (`checked`/`disabled`/`type`), and external-link
    // semantics (`target`/`rel` — stripped by default, we render them).
    // `style` 为 KaTeX 必需：上下标/分数的定位全靠内联样式（DOMPurify 会
    // 清洗其中的危险 CSS，仅放行布局值）。
    ADD_ATTR: ['id', 'class', 'checked', 'disabled', 'type', 'target', 'rel', 'style'],
  })
}
