import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import {
  captureSelection,
  type SelectionCapture,
} from '@/lib/anchor/textAnchor'
import { COPY } from '@/lib/copy'
import { useToast } from '@/composables/useToast'

/** Track text selections inside `container` and expose a floating-toolbar state. */
export function useSelectionAnchor(container: Ref<HTMLElement | null>) {
  const capture = ref<SelectionCapture | null>(null)
  const visible = ref(false)

  function readSelection() {
    const el = container.value
    if (!el) return
    // 跨段落选区无法稳定锚定（v1 限制），轻声相告而非静默放弃。
    const selection = window.getSelection()
    if (selection && selection.toString().includes('\n')) {
      capture.value = null
      visible.value = false
      useToast().notify(COPY.anchorCrossBlock, 'dusk')
      return
    }
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
