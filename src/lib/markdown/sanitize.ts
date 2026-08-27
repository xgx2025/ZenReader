import DOMPurify from 'dompurify'

/**
 * Neutralize injected HTML / `javascript:` URLs. markdown-it runs with
 * `html: true`, so this is the security backstop before we persist & render.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['input'],
    // Keep heading ids (`id`), highlight classes (`class`), and task-list
    // checkbox state (`checked`/`disabled`/`type`).
    ADD_ATTR: ['id', 'class', 'checked', 'disabled', 'type'],
  })
}
