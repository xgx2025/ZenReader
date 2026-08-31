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

/** Title fallback: strip the `.md` / `.markdown` suffix. */
export function titleFromName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}

/**
 * 解析文档内互链：以当前文档所在目录为基准，把 `./`、`../`、裸文件名、
 * 盘符根（`/` 开头＝书库根）等相对 href 归一为书库内相对路径。
 * markdown-it 会对 href 做百分号编码（空格、中文），先解码再算；
 * 锚点与查询串剥去。非 markdown 文档返回 null。
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
  const parts = raw.startsWith('/')
    ? []
    : folderPathFromRelative(currentRelPath).split('/').filter(Boolean)
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const resolved = parts.join('/')
  return /\.(md|markdown)$/i.test(resolved) ? resolved : null
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
