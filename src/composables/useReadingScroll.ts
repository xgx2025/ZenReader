import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Shared scroll brain for the reading surface:
 * - scrollspy: which heading is "current" (last one past the top threshold)
 * - toolbar auto-hide: header slides away while reading down, returns on
 *   the slightest upward scroll - position is preserved via translate, so
 *   the prose never reflows.
 *
 * The scroll listener is rAF-throttled; all state updates are cheap
 * (a few getBoundingClientRect calls against the TOC's heading ids).
 */
export function useReadingScroll(headingIds: Ref<string[]>) {
  /** The scrollable element wrapping the prose. */
  const containerRef = ref<HTMLElement | null>(null)
  /** id of the heading the reader is currently in ('' before the first). */
  const activeHeadingId = ref('')
  /** True while the top toolbar should be tucked away. */
  const toolbarHidden = ref(false)

  const ACTIVE_OFFSET = 120 // px below container top where a heading "counts"
  const HIDE_MIN_SCROLL = 64 // don't hide before the reader has moved a bit
  const HIDE_DELTA = 6 // ignore jitter smaller than this

  let lastY = 0
  let rafId = 0

  function measure() {
    rafId = 0
    const el = containerRef.value
    if (!el) return
    const topLine = el.getBoundingClientRect().top + ACTIVE_OFFSET

    let current = ''
    for (const id of headingIds.value) {
      const h = document.getElementById(id)
      if (!h) continue
      if (h.getBoundingClientRect().top <= topLine) current = id
      else break
    }
    activeHeadingId.value = current

    const y = el.scrollTop
    const delta = y - lastY
    if (delta > HIDE_DELTA && y > HIDE_MIN_SCROLL) {
      toolbarHidden.value = true
    } else if (delta < -HIDE_DELTA) {
      toolbarHidden.value = false
    }
    lastY = y
  }

  function onScroll() {
    if (rafId) return
    rafId = requestAnimationFrame(measure)
  }

  onMounted(() => {
    containerRef.value?.addEventListener('scroll', onScroll, { passive: true })
  })

  onBeforeUnmount(() => {
    containerRef.value?.removeEventListener('scroll', onScroll)
    if (rafId) cancelAnimationFrame(rafId)
  })

  /** Smooth-scroll the container by a fraction of the viewport. */
  function scrollByFraction(fraction: number) {
    const el = containerRef.value
    if (!el) return
    el.scrollBy({ top: el.clientHeight * fraction, behavior: 'smooth' })
  }

  /** Scroll so a heading sits at the active-offset line (not flush to top). */
  function scrollToHeading(id: string) {
    const el = containerRef.value
    const h = document.getElementById(id)
    if (!el || !h) return
    el.scrollTo({
      top: el.scrollTop + h.getBoundingClientRect().top - el.getBoundingClientRect().top - ACTIVE_OFFSET + 8,
      behavior: 'smooth',
    })
  }

  return {
    containerRef,
    activeHeadingId,
    toolbarHidden,
    scrollByFraction,
    scrollToHeading,
  }
}
