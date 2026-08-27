import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import {
  captureSelection,
  type SelectionCapture,
} from '@/lib/anchor/textAnchor'

/** Track text selections inside `container` and expose a floating-toolbar state. */
export function useSelectionAnchor(container: Ref<HTMLElement | null>) {
  const capture = ref<SelectionCapture | null>(null)
  const visible = ref(false)

  function readSelection() {
    const el = container.value
    if (!el) return
    const cap = captureSelection(el)
    capture.value = cap
    visible.value = cap !== null
  }

  function onMouseUp() {
    // Let the browser settle the selection before reading it.
    window.setTimeout(readSelection, 0)
  }

  function dismiss() {
    visible.value = false
    capture.value = null
  }

  onMounted(() => document.addEventListener('mouseup', onMouseUp))
  onBeforeUnmount(() => document.removeEventListener('mouseup', onMouseUp))

  return { capture, visible, dismiss }
}
