import { computed, ref, watch } from 'vue'
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window'

import { isTauri } from '@/lib/native'
import { useSettingsStore } from '@/stores/settings'
import { COPY } from '@/lib/copy'
import { playIncenseChime, prepareChime } from '@/lib/chime'
import { hideToTray, setupTray, syncTray } from '@/lib/trayClock'
import type { ReminderAction } from '@/types/settings'

/**
 * 禅钟 — 全局专注钟（方向 B，会话级单例，仿 useFullscreen）。
 *
 * 「一炷香」模型：由用户亲手「点香」开始计时（阅读页工具栏 / 托盘皆可），
 * 香尽则轻声提醒歇息——一枚纯粹的定时器，不判定离席、不失焦暂停。
 * 香是全局的：切去书库、别的窗口、乃至把主窗缩进托盘，香都照烧，到点必响；
 * 人不在应用里时以系统通知接住。真正退出应用（托盘「退出」）香才灭。
 *
 * 计时循环由 App.vue 挂载时启动，不随任何页面卸载。
 * 燃香进度同时镜像到 Windows 任务栏与托盘悬停提示。
 */

const TICK_MS = 1000
/** 香将尽时的「燃香预提示」窗口：最后 5 分钟。 */
const PRE_HINT_MS = 5 * 60_000
/** 第一级提醒未被理会多久后升级为第二级。 */
const ESCALATE_MS = 30_000
/** 提醒停留多久后自动退场（防久悬不散）。 */
const AUTO_DISMISS_MS = 3 * 60_000

// 会话级单例状态（不持久化；应用退出即熄）。
const lit = ref(false) // 香是否点燃（用户手动）
const elapsedMs = ref(0)
const reminderOpen = ref(false)
const reminderLevel = ref<1 | 2>(1)
const reminderAction = ref<ReminderAction>('stretch')

let rotateIndex = 0

let tickTimer: ReturnType<typeof setInterval> | null = null
let escalateTimer: ReturnType<typeof setTimeout> | null = null
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null
let mounted = false

function intervalMs(): number {
  return useSettingsStore().reminder.intervalMinutes * 60_000
}

function resetIncense() {
  elapsedMs.value = 0
}

/** 熄香：手动熄或香尽自熄。 */
function extinguish() {
  lit.value = false
  resetIncense()
  dismiss()
}

/** 从已勾选的动作中轮换取一个（避免连续重复）。 */
function nextAction(): ReminderAction {
  const actions = useSettingsStore().reminder.actions
  if (actions.length === 0) return 'stretch'
  const action = actions[rotateIndex % actions.length]
  rotateIndex += 1
  return action
}

function dismiss() {
  reminderOpen.value = false
  reminderLevel.value = 1
  if (escalateTimer) clearTimeout(escalateTimer)
  if (autoDismissTimer) clearTimeout(autoDismissTimer)
  escalateTimer = null
  autoDismissTimer = null
}

/** 用户亲手点燃一炷香，开始计时。 */
function ignite() {
  const settings = useSettingsStore()
  if (!settings.reminder.enabled) return
  // 借用户手势解锁 AudioContext，香尽钟音才发得出声。
  if (settings.reminder.chime) prepareChime()
  lit.value = true
  resetIncense()
}

const ACTION_TEXT: Record<ReminderAction, string> = {
  stretch: COPY.breakStretch,
  water: COPY.breakWater,
  eyes: COPY.breakEyes,
  breathe: COPY.breakBreathe,
}

/** 系统通知：人在别的窗口/页面、应用内 toast 看不见时才发。 */
async function notifySystem(action: ReminderAction) {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import('@tauri-apps/plugin-notification')
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === 'granted'
    if (granted) {
      await sendNotification({
        title: COPY.appName,
        body: `${COPY.incenseGone}，${ACTION_TEXT[action]}`,
      })
    }
  } catch {
    /* 通知不可用——静默降级为纯应用内提醒 */
  }
}

function fire() {
  const settings = useSettingsStore()
  reminderAction.value = nextAction()
  reminderLevel.value = 1
  reminderOpen.value = true
  lit.value = false // 香尽自熄
  resetIncense()
  if (settings.reminder.chime) playIncenseChime()

  // 人在窗外（别的应用 / 主窗已缩入托盘）时，应用内 toast 看不见，系统通知接住。
  if (document.hidden) void notifySystem(reminderAction.value)

  if (escalateTimer) clearTimeout(escalateTimer)
  escalateTimer = setTimeout(() => {
    if (reminderOpen.value) reminderLevel.value = 2
  }, ESCALATE_MS)

  if (autoDismissTimer) clearTimeout(autoDismissTimer)
  autoDismissTimer = setTimeout(dismiss, AUTO_DISMISS_MS)
}

function tick() {
  const settings = useSettingsStore()
  if (!settings.reminder.enabled) {
    if (lit.value) extinguish()
    return
  }
  if (!lit.value) return

  elapsedMs.value += TICK_MS
  if (elapsedMs.value >= intervalMs()) fire()
}

/** 挂载（应用启动）：启动计时循环、立托盘、挂关窗钩子——仅此一次。
 *  注意：模块顶层不得触碰 store——本模块经 App.vue 被顶层 import，
 *  求值早于 main.ts 安装 Pinia，任何 eager 读取都会让整个应用白屏。 */
function start() {
  if (mounted || !isTauri()) return
  mounted = true
  tickTimer = setInterval(tick, TICK_MS)

  // 任务栏进度 + 托盘提示镜像（仅桌面端）：香燃则一线随行、悬停可读，香熄即撤。
  watch([lit, progress, remainingText], () => {
    getCurrentWindow()
      .setProgressBar(
        lit.value
          ? { status: ProgressBarStatus.Normal, progress: Math.round(progress.value * 100) }
          : { status: ProgressBarStatus.None },
      )
      .catch(() => {
        /* 平台不支持或无权限——静默作罢 */
      })
    void syncTray()
  })

  void setupTray({
    isLit: () => lit.value,
    tooltip: () =>
      lit.value
        ? `${COPY.appName} · ${remainingText.value}`
        : `${COPY.appName} · ${COPY.trayIdle}`,
    onToggle: () => (lit.value ? extinguish() : ignite()),
  })

  // 燃香时关窗不退出，缩入托盘续烧；退出走托盘「退出」。
  void getCurrentWindow().onCloseRequested((e) => {
    if (!lit.value) return
    e.preventDefault()
    void hideToTray()
  })
}

/** 香将尽时的预提示（香形由淡转显）。 */
const preHintActive = computed(() => {
  const s = useSettingsStore()
  if (!s.reminder.enabled || !s.reminder.preHint || !lit.value) return false
  const interval = intervalMs()
  // 预提示窗口取「5 分钟」与「香长 1/4」的较小值——香长很短时，微光不至于全程亮。
  const hint = Math.min(PRE_HINT_MS, interval / 4)
  return elapsedMs.value > 0 && elapsedMs.value >= interval - hint
})

/** 燃烧进度（0-1），供进度环等可视化使用。 */
const progress = computed(() => {
  const interval = intervalMs()
  if (interval <= 0) return 0
  return Math.min(1, elapsedMs.value / interval)
})

/** 剩余分钟文本（悬停提示 / 托盘 tooltip）。 */
const remainingText = computed(() => {
  const ms = Math.max(0, intervalMs() - elapsedMs.value)
  const min = Math.ceil(ms / 60_000)
  return `${COPY.remaining}${min}${COPY.minutes}`
})

/** 已燃分钟文本（悬停提示）。 */
const burnedText = computed(() => {
  const min = Math.ceil(elapsedMs.value / 60_000)
  return `${COPY.burned}${min}${COPY.minutes}`
})

export function useZenClock() {
  return {
    lit,
    preHintActive,
    progress,
    remainingText,
    burnedText,
    reminderOpen,
    reminderLevel,
    reminderAction,
    start,
    ignite,
    extinguish,
    dismiss,
  }
}
