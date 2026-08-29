import type MarkdownIt from 'markdown-it'
import StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import {
  isWhiteSpace,
  isMdAsciiPunct,
  isPunctCharCode,
} from 'markdown-it/lib/common/utils.mjs'

/**
 * CJK full-width quotes/brackets that wrap inline content. markdown-it
 * classifies these as Unicode punctuation (category P), which trips the
 * CommonMark emphasis flanking rules: in `**“定位问题”**` the `**` sits
 * directly against `“` (punct) while the previous char is a Han character
 * (not punct/whitespace), so the run is neither left- nor right-flanking and
 * the emphasis is dropped — the `**` renders literally.
 *
 * Treating these as letter-like instead lets `**“…“**`, `*《书名》*`, etc.
 * emphasise normally, which is what Chinese authors expect.
 */
const CJK_INLINE_QUOTES = new Set<number>([
  0x2018, 0x2019, // ‘ ’
  0x201c, 0x201d, // “ ”
  0x3008, 0x3009, // 〈 〉
  0x300a, 0x300b, // 《 》
  0x300c, 0x300d, // 「 」
  0x300e, 0x300f, // 『 』
  0x3010, 0x3011, // 【 】
  0xff08, 0xff09, // （ ）
])

function isPunctExceptCjkQuote(code: number): boolean {
  return !CJK_INLINE_QUOTES.has(code) && isPunctCharCode(code)
}

/**
 * Mirrors markdown-it v14 `StateInline.prototype.scanDelims` verbatim, with
 * one change: punctuation detection uses {@link isPunctExceptCjkQuote} instead
 * of the raw `isPunctCharCode`. Keep this in lockstep with
 * `node_modules/markdown-it/lib/rules_inline/state_inline.mjs`.
 */
function scanDelimsCjk(this: StateInline, start: number, canSplitWord: boolean) {
  const max = this.posMax
  const marker = this.src.charCodeAt(start)

  // Astral chars are combined manually below — mirror markdown-it's logic.
  let lastChar: number
  if (start === 0) {
    lastChar = 0x20 // treat beginning of line as whitespace
  } else if (start === 1) {
    lastChar = this.src.charCodeAt(0)
    if ((lastChar & 0xf800) === 0xd800) lastChar = 0xfffd
  } else {
    lastChar = this.src.charCodeAt(start - 1)
    if ((lastChar & 0xfc00) === 0xdc00) {
      const highSurr = this.src.charCodeAt(start - 2)
      lastChar =
        (highSurr & 0xfc00) === 0xd800
          ? 0x10000 + ((highSurr - 0xd800) << 10) + (lastChar - 0xdc00)
          : 0xfffd
    } else if ((lastChar & 0xfc00) === 0xd800) {
      lastChar = 0xfffd
    }
  }

  let pos = start
  while (pos < max && this.src.charCodeAt(pos) === marker) pos++

  const count = pos - start

  // treat end of line as whitespace
  let nextChar: number = pos < max ? this.src.charCodeAt(pos) : 0x20
  if ((nextChar & 0xfc00) === 0xd800) {
    const lowSurr = this.src.charCodeAt(pos + 1)
    nextChar =
      (lowSurr & 0xfc00) === 0xdc00
        ? 0x10000 + ((nextChar - 0xd800) << 10) + (lowSurr - 0xdc00)
        : 0xfffd
  } else if ((nextChar & 0xfc00) === 0xdc00) {
    nextChar = 0xfffd
  }

  const isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctExceptCjkQuote(lastChar)
  const isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctExceptCjkQuote(nextChar)

  const isLastWhiteSpace = isWhiteSpace(lastChar)
  const isNextWhiteSpace = isWhiteSpace(nextChar)

  const left_flanking =
    !isNextWhiteSpace && (!isNextPunctChar || isLastWhiteSpace || isLastPunctChar)
  const right_flanking =
    !isLastWhiteSpace && (!isLastPunctChar || isNextWhiteSpace || isNextPunctChar)

  const can_open = left_flanking && (canSplitWord || !right_flanking || isLastPunctChar)
  const can_close = right_flanking && (canSplitWord || !left_flanking || isNextPunctChar)

  return { can_open, can_close, length: count }
}

/**
 * Install the CJK-quote emphasis fix. The patch lives on `StateInline.prototype`,
 * so it affects every markdown-it instance; the module exports a singleton so
 * that's the app's one renderer.
 */
export function cjkEmphasis(_md: MarkdownIt): void {
  StateInline.prototype.scanDelims = scanDelimsCjk
}
