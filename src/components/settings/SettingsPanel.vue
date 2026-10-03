<script setup lang="ts">
/**
 * 设置面板 —— 按用途分为外观、阅读、书库、禅境、禅钟与关于。
 * 分类只是视图分组，
 * 各控件直接读写 settings store，无独立状态。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import {
  ZEN_ENTRY_OPTIONS,
  ZEN_RITUAL_COMPONENTS,
  resolveZenEntry,
} from '@/components/reader/zenRituals'
import { useSettingsStore } from '@/stores/settings'
import { nativeFs, isTauri } from '@/lib/native'
import { getAppVersion } from '@/lib/update'
import { useUpdateCheck } from '@/composables/useUpdateCheck'
import { COPY } from '@/lib/copy'
import type { SettingsSection } from '@/composables/useSettingsPanel'
import type {
  ReaderFont,
  ThemeName,
  ReaderSettings,
  PaperTextureLevel,
  ReminderAction,
  ZenEntryStyle,
} from '@/types/settings'
import { SIDEBAR_MAX, SIDEBAR_MIN, clampSidebarWidth } from '@/types/settings'

const props = defineProps<{ open: boolean; section: SettingsSection }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const inTauri = isTauri()

// 关于行：展示版本 + 检查更新（与 App.vue 的启动静默检查共用同一份状态）。
const { checking, currentVersion, checkUpdate } = useUpdateCheck()
onMounted(() => {
  if (!inTauri) return
  getAppVersion().then((v) => {
    if (v) currentVersion.value = v
  })
})

const tab = ref<SettingsSection>('appearance')
const TABS: { key: SettingsSection; label: string; hint: string }[] = [
  { key: 'appearance', label: COPY.appearance, hint: '主题与纸张' },
  { key: 'reading', label: COPY.reading, hint: '字体与排版' },
  { key: 'library', label: COPY.library, hint: '目录与侧栏' },
  { key: 'zen', label: COPY.zenMode, hint: '入定方式' },
  { key: 'clock', label: COPY.zenClock, hint: '歇息提醒' },
  { key: 'about', label: COPY.about, hint: '版本与更新' },
]
const layoutEl = ref<HTMLElement | null>(null)
watch(() => [props.open, props.section] as const, async ([open, section]) => {
  if (!open) return
  tab.value = section
  await nextTick()
  layoutEl.value?.parentElement?.scrollTo({ top: 0 })
}, { immediate: true })

watch(tab, async () => {
  await nextTick()
  layoutEl.value?.parentElement?.scrollTo({ top: 0 })
})

function onCategoryKeydown(e: KeyboardEvent) {
  const direction = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
  if (!direction && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const current = TABS.findIndex((item) => item.key === tab.value)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (current + direction + TABS.length) % TABS.length
  tab.value = TABS[next].key
  const buttons = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons?.[next]?.focus()
}

const THEMES: { key: ThemeName; label: string }[] = [
  { key: 'light', label: COPY.themeLight },
  { key: 'sepia', label: COPY.themeSepia },
  { key: 'dark', label: COPY.themeDark },
]

const FONTS: { key: ReaderFont; label: string }[] = [
  { key: 'serif', label: COPY.fontSerif },
  { key: 'sans', label: COPY.fontSans },
]

const PAPER_TEXTURES: { key: PaperTextureLevel; label: string }[] = [
  { key: 'off', label: COPY.paperTextureOff },
  { key: 'subtle', label: COPY.paperTextureSubtle },
  { key: 'rich', label: COPY.paperTextureRich },
]

const RANGES = [
  { key: 'fontSize', label: COPY.fontSize, min: 13, max: 28, step: 1 },
  { key: 'lineHeight', label: COPY.lineHeight, min: 1.5, max: 2.4, step: 0.05 },
  { key: 'textWidth', label: COPY.textWidth, min: 28, max: 60, step: 1 },
] as const

const TOGGLES = [
  { key: 'paragraphIndent', label: COPY.paragraphIndent },
  { key: 'justify', label: COPY.justify },
] as const

type ToggleKey = (typeof TOGGLES)[number]['key']

type RangeKey = (typeof RANGES)[number]['key']

function rangeValue(key: RangeKey): number {
  return settings[key]
}

function onRange(e: Event, key: RangeKey) {
  const value = Number((e.target as HTMLInputElement).value)
  settings.update({ [key]: value } as Partial<ReaderSettings>)
}

function onToggle(key: ToggleKey) {
  settings.update({ [key]: !settings[key] } as Partial<ReaderSettings>)
}

/** 侧栏宽度：与右缘手柄共用同一个夹取函数，故两条路写下的值都合法。 */
function onSidebarWidth(e: Event) {
  const value = clampSidebarWidth(Number((e.target as HTMLInputElement).value))
  settings.update({ sidebarWidth: value })
}

async function pickVaultFolder() {
  if (!inTauri) return
  const dir = await nativeFs.pickFolder()
  if (dir) settings.setVaultPath(dir)
}

const ACTIONS: { key: ReminderAction; label: string }[] = [
  { key: 'stretch', label: COPY.actStretch },
  { key: 'water', label: COPY.actWater },
  { key: 'eyes', label: COPY.actEyes },
  { key: 'breathe', label: COPY.actBreathe },
]

/** 香长预设：小憩 / 一炷 / 深读 / 长卷。 */
const PRESETS: { minutes: number; label: string }[] = [
  { minutes: 15, label: COPY.reminderPreset },
  { minutes: 25, label: COPY.reminderPresetIncense },
  { minutes: 45, label: COPY.reminderPresetDeep },
  { minutes: 60, label: COPY.reminderPresetLong },
]

function onReminderInterval(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  settings.updateReminder({ intervalMinutes: value })
}

function setPreset(minutes: number) {
  settings.updateReminder({ intervalMinutes: minutes })
}

function toggleAction(action: ReminderAction) {
  const cur = settings.reminder.actions
  const next = cur.includes(action)
    ? cur.filter((a) => a !== action)
    : [...cur, action]
  settings.updateReminder({ actions: next })
}

/** 当前档的意境描述（设置面板里的一行小字）。 */
const currentZenEntry = computed(() =>
  ZEN_ENTRY_OPTIONS.find((o) => o.key === settings.zenEntry),
)

/**
 * 试播：全屏预演所选（随机档现抽）的入定动画。仪式组件本就自含
 * 时间线、轻触即跳过，此处只管挂载与卸载；轻雾没有组件，复用出定
 * 的那口短雾，播完自动收场。
 */
const previewStyle = ref<Exclude<ZenEntryStyle, 'random'> | null>(null)
const previewNonce = ref(0)
const previewComponent = computed(() =>
  previewStyle.value && previewStyle.value !== 'mist'
    ? ZEN_RITUAL_COMPONENTS[previewStyle.value]
    : null,
)
let previewTimer: ReturnType<typeof setTimeout> | null = null

function playPreview() {
  previewStyle.value = resolveZenEntry(settings.zenEntry)
  previewNonce.value++
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  if (previewStyle.value === 'mist') {
    previewTimer = setTimeout(() => {
      previewTimer = null
      previewStyle.value = null
    }, 1000)
  }
}

function closePreview() {
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  previewStyle.value = null
}

onBeforeUnmount(closePreview)
</script>

<template>
  <BaseDialog
    :open="open"
    :title="COPY.settings"
    max-width="lg"
    height="560px"
    max-height="calc(100dvh - 2rem)"
    @close="emit('close')"
  >
    <div ref="layoutEl" class="flex min-h-[430px]">
      <nav class="sticky top-0 h-fit w-44 shrink-0 border-r border-line px-3 py-5" role="tablist" aria-orientation="vertical" :aria-label="COPY.settings">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          role="tab"
          class="mb-1 block w-full rounded-xl px-3 py-2.5 text-left transition-colors"
          :class="tab === t.key ? 'bg-bamboo/12 text-ink' : 'text-ink-soft hover:bg-paper-deep/50 hover:text-ink'"
          :aria-selected="tab === t.key"
          :aria-controls="`settings-${t.key}`"
          @keydown="onCategoryKeydown"
          @click="tab = t.key"
        >
          <span class="block text-sm font-medium">{{ t.label }}</span>
          <span class="mt-0.5 block text-[11px] text-ink-soft">{{ t.hint }}</span>
        </button>
      </nav>
      <div class="min-w-0 flex-1 px-6 py-5">

    <section id="settings-appearance" v-show="tab === 'appearance'" role="tabpanel" :aria-label="COPY.appearance">
      <h2 class="font-serif text-xl text-ink">{{ COPY.appearance }}</h2>
      <p class="mt-1 text-xs text-ink-soft">调整整个应用的纸色与纹理。</p>
      <div class="mt-6 rounded-xl bg-paper-deep/40 px-4 py-3">
        <span class="block text-xs text-ink-soft">{{ COPY.theme }}</span>
        <div class="mt-2 flex rounded-full border border-line p-0.5">
          <button
            v-for="t in THEMES"
            :key="t.key"
            class="flex-1 rounded-full px-3 py-1.5 text-xs text-ink-soft transition-colors"
            :class="{ 'bg-bamboo/15 text-ink': settings.theme === t.key }"
            @click="settings.setTheme(t.key)"
          >
            {{ t.label }}
          </button>
        </div>

        <span class="mt-3 block text-xs text-ink-soft">{{ COPY.paperTexture }}</span>
        <div class="mt-2 flex rounded-full border border-line p-0.5">
          <button
            v-for="p in PAPER_TEXTURES"
            :key="p.key"
            class="flex-1 rounded-full px-3 py-1.5 text-xs text-ink-soft transition-colors"
            :class="{ 'bg-bamboo/15 text-ink': settings.paperTexture === p.key }"
            @click="settings.update({ paperTexture: p.key })"
          >
            {{ p.label }}
          </button>
        </div>
      </div>
    </section>

    <section id="settings-reading" v-show="tab === 'reading'" role="tabpanel" :aria-label="COPY.reading">
      <h2 class="font-serif text-xl text-ink">{{ COPY.reading }}</h2>
      <p class="mt-1 text-xs text-ink-soft">让正文的字形与节奏更合眼。</p>
      <div class="mt-6 rounded-xl bg-paper-deep/40 px-4 py-3">

        <span class="block text-xs text-ink-soft">{{ COPY.font }}</span>
        <div class="mt-2 flex rounded-full border border-line p-0.5">
          <button
            v-for="f in FONTS"
            :key="f.key"
            class="flex-1 rounded-full px-3 py-1.5 text-xs text-ink-soft transition-colors"
            :class="{ 'bg-bamboo/15 text-ink': settings.fontFamily === f.key }"
            @click="settings.update({ fontFamily: f.key })"
          >
            {{ f.label }}
          </button>
        </div>
      </div>

      <h3 class="mt-5 flex items-center gap-1.5 text-sm font-medium text-ink-soft">
        {{ COPY.typography }}
      </h3>
      <div class="mt-2 rounded-xl bg-paper-deep/40 px-4 py-3">
        <div class="space-y-4">
          <div v-for="r in RANGES" :key="r.key">
            <div class="flex items-center justify-between text-xs">
              <span class="text-ink-soft">{{ r.label }}</span>
              <span class="tabular-nums text-dusk">
                {{ rangeValue(r.key) }}
              </span>
            </div>
            <input
              type="range"
              class="mt-2 w-full accent-bamboo"
              :min="r.min"
              :max="r.max"
              :step="r.step"
              :value="rangeValue(r.key)"
              @input="onRange($event, r.key)"
            />
          </div>
        </div>
      </div>

      <h3 class="mt-5 flex items-center gap-1.5 text-sm font-medium text-ink-soft">
        {{ COPY.paragraph }}
      </h3>
      <div class="mt-2 rounded-xl bg-paper-deep/40 px-4 py-3">
        <div class="space-y-4">
          <div
            v-for="tg in TOGGLES"
            :key="tg.key"
            class="flex items-center justify-between"
          >
            <span class="text-xs text-ink-soft">{{ tg.label }}</span>
            <button
              type="button"
              role="switch"
              :aria-checked="settings[tg.key]"
              class="relative h-5 w-9 rounded-full border transition-colors duration-200"
              :class="
                settings[tg.key]
                  ? 'border-bamboo bg-bamboo/25'
                  : 'border-line bg-paper-deep'
              "
              @click="onToggle(tg.key)"
            >
              <span
                class="absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="
                  settings[tg.key]
                    ? 'left-[1.15rem] bg-bamboo'
                    : 'left-0.5 bg-dusk'
                "
              />
            </button>
          </div>
        </div>
      </div>
    </section>

    <section id="settings-zen" v-show="tab === 'zen'" role="tabpanel" :aria-label="COPY.zenMode">
      <h2 class="font-serif text-xl text-ink">{{ COPY.zenMode }}</h2>
      <p class="mt-1 text-xs text-ink-soft">选择入定的过场与全屏方式。</p>
      <h3 class="mt-6 flex items-center gap-1.5 text-sm font-medium text-ink-soft">
        {{ COPY.entryGroup }}
      </h3>
      <div class="mt-2 rounded-xl bg-paper-deep/40 px-4 py-3">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ink-soft">{{ COPY.zenEntry }}</span>
          <button
            class="rounded-full border border-line px-3 py-1 text-xs text-ink-soft transition-colors hover:border-bamboo hover:text-ink"
            @click="playPreview"
          >
            {{ COPY.zenEntryPreview }}
          </button>
        </div>
        <div class="mt-2 grid grid-cols-3 gap-2">
          <button
            v-for="s in ZEN_ENTRY_OPTIONS"
            :key="s.key"
            class="rounded-full border px-2 py-1.5 text-xs transition-colors"
            :class="
              settings.zenEntry === s.key
                ? 'border-bamboo bg-bamboo/15 text-ink'
                : 'border-line text-ink-soft hover:border-bamboo'
            "
            :title="s.hint"
            @click="settings.update({ zenEntry: s.key })"
          >
            {{ s.label }}
          </button>
        </div>
        <p class="mt-2 text-[11px] leading-snug text-dusk">
          {{ currentZenEntry?.hint }}
        </p>

        <div class="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <div>
            <span class="text-xs text-ink-soft">{{ COPY.immersiveFullscreen }}</span>
            <p class="mt-0.5 text-[11px] leading-snug text-dusk">
              {{ COPY.immersiveFullscreenHint }}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="settings.immersiveFullscreen"
            class="relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200"
            :class="
              settings.immersiveFullscreen
                ? 'border-bamboo bg-bamboo/25'
                : 'border-line bg-paper-deep'
            "
            @click="settings.update({ immersiveFullscreen: !settings.immersiveFullscreen })"
          >
            <span
              class="absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
              :class="
                settings.immersiveFullscreen
                  ? 'left-[1.15rem] bg-bamboo'
                  : 'left-0.5 bg-dusk'
              "
            />
          </button>
        </div>
      </div>

    </section>

    <section id="settings-clock" v-show="tab === 'clock'" role="tabpanel" :aria-label="COPY.zenClock">
      <h2 class="font-serif text-xl text-ink">{{ COPY.zenClock }}</h2>
      <p class="mt-1 text-xs text-ink-soft">设定一炷香的长度与歇息提醒。</p>
      <div class="mt-6 rounded-xl bg-paper-deep/40 px-4 py-3">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ink-soft">{{ COPY.reminderEnable }}</span>
          <button
            type="button"
            role="switch"
            :aria-checked="settings.reminder.enabled"
            class="relative h-5 w-9 rounded-full border transition-colors duration-200"
            :class="
              settings.reminder.enabled
                ? 'border-bamboo bg-bamboo/25'
                : 'border-line bg-paper-deep'
            "
            @click="settings.updateReminder({ enabled: !settings.reminder.enabled })"
          >
            <span
              class="absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
              :class="
                settings.reminder.enabled
                  ? 'left-[1.15rem] bg-bamboo'
                  : 'left-0.5 bg-dusk'
              "
            />
          </button>
        </div>

        <div class="mt-4">
          <div class="flex items-center justify-between text-xs">
            <span class="text-ink-soft">{{ COPY.reminderInterval }}</span>
            <span class="tabular-nums text-dusk">
              {{ settings.reminder.intervalMinutes }}
              {{ COPY.reminderIntervalUnit }}
            </span>
          </div>
          <div class="mt-2 flex gap-2">
            <button
              v-for="p in PRESETS"
              :key="p.minutes"
              type="button"
              class="flex-1 rounded-full border px-2 py-1.5 text-xs transition-colors"
              :class="
                settings.reminder.intervalMinutes === p.minutes
                  ? 'border-bamboo bg-bamboo/15 text-ink'
                  : 'border-line text-ink-soft hover:border-bamboo'
              "
              @click="setPreset(p.minutes)"
            >
              {{ p.label }}
            </button>
          </div>
          <input
            type="range"
            class="mt-2 w-full accent-bamboo"
            min="5"
            max="120"
            step="5"
            :value="settings.reminder.intervalMinutes"
            @input="onReminderInterval"
          />
        </div>

        <div class="mt-4">
          <p class="text-xs text-ink-soft">{{ COPY.reminderActions }}</p>
          <div class="mt-2 flex gap-2">
            <button
              v-for="a in ACTIONS"
              :key="a.key"
              class="flex-1 rounded-full border px-2 py-1.5 text-xs transition-colors"
              :class="
                settings.reminder.actions.includes(a.key)
                  ? 'border-bamboo bg-bamboo/15 text-ink'
                  : 'border-line text-ink-soft hover:border-bamboo'
              "
              @click="toggleAction(a.key)"
            >
              {{ a.label }}
            </button>
          </div>
        </div>

        <div class="mt-4 flex items-center justify-between gap-3">
          <div>
            <span class="text-xs text-ink-soft">{{ COPY.reminderPreHint }}</span>
            <p class="mt-0.5 text-[11px] leading-snug text-dusk">
              {{ COPY.reminderPreHintHint }}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="settings.reminder.preHint"
            class="relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200"
            :class="
              settings.reminder.preHint
                ? 'border-bamboo bg-bamboo/25'
                : 'border-line bg-paper-deep'
            "
            @click="settings.updateReminder({ preHint: !settings.reminder.preHint })"
          >
            <span
              class="absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
              :class="
                settings.reminder.preHint
                  ? 'left-[1.15rem] bg-bamboo'
                  : 'left-0.5 bg-dusk'
              "
            />
          </button>
        </div>

        <div class="mt-4 flex items-center justify-between gap-3">
          <div>
            <span class="text-xs text-ink-soft">{{ COPY.reminderChime }}</span>
            <p class="mt-0.5 text-[11px] leading-snug text-dusk">
              {{ COPY.reminderChimeHint }}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="settings.reminder.chime"
            class="relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200"
            :class="
              settings.reminder.chime
                ? 'border-bamboo bg-bamboo/25'
                : 'border-line bg-paper-deep'
            "
            @click="settings.updateReminder({ chime: !settings.reminder.chime })"
          >
            <span
              class="absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
              :class="
                settings.reminder.chime
                  ? 'left-[1.15rem] bg-bamboo'
                  : 'left-0.5 bg-dusk'
              "
            />
          </button>
        </div>
      </div>
    </section>

    <section id="settings-library" v-show="tab === 'library'" role="tabpanel" :aria-label="COPY.library">
      <h2 class="font-serif text-xl text-ink">{{ COPY.library }}</h2>
      <p class="mt-1 text-xs text-ink-soft">管理书库所在目录与左侧分组栏。</p>
      <h3 class="mt-6 text-sm font-medium text-ink-soft">{{ COPY.vaultFolder }}</h3>
      <div class="mt-2 rounded-xl bg-paper-deep/40 px-4 py-4">
        <p class="break-all text-sm text-ink" :title="settings.vaultPath || undefined">
          {{ settings.vaultPath || COPY.noFolder }}
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-if="inTauri"
            class="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-bamboo hover:text-ink"
            @click="pickVaultFolder"
          >{{ COPY.chooseFolder }}</button>
          <span v-else class="text-xs text-ink-soft">{{ COPY.desktopOnly }}</span>
          <button
            v-if="settings.vaultPath"
            class="rounded-full px-3 py-1.5 text-xs text-ink-soft transition-colors hover:bg-sandal/10 hover:text-sandal"
            @click="settings.setVaultPath('')"
          >{{ COPY.clearFolder }}</button>
        </div>
      </div>

      <h3 class="mt-6 text-sm font-medium text-ink-soft">{{ COPY.sidebarWidth }}</h3>
      <div class="mt-2 rounded-xl bg-paper-deep/40 px-4 py-4" :class="settings.vaultPath ? '' : 'opacity-40'">
        <div class="flex items-center gap-3">
          <input
            type="range"
            class="min-w-0 flex-1 accent-bamboo"
            :aria-label="COPY.sidebarWidth"
            :min="SIDEBAR_MIN"
            :max="SIDEBAR_MAX"
            step="4"
            :value="settings.sidebarWidth"
            :disabled="!settings.vaultPath"
            @input="onSidebarWidth"
          />
          <span class="w-10 text-right text-sm tabular-nums text-ink-soft">{{ settings.sidebarWidth }}</span>
        </div>
        <p class="mt-2 text-xs text-ink-soft">也可以拖动书库侧栏的右缘，双击复位。</p>
      </div>
    </section>

    <section id="settings-about" v-show="tab === 'about'" role="tabpanel" :aria-label="COPY.about">
      <h2 class="font-serif text-xl text-ink">{{ COPY.about }}</h2>
      <p class="mt-1 text-xs text-ink-soft">ZenReader · 禅阅读</p>
      <div class="mt-6 flex items-center justify-between gap-3 rounded-xl bg-paper-deep/40 px-4 py-4">
        <span class="text-sm text-ink">{{ currentVersion ? `v${currentVersion}` : '当前版本' }}</span>
        <button
          v-if="inTauri"
          class="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-bamboo hover:text-ink disabled:cursor-wait disabled:opacity-50"
          :disabled="checking"
          @click="checkUpdate(true)"
        >{{ checking ? COPY.checkingUpdate : COPY.checkUpdate }}</button>
        <span v-else class="text-xs text-ink-soft">{{ COPY.desktopOnly }}</span>
      </div>
    </section>
      </div>
    </div>

    <!-- 试播：全屏预演所选入定动画，轻触任意处即止 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="previewStyle"
          class="fixed inset-0 z-[70] cursor-pointer"
          @click="closePreview"
        >
          <div
            v-if="previewStyle === 'mist'"
            :key="previewNonce"
            class="zen-veil-out-mist"
            aria-hidden="true"
          ></div>
          <component
            :is="previewComponent"
            v-else
            :key="previewNonce"
            @skip="closePreview"
            @finish="closePreview"
          />
        </div>
      </Transition>
    </Teleport>

  </BaseDialog>
</template>
