import { ref } from 'vue'

/** Module-scoped singleton — shared across views and App.vue's single panel. */
const open = ref(false)

export function useSettingsPanel() {
  function openPanel() {
    open.value = true
  }
  function closePanel() {
    open.value = false
  }
  function togglePanel() {
    open.value = !open.value
  }

  return { open, openPanel, closePanel, togglePanel }
}
