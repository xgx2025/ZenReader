<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterView } from 'vue-router'

import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import PaperTexture from '@/components/common/PaperTexture.vue'
import ToastHost from '@/components/common/ToastHost.vue'
import ReminderToast from '@/components/reader/ReminderToast.vue'
import { useSettingsStore } from '@/stores/settings'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import { useFullscreen } from '@/composables/useFullscreen'
import { useZenClock } from '@/composables/useZenClock'
import { useUpdateCheck } from '@/composables/useUpdateCheck'
import { isTauri } from '@/lib/native'

const settings = useSettingsStore()
const { open, closePanel } = useSettingsPanel()
const { toggle: toggleFullscreen, wire: wireFullscreen } = useFullscreen()
// 全局专注钟：应用启动即走表——香不属于任何页面，退出应用方熄。
const { start: startZenClock } = useZenClock()
// 启动静默探问新版：错开启动繁忙，有新版才轻唤一声；检查失败完全无感。
const { checkUpdate } = useUpdateCheck()

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
  startZenClock()
  window.addEventListener('keydown', onGlobalKeydown)
  window.setTimeout(() => checkUpdate(false), 3000)
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

  <!-- 香尽提醒：全局挂载，人在书库/别的页面也接得住 -->
  <ReminderToast />

  <ToastHost />
</template>
