<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterView } from 'vue-router'

import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import PaperTexture from '@/components/common/PaperTexture.vue'
import { useSettingsStore } from '@/stores/settings'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import { useFullscreen } from '@/composables/useFullscreen'
import { isTauri } from '@/lib/native'

const settings = useSettingsStore()
const { open, closePanel } = useSettingsPanel()
const { toggle: toggleFullscreen, wire: wireFullscreen } = useFullscreen()

/** F11 全局切换全屏（浏览器环境则交给浏览器原生行为，不拦截）。 */
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key !== 'F11') return
  if (!isTauri()) return
  e.preventDefault()
  toggleFullscreen()
}

onMounted(() => {
  settings.applyAll()
  wireFullscreen()
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <RouterView v-slot="{ Component }">
    <Transition name="fade" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>

  <PaperTexture />

  <SettingsPanel :open="open" @close="closePanel" />
</template>
