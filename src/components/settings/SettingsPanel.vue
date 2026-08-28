<script setup lang="ts">
import ZIcon from '@/components/common/ZIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { nativeFs, isTauri } from '@/lib/native'
import { COPY } from '@/lib/copy'
import type {
  ReaderFont,
  ThemeName,
  ReaderSettings,
  PaperTextureLevel,
  ReminderAction,
} from '@/types/settings'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const inTauri = isTauri()

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
  { key: 'immersiveFullscreen', label: COPY.immersiveFullscreen },
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

function onReminderInterval(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  settings.updateReminder({ intervalMinutes: value })
}

function toggleAction(action: ReminderAction) {
  const cur = settings.reminder.actions
  const next = cur.includes(action)
    ? cur.filter((a) => a !== action)
    : [...cur, action]
  settings.updateReminder({ actions: next })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4"
        @click.self="emit('close')"
      >
        <div
          class="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-paper shadow-[0_16px_48px_rgba(0,0,0,0.16)]"
        >
          <header
            class="flex items-center justify-between border-b border-line px-5 py-4"
          >
            <h2 class="font-serif text-lg text-ink">{{ COPY.settings }}</h2>
            <button
              class="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
              title="关闭"
              @click="emit('close')"
            >
              <ZIcon name="close" :size="17" />
            </button>
          </header>

          <!-- 书库目录 -->
          <section class="border-b border-line px-5 py-4">
            <h3 class="text-xs font-medium tracking-wide text-dusk">
              {{ COPY.vaultFolder }}
            </h3>
            <div
              class="mt-2.5 flex min-w-0 items-center gap-2 rounded-lg border border-line bg-paper-deep/50 px-3 py-2"
            >
              <ZIcon name="folder" :size="15" class="shrink-0 text-sandal" />
              <span
                class="min-w-0 truncate text-sm"
                :class="settings.vaultPath ? 'text-ink' : 'text-dusk'"
              >
                {{ settings.vaultPath || COPY.noFolder }}
              </span>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <button
                v-if="inTauri"
                class="rounded-full border border-line px-3 py-1 text-xs text-ink-soft transition-colors hover:border-bamboo hover:text-ink"
                @click="pickVaultFolder"
              >
                {{ COPY.chooseFolder }}
              </button>
              <p v-else class="text-xs text-dusk">{{ COPY.desktopOnly }}</p>
              <button
                v-if="settings.vaultPath"
                class="rounded-full px-3 py-1 text-xs text-dusk transition-colors hover:text-sandal"
                @click="settings.setVaultPath('')"
              >
                {{ COPY.clearFolder }}
              </button>
            </div>
          </section>

          <!-- 主题 -->
          <section class="border-b border-line px-5 py-4">
            <h3 class="text-xs font-medium tracking-wide text-dusk">
              {{ COPY.theme }}
            </h3>
            <div class="mt-2.5 flex rounded-full border border-line p-0.5">
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
          </section>

          <!-- 纸纹 -->
          <section class="border-b border-line px-5 py-4">
            <h3 class="text-xs font-medium tracking-wide text-dusk">
              {{ COPY.paperTexture }}
            </h3>
            <div class="mt-2.5 flex rounded-full border border-line p-0.5">
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
          </section>

          <!-- 字体 -->
          <section class="border-b border-line px-5 py-4">
            <h3 class="text-xs font-medium tracking-wide text-dusk">
              {{ COPY.font }}
            </h3>
            <div class="mt-2.5 flex rounded-full border border-line p-0.5">
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
          </section>

          <!-- 禅钟 -->
          <section class="border-b border-line px-5 py-4">
            <h3 class="text-xs font-medium tracking-wide text-dusk">
              {{ COPY.zenClock }}
            </h3>

            <div class="mt-3 flex items-center justify-between">
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
          </section>

          <!-- 阅读 -->
          <section class="px-5 py-4">
            <h3 class="text-xs font-medium tracking-wide text-dusk">
              {{ COPY.reading }}
            </h3>
            <div class="mt-3 space-y-4">
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
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
