/**
 * 组装沙箱直读用的 `srcdoc` 字符串，以及相对资源解析的 `zenasset://` 基准。
 *
 * 原则：**绝不合成新的 `<html>/<head>/<body>`**——只在原文既有结构上插入
 * `<base>` 与 agent `<script>`，保证"原样式直读"不是重写。
 */

/**
 * 某库内文档所在目录对应的资产基准。
 *
 * 形态：`zenasset://asset/<逐段 percent-encode 的目录>/`；库根即
 * `zenasset://asset/`。相对 `img/x.png`、CSS url()、字体、fetch 都在此解析。
 * 注意 `asset` 是 scheme 的 authority（主机名），不进入路径——路径段整体
 * 就是"书库内相对路径"，Rust 侧按库根收敛（见 asset_protocol.rs）。
 */
export function buildZenAssetBase(docFolder: string): string {
  const segs = docFolder.split('/').filter(Boolean)
  const encoded = segs.map(encodeURIComponent).join('/')
  return `zenasset://asset/${encoded ? `${encoded}/` : ''}`
}

/**
 * 找到 `<head>` 的插入点：返回 { insertAt, insertBefore }——head 起始标签之后、
 * 首个子元素之前；无 head 时尽量插到 `<html>`/`<body>` 之前或文档开头，
 * 让 `<base>` 与 agent 尽早生效。绝不自己拼 head。
 */
function headInsertPoint(source: string): number {
  const head = /<head[\s>]/i.exec(source)
  if (head) {
    // 允许 `<head attr="…">` 带属性：起始标签真正结束于下一个 `>`。
    const tagEnd = source.indexOf('>', head.index)
    if (tagEnd !== -1) return tagEnd + 1
    return head.index + head[0].length
  }
  // 无 head：插在根元素前。先找 `<html`，再找文档前导（doctype/注释/空白）后的 body。
  const html = /<html[\s>]/i.exec(source)
  if (html) {
    const tagEnd = source.indexOf('>', html.index)
    if (tagEnd !== -1) return tagEnd + 1
    return html.index + html[0].length
  }
  const body = /<body[\s>]/i.exec(source)
  if (body) {
    const tagEnd = source.indexOf('>', body.index)
    if (tagEnd !== -1) return tagEnd + 1
    return body.index + body[0].length
  }
  // 文档直接是片段：跳过前导 doctype/注释/空白再插入（不让 <base>/agent 落到
  // doctype 之前），否则插在最前。
  const preamble = /^(?:\s|<!--[\s\S]*?-->|<!doctype[^>]*>)*/i.exec(source)
  if (preamble) return preamble[0].length
  return 0
}

/** JSON 里的 `<` 一律转义，防止原文任何字段把注入脚本提前闭合。 */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export interface SrcdocOptions {
  /** zenasset:// 基准（见 buildZenAssetBase）。 */
  baseHref: string
  /** agent 启动配置（含 nonce）——不透明 JSON，仅序列化用。 */
  cfg: unknown
  /** agent 源码（自含 IIFE，已确认不含字面 `</script`）。 */
  agentRaw: string
}

/**
 * 组装可直读的 srcdoc：注入 `<base>`（相对资源基准）+ `<script>`（配置）+ agent。
 * 调用方断言 agentRaw 不含 `</script`，避免注入逃逸。
 */
export function buildSrcdoc(source: string, o: SrcdocOptions): string {
  const at = headInsertPoint(source)
  const baseTag = `<base href="${o.baseHref}">`
  // 配置先于 agent 落地；agent 防御性清 `__TAURI_INTERNALS__` 后再读它。
  const cfgScript = `<script>window.__ZENREADER_CFG=${safeJson(o.cfg)}</script>`
  const agentScript = `<script>${o.agentRaw}</script>`
  const injection = `${baseTag}${cfgScript}${agentScript}`
  return source.slice(0, at) + injection + source.slice(at)
}
