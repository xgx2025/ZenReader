<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'

import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import { useSettingsStore } from '@/stores/settings'
import { useSettingsPanel } from '@/composables/useSettingsPanel'

const settings = useSettingsStore()
const { open, closePanel } = useSettingsPanel()

onMounted(() => {
  settings.applyAll()
})
</script>

<template>
  <RouterView v-slot="{ Component }">
    <Transition name="fade" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>

  <SettingsPanel :open="open" @close="closePanel" />
</template>
