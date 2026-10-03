<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ZIcon from '@/components/common/ZIcon.vue'
import { GUIDE_ORDER, GUIDES, type GuideId } from '@/composables/useGuide'
import { useGuide } from '@/composables/useGuide'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import { useLibraryStore } from '@/stores/library'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useSettingsStore } from '@/stores/settings'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const knowledge = useKnowledgeStore()
const settings = useSettingsStore()
const { open: settingsOpen } = useSettingsPanel()
const { active, stepIndex, helpOpen, status, current, setGuideScope, beginGuide, suggestGuide, finishGuide, nextGuide, guideEvent } = useGuide()

const box = ref({ left: '16px', top: '80px' })
const anchored = ref(false)
const obscured = ref(false)
let highlighted: HTMLElement | null = null
let layoutTimer: ReturnType<typeof setInterval> | null = null

const routeMatches = computed(() => {
  if (!current.value) return false
  return current.value.route === '/read' ? route.path.startsWith('/read/') : route.path === current.value.route
})
const visible = computed(() => !!current.value && routeMatches.value && !helpOpen.value && !settingsOpen.value && !settings.zenMode && !obscured.value)

function position() {
  const allowComposer = active.value === 'note' && current.value?.target === '[data-guide="note-composer"]'
  obscured.value = !!document.querySelector('[data-guide-importing="true"]')
    || [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((dialog) =>
      !dialog.classList.contains('guide-help') && !(allowComposer && dialog.querySelector('[data-guide="note-composer"]')),
    )
  anchored.value = false
  if (!visible.value || !current.value) {
    highlighted?.classList.remove('guide-highlight')
    highlighted = null
    return
  }
  const el = document.querySelector<HTMLElement>(current.value.target)
  const rect = el?.getBoundingClientRect()
  if (!el || !rect || !rect.width || !rect.height) {
    highlighted?.classList.remove('guide-highlight')
    highlighted = null
    box.value = { left: `${Math.max(16, window.innerWidth - 344)}px`, top: `${Math.max(80, window.innerHeight - 230)}px` }
    return
  }
  const broad = rect.width > 600 || rect.height > 380
  if (highlighted !== (broad ? null : el)) {
    highlighted?.classList.remove('guide-highlight')
    highlighted = broad ? null : el
    highlighted?.classList.add('guide-highlight')
  }
  anchored.value = true
  const width = Math.min(320, window.innerWidth - 32)
  const left = Math.min(Math.max(16, broad ? rect.right - width - 20 : rect.left), window.innerWidth - width - 16)
  const below = rect.bottom + 12
  const above = rect.top - 200
  const top = broad ? Math.max(16, Math.min(window.innerHeight - 215, rect.bottom - 215))
    : below + 190 < window.innerHeight ? below : Math.max(16, above)
  box.value = { left: `${left}px`, top: `${Math.min(top, window.innerHeight - 210)}px` }
}

watch(() => settings.vaultPath, setGuideScope, { immediate: true })
watch([() => route.path, () => settings.vaultPath], () => {
  if (route.path !== '/') return
  if (!settings.vaultPath) suggestGuide('vault')
}, { immediate: true, flush: 'post' })
watch(() => route.path, (path) => {
  if (path === '/import') guideEvent('import-page')
  if (active.value === 'vault' && stepIndex.value === 1 && path === '/import') {
    finishGuide()
    suggestGuide('import', 1)
  } else if (active.value === 'import' && stepIndex.value === 3 && path !== '/import') {
    finishGuide()
  } else if (active.value === 'note' && stepIndex.value === 3 && !path.startsWith('/read/')) {
    finishGuide()
  }
})
watch(helpOpen, (open) => {
  if (open && settings.vaultPath) void knowledge.load()
})
watch([current, visible, stepIndex, () => route.path], async () => {
  await nextTick()
  position()
}, { flush: 'post' })

onMounted(() => {
  layoutTimer = setInterval(position, 250)
  window.addEventListener('resize', position)
  window.addEventListener('scroll', position, true)
})
onBeforeUnmount(() => {
  if (layoutTimer) clearInterval(layoutTimer)
  window.removeEventListener('resize', position)
  window.removeEventListener('scroll', position, true)
  highlighted?.classList.remove('guide-highlight')
})

function canStart(id: GuideId) {
  if (id === 'vault') return true
  if (!settings.vaultPath) return false
  if (id === 'knowledge') return knowledge.notes.length > 0
  if (id === 'folder-scope') return library.flatFolders.length > 0
  if (id === 'folder-move') return library.files.length > 0
  if (id === 'clock') return settings.reminder.enabled && library.files.length > 0
  if (['note', 'zen', 'clock'].includes(id)) return library.files.length > 0
  return true
}

function unavailableReason(id: GuideId) {
  if (!settings.vaultPath) return '先打开书库'
  if (id === 'knowledge') return '先写一条觉悟'
  if (id === 'folder-scope') return '先建一个分组'
  if (id === 'clock' && !settings.reminder.enabled) return '先在设置开启禅钟'
  return '先引入文章'
}

function start(id: GuideId) {
  const index = id === 'vault' && settings.vaultPath ? 1
    : id === 'import' && route.path === '/import' ? 1
    : id === 'knowledge' && route.path === '/knowledge' && document.querySelector('[data-topic-id]') ? 1
    : 0
  beginGuide(id, index)
  const target = GUIDES[id].steps[index].route
  if (target === '/read') {
    if (route.path.startsWith('/read/')) return
    const first = library.files[0]
    if (first) void router.push(`/read/${encodeURIComponent(first.relativePath)}`)
  } else if (route.path !== target) void router.push(target)
}

function onNext() {
  const finishedVault = active.value === 'vault' && stepIndex.value === GUIDES.vault.steps.length - 1
  nextGuide()
  if (finishedVault && library.files.length === 0) suggestGuide('import')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && current" class="guide-layer" aria-live="polite">
      <div class="guide-card" :class="anchored ? 'guide-card-anchored' : ''" :style="box">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[10px] tracking-[0.2em] text-bamboo">使用指引 · {{ active ? GUIDES[active].title : '' }}</p>
            <h2 class="mt-1 font-serif text-base text-ink">{{ current.title }}</h2>
          </div>
          <button class="rounded-full p-1 text-dusk hover:bg-paper-deep hover:text-ink" title="跳过本条指引" aria-label="跳过本条指引" @click="finishGuide(true)"><ZIcon name="close" :size="15" /></button>
        </div>
        <p class="mt-2 text-xs leading-6 text-ink-soft">{{ current.body }}</p>
        <div class="mt-3 flex items-center justify-between gap-3">
          <span class="text-[11px] tabular-nums text-dusk">{{ stepIndex + 1 }} / {{ active ? GUIDES[active].steps.length : 0 }}</span>
          <button v-if="!current.event" class="rounded-full bg-bamboo px-3 py-1.5 text-xs text-paper hover:opacity-90" @click="onNext">{{ current.nextLabel || '下一步' }}</button>
          <span v-else class="text-[11px] text-bamboo">请在界面中操作 ↗</span>
        </div>
      </div>
    </div>

    <div v-if="helpOpen" class="guide-help-backdrop" @click.self="helpOpen = false">
      <section class="guide-help" role="dialog" aria-modal="true" aria-label="使用指引" @keydown.esc.stop="helpOpen = false">
        <header class="flex items-center justify-between border-b border-line px-5 py-4">
          <div><h2 class="font-serif text-lg text-ink">使用指引</h2><p class="mt-1 text-xs text-dusk">按需要重看，每条都可以跳过。</p></div>
          <button class="rounded-full p-1.5 text-dusk hover:bg-paper-deep hover:text-ink" aria-label="关闭使用指引" @click="helpOpen = false"><ZIcon name="close" :size="17" /></button>
        </header>
        <div class="max-h-[65vh] space-y-1 overflow-y-auto p-3">
          <button v-for="id in GUIDE_ORDER" :key="id" class="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-40" :disabled="!canStart(id)" @click="start(id)">
            <span class="text-sm text-ink">{{ GUIDES[id].title }}</span>
            <span class="shrink-0 text-xs text-dusk">{{ !canStart(id) ? unavailableReason(id) : status[id] === 'done' ? '已完成 · 重看' : status[id] === 'skipped' ? '已跳过 · 重看' : '开始' }}</span>
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.guide-layer { position: fixed; inset: 0; z-index: 65; pointer-events: none; }
.guide-card { position: fixed; width: min(320px, calc(100vw - 32px)); max-height: min(48vh, 260px); overflow-y: auto; border: 1px solid color-mix(in srgb, var(--bamboo) 38%, var(--line)); border-radius: 18px; background: var(--paper); padding: 15px 16px; box-shadow: 0 16px 44px color-mix(in srgb, var(--ink) 18%, transparent); pointer-events: auto; }
.guide-help-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, var(--ink) 40%, transparent); }
.guide-help { width: min(440px, 100%); overflow: hidden; border: 1px solid var(--line); border-radius: 20px; background: var(--paper); box-shadow: 0 20px 60px color-mix(in srgb, var(--ink) 20%, transparent); }
:global(.guide-highlight) { outline: 2px solid var(--bamboo) !important; outline-offset: 4px; border-radius: 8px; }
</style>
