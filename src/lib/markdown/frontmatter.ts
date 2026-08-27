import { load } from 'js-yaml'

export interface FrontmatterResult {
  data: Record<string, unknown>
  content: string
  hasFrontmatter: boolean
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/**
 * Split YAML frontmatter (`---\n...\n---`) from the body. Browser-safe —
 * intentionally avoids `gray-matter`, which depends on Node's `Buffer`.
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  const match = FRONTMATTER_RE.exec(text)

  if (!match) {
    return { data: {}, content: source, hasFrontmatter: false }
  }

  let data: Record<string, unknown> = {}
  try {
    const parsed = load(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // Invalid YAML — treat as no frontmatter rather than failing the import.
    data = {}
  }

  return {
    data,
    content: text.slice(match[0].length),
    hasFrontmatter: Object.keys(data).length > 0,
  }
}
