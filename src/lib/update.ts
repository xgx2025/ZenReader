import { isTauri } from '@/lib/native'
import { getVersion } from '@tauri-apps/api/app'

/** 更新源：GitHub Releases。轻量检查即拉最新已发布版与本版比对。 */
export const RELEASE_PAGE = 'https://github.com/xgx2025/ZenReader/releases/latest'
// 用列表接口而非 releases/latest：后者排除预发布与草稿，全站若按预发布发版
// 会 404；列表取「最新一个非草稿」即算数，与发版习惯一致。
const RELEASES_API = 'https://api.github.com/repos/xgx2025/ZenReader/releases'

/** 当前安装版本；非 Tauri 环境（浏览器 dev）无从谈起，返回 null。 */
export async function getAppVersion(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await getVersion()
  } catch {
    return null
  }
}

/** 最新发布版 tag（去前导 `v`）；尚无任何发布返回 null，网络有恙则抛出。 */
export async function fetchLatest(): Promise<string | null> {
  const res = await fetch(`${RELEASES_API}?per_page=1`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`releases responded ${res.status}`)
  const data = (await res.json()) as { tag_name?: string; draft?: boolean }[]
  const tag = data.find((r) => !r.draft)?.tag_name?.trim()
  return tag ? tag.replace(/^v/i, '') : null
}

function parseSegments(version: string): number[] | null {
  const segs: number[] = []
  for (const s of version.split('.')) {
    const n = Number(s)
    if (!Number.isInteger(n) || n < 0) return null
    segs.push(n)
  }
  return segs
}

/**
 * 逐段数值比较（0.2.0 > 0.1.9）。带后缀的 tag（如 0.3.0-beta）
 * 解析不出整数段，按"不算更新"从严处理，免得误报。
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSegments(latest)
  const b = parseSegments(current)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}
