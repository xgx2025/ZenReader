/** Join path segments with `/`, dropping empty parts. */
export function joinPath(...segs: string[]): string {
  return segs.filter(Boolean).join('/')
}

/** Absolute path on disk for a vault-rooted relative path. */
export function vaultFile(vaultPath: string, relativePath: string): string {
  return joinPath(vaultPath, relativePath)
}

/** Folder path (empty at root) derived from a `/`-separated relative path. */
export function folderPathFromRelative(relativePath: string): string {
  const parts = relativePath.split('/')
  parts.pop()
  return parts.join('/')
}

/** Extension regex for every document ZenReader imports & reads. */
export const DOC_EXT = /\.(md|markdown|html|htm)$/i

/** Title fallback: strip the `.md` / `.markdown` / `.html` / `.htm` suffix. */
export function titleFromName(name: string): string {
  return name.replace(/\.(md|markdown|html|htm)$/i, '')
}

/** Is `path`/`name` a document ZenReader reads? */
export function isDocFile(name: string): boolean {
  return DOC_EXT.test(name)
}

/** Is `name` an HTML document (.html/.htm)? */
export function isHtmlFile(name: string): boolean {
  return /\.(html|htm)$/i.test(name)
}

/**
 * File names so generic they say nothing about a document — when a *.html
 * file has one of these, its library card falls back to the `<title>` tag.
 */
const GENERIC_HTML_NAMES = /^(index|default|untitled|main|home|readme|概要|主页|首页)(\.html?)?$/i

/**
 * A generic *.html base name (no `.html`) matches the generic-name set?
 * `document.html` → "document" → false; `index.html` → "index" → true.
 */
export function genericHtmlBaseName(baseName: string): boolean {
  return GENERIC_HTML_NAMES.test(baseName.replace(/\.(html|htm)$/i, ''))
}

/**
 * HTML library-card title: use the `<title>` tag when the file name is a
 * generic placeholder (index/default/untitled/…), else the file name. Pass
 * `null`/empty title when none was extractable.
 */
export function resolveHtmlTitle(htmlTitle: string | null, name: string): string {
  const base = name.replace(/\.(html|htm)$/i, '')
  if (genericHtmlBaseName(base) && htmlTitle && htmlTitle.trim()) {
    return htmlTitle.trim()
  }
  return base || name
}

/**
 * 解析文档内互链：以当前文档所在目录为基准，把 `./`、`../`、裸文件名、
 * 盘符根（`/` 开头＝书库根）等相对 href 归一为书库内相对路径。
 * markdown-it 会对 href 做百分号编码（空格、中文），先解码再算；
 * 锚点与查询串剥去。非文档（md/html）链接返回 null。
 */
export function resolveDocLink(currentRelPath: string, href: string): string | null {
  let decoded = href
  try {
    decoded = decodeURIComponent(href)
  } catch {
    /* 编码异常就按原文算 */
  }
  const raw = decoded.split('#')[0].split('?')[0].replace(/\\/g, '/')
  if (!raw) return null
  // 带 scheme 的绝对链接（https:、mailto:、C:/…）不是库内文档——外链由上层另行
  // 处理，这里绝不当相对路径归一（否则 `https://x/z.html` 会变成 `https:/x/z.html`）。
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  const parts = raw.startsWith('/')
    ? []
    : folderPathFromRelative(currentRelPath).split('/').filter(Boolean)
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const resolved = parts.join('/')
  return DOC_EXT.test(resolved) ? resolved : null
}

/** Prefer a `title` from frontmatter, else derive from the file name. */
export function resolveTitle(
  frontmatter: Record<string, unknown>,
  name: string,
): string {
  const t = frontmatter.title
  if (typeof t === 'string' && t.trim()) return t.trim()
  return titleFromName(name)
}
