/**
 * 区带标题（「分组」那一行）的几何量测：第十轮起这一行**只是标签 + ＋**，
 * 全收 / 全开已退进右键菜单（见 preview-section-probe.mjs）。
 *
 *   node tools/ui-preview/measure.mjs --url=... --script="import('/tools/ui-preview/scenario-section-head.mjs').then(m=>m.default())"
 *
 * 报三组东西：
 *   rows      —— 书库行 / 区带标题 / 第一行分组 的左缘、右缘、高
 *   hitArea   —— 这一行里哪些点属于控件（第十轮后只剩 ＋），其余是标签区
 *   contrast  —— 标签与 ＋ 的取色对比度（相对 --paper）
 *
 * 第十轮的判据（第九轮 → 本轮）：
 *   行内控件        整行开关（标签 + 状态折页）→ 只剩尾列 ＋
 *   标签形态        flex 按钮（含 1.5rem 内边距做缩进）→ 纯文本 h2，靠
 *                   `.side-head-label` 的 1.5rem 内边距落回同一条起笔线
 *   名称左基线      44 → 44
 *   ＋ 与尾列右缘   204 → 204
 *   行高            32px → 32px（不变）
 *   标签字号/字距   11.5px / 0.08em → 不变
 */
export default function measureSectionHead() {
  const px = (n) => +n.toFixed(1)
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: px(r.x), right: px(r.right), y: px(r.y), w: px(r.width), h: px(r.height) }
  }
  /** 文字实际左缘：区带标签的缩进由自己的 padding 承担，盒的左缘会差 24px。 */
  const textLeft = (el) => {
    if (!el) return null
    const range = document.createRange()
    range.selectNodeContents(el)
    return px(range.getBoundingClientRect().x)
  }
  const hitAt = (x, y) => {
    const el = document.elementFromPoint(x, y)
    if (!el) return null
    return el.closest('.side-head-action, .side-head-label')?.className ?? null
  }

  const section = document.querySelector('.side-section')
  const head = document.querySelector('.side-head')
  const label = document.querySelector('.side-head .side-title')
  const action = document.querySelector('.side-head-action')
  const root = document.querySelector('.side-row-root')
  const rootTitle = document.querySelector('.side-row-root .side-title')
  const firstRow = document.querySelector('.folder-row .folder-line')
  const firstName = document.querySelector('.folder-row .folder-name > span')

  const style = (el, prop) => (el ? getComputedStyle(el)[prop] : null)
  const rows = {
    section: box(section),
    head: box(head),
    label: box(label),
    labelTextLeft: textLeft(label),
    action: box(action),
    root: box(root),
    rootTitle: box(rootTitle),
    rootTitleTextLeft: textLeft(rootTitle),
    firstRow: box(firstRow),
    firstName: box(firstName),
    firstNameTextLeft: textLeft(firstName),
    labelFont: label ? getComputedStyle(label).fontSize : null,
    labelSpacing: label ? getComputedStyle(label).letterSpacing : null,
    /** 这一行上还有没有「整行按钮」的残留 */
    anyRowButton: !!document.querySelector('.side-head-btn'),
    anyCaret: !!document.querySelector('.side-head-caret'),
  }

  const hitArea = (() => {
    if (!head) return null
    const r = head.getBoundingClientRect()
    const y = px(r.top + r.height / 2)
    const probes = [0.06, 0.2, 0.5, 0.72, 0.9].map((f) => {
      const x = px(r.left + r.width * f)
      const target = hitAt(x, y)
      return {
        f,
        x,
        target: target ? String(target).split(' ')[0] : null,
        isPlus: !!target && String(target).includes('side-head-action'),
      }
    })
    return { rowWidth: px(r.width), probes }
  })()

  const parse = (c) => {
    const m = c.match(/[\d.]+/g).map(Number)
    return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()
  const ratio = (fg, bg) => {
    const a = lum(parse(fg))
    const b = lum(parse(bg))
    const [hi, lo] = a > b ? [a, b] : [b, a]
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2)
  }

  const labelColor = style(label, 'color')
  const contrast = {
    paper,
    label: labelColor,
    labelOnPaper: labelColor ? ratio(labelColor, paper) : null,
    action: style(action, 'color'),
    headBg: style(head, 'backgroundColor'),
    /** 标签与分组名的字号差——层级靠它，不靠底色 */
    labelVsRowFontSize: [rows.labelFont, firstName ? getComputedStyle(firstName).fontSize : null],
  }

  return JSON.stringify({ rows, hitArea, contrast }, null, 1)
}
