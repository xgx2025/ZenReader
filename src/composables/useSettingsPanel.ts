import { ref } from 'vue'

/** Module-scoped singleton — shared across views and App.vue's single panel. */
const open = ref(false)
export type SettingsSection = 'appearance' | 'reading' | 'library' | 'zen' | 'clock' | 'about'
const section = ref<SettingsSection>('appearance')

export function useSettingsPanel() {
  function openPanel(target: SettingsSection = 'appearance') {
    section.value = target
    open.value = true
  }
  function closePanel() {
    open.value = false
  }
  function togglePanel() {
    open.value = !open.value
  }

  return { open, section, openPanel, closePanel, togglePanel }
}
