<script setup lang="ts">
import { RouterLink } from 'vue-router'

import ZIcon from '@/components/common/ZIcon.vue'
import type { IconName } from '@/components/common/ZIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import { COPY } from '@/lib/copy'
import type { ThemeName } from '@/types/settings'

defineProps<{ active: 'library' | 'knowledge' }>()

const settings = useSettingsStore()
const { openPanel } = useSettingsPanel()
const themes: ThemeName[] = ['light', 'sepia', 'dark']
const themeIcon: Record<ThemeName, IconName> = {
  light: 'sun',
  sepia: 'sunset',
  dark: 'moon',
}

function cycleTheme() {
  const index = themes.indexOf(settings.theme)
  settings.setTheme(themes[(index + 1) % themes.length])
}
</script>

<template>
  <header class="header-fade relative z-10 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 bg-paper/70 px-6 py-3 backdrop-blur-md">
    <div class="flex min-w-0 items-baseline gap-2.5">
      <h1 class="shrink-0 font-serif text-xl leading-tight">{{ COPY.appName }}</h1>
      <span class="hidden text-[11px] uppercase tracking-[0.18em] text-dusk xl:inline">
        {{ COPY.appNameLatin }}
      </span>
    </div>

    <nav aria-label="主要页面" class="flex items-center gap-1 rounded-full bg-paper-deep/55 p-1 text-sm">
      <RouterLink
        to="/"
        class="rounded-full px-4 py-1.5 transition-colors"
        :class="active === 'library' ? 'bg-bamboo text-paper' : 'text-ink-soft hover:text-ink'"
        :aria-current="active === 'library' ? 'page' : undefined"
      >{{ COPY.library }}</RouterLink>
      <RouterLink
        to="/knowledge"
        class="rounded-full px-4 py-1.5 transition-colors"
        :class="active === 'knowledge' ? 'bg-bamboo text-paper' : 'text-ink-soft hover:text-ink'"
        :aria-current="active === 'knowledge' ? 'page' : undefined"
      >{{ COPY.knowledgeMap }}</RouterLink>
    </nav>

    <div class="flex min-w-0 items-center justify-end gap-1.5">
      <slot name="actions" />
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
        :title="COPY.theme"
        :aria-label="COPY.theme"
        @click="cycleTheme"
      >
        <ZIcon :name="themeIcon[settings.theme]" :size="17" />
      </button>
      <button
        type="button"
        class="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
        :title="COPY.settings"
        :aria-label="COPY.settings"
        @click="openPanel('appearance')"
      >
        <ZIcon name="settings" :size="18" />
        <span class="text-xs">{{ COPY.settings }}</span>
      </button>
    </div>
  </header>
</template>
