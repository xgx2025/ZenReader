import type { HighlightAnchor } from '@/types/note'

const CONTEXT_LENGTH = 100

export interface SelectionCapture {
  anchor: HighlightAnchor
  rect: DOMRect
}

/** Absolute text offset of a boundary point within `container`'s textContent. */
function textOffsetOf(
  node: Node,
  offset: number,
  container: Node,
): number | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let pos = 0
  let current = walker.nextNode()
  while (current) {
    const len = current.textContent?.length ?? 0
    if (current === node) {
      return pos + Math.min(offset, len)
    }
    pos += len
    current = walker.nextNode()
  }
  return null
}

/** Capture the current selection as a stable text anchor, or null. */
export function captureSelection(container: HTMLElement): SelectionCapture | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }

  const range = selection.getRangeAt(0)
  // v1 clamps to single-block selections (no cross-paragraph wraps).
  if (range.toString().includes('\n')) return null
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return null
  }

  const start = textOffsetOf(range.startContainer, range.startOffset, container)
  const end = textOffsetOf(range.endContainer, range.endOffset, container)
  if (start === null || end === null || start === end) return null

  const lo = Math.min(start, end)
  const hi = Math.max(start, end)

  const fullText = container.textContent ?? ''
  const quote = fullText.slice(lo, hi)
  if (!quote.trim()) return null

  const prefix = fullText.slice(Math.max(0, lo - CONTEXT_LENGTH), lo)
  const suffix = fullText.slice(hi, hi + CONTEXT_LENGTH)
  const occurrence = countOccurrencesBefore(fullText, quote, lo)

  return {
    anchor: { quote, prefix, suffix, occurrence },
    rect: range.getBoundingClientRect(),
  }
}

function countOccurrencesBefore(
  text: string,
  needle: string,
  beforeIndex: number,
): number {
  let count = 0
  let idx = text.indexOf(needle)
  while (idx !== -1 && idx < beforeIndex) {
    count++
    idx = text.indexOf(needle, idx + needle.length)
  }
  return count
}

function findNthOccurrence(text: string, needle: string, n: number): number {
  let idx = text.indexOf(needle)
  let count = 0
  while (idx !== -1) {
    if (count === n) return idx
    count++
    idx = text.indexOf(needle, idx + 1)
  }
  return -1
}

function findBestOccurrence(text: string, anchor: HighlightAnchor): number {
  const occurrences: number[] = []
  let idx = text.indexOf(anchor.quote)
  while (idx !== -1) {
    occurrences.push(idx)
    idx = text.indexOf(anchor.quote, idx + 1)
  }
  if (occurrences.length === 0) return -1
  if (occurrences.length === 1) return occurrences[0]

  let best = occurrences[0]
  let bestScore = -1
  for (const i of occurrences) {
    const before = text.slice(Math.max(0, i - anchor.prefix.length), i)
    const after = text.slice(
      i + anchor.quote.length,
      i + anchor.quote.length + anchor.suffix.length,
    )
    const score = overlapScore(before, anchor.prefix) + overlapScore(after, anchor.suffix)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

function overlapScore(a: string, b: string): number {
  if (!b) return 0
  let score = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] === b[i]) score++
  return score
}

export interface AppliedAnchor {
  noteId: string
  anchor: HighlightAnchor
}

/** Wrap each anchor's quoted text in `<mark class="hl">`, in place. */
export function applyAnchors(
  container: HTMLElement,
  anchors: AppliedAnchor[],
): void {
  const fullText = container.textContent ?? ''
  for (const { noteId, anchor } of anchors) {
    let start = findNthOccurrence(fullText, anchor.quote, anchor.occurrence)
    if (start === -1) {
      start = findBestOccurrence(fullText, anchor)
    }
    if (start === -1) continue // drift too far — skip rather than mis-highlight
    wrapText(container, start, start + anchor.quote.length, noteId)
  }
}

function wrapText(
  container: HTMLElement,
  start: number,
  end: number,
  noteId: string,
): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let pos = 0
  let node = walker.nextNode() as Text | null
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  while (node) {
    const len = node.data.length
    if (!startNode && start < pos + len) {
      startNode = node
      startOffset = start - pos
    }
    if (!endNode && end <= pos + len) {
      endNode = node
      endOffset = end - pos
    }
    if (startNode && endNode) break
    pos += len
    node = walker.nextNode() as Text | null
  }

  if (!startNode || !endNode) return

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)

  const mark = document.createElement('mark')
  mark.className = 'hl'
  mark.dataset.noteId = noteId

  // extractContents() splits text nodes automatically — handles partial spans.
  mark.appendChild(range.extractContents())
  range.insertNode(mark)
}
