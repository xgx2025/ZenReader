import { computed, ref } from 'vue'

import { useSettingsStore } from '@/stores/settings'
import { COPY } from '@/lib/copy'
import type { ReminderAction } from '@/types/settings'

/**
 * 禅钟 — 连续专注歇息提醒（会话级单例，仿 useFullscreen）。
 *
 * 「一炷香」模型：进入阅读页后，由用户亲手「点香」开始计时（而非静默自动开始），
 * 香尽则轻声提醒歇息。小巧思在于「心流觉察」——计时只累计真正连续专注的时间：
 *   - 窗口失焦超过 2 分钟 → 判定你已离席去休息，香熄灭、需重新点燃；
 *   - 窗口仍在前台但 10 分钟零操作 → 同理熄灭。
 * 于是提醒永远不会在你「刚休息回来」时打扰你。香是会话级的，离开阅读页即熄。
 */

const TICK_MS = 1000
/** 香将尽时的「燃香预提示」窗口：最后 5 分钟。 */
const PRE_HINT_MS = 5 * 60_000
/** 第一级提醒未被理会多久后升级为第二级。 */
const ESCALATE_MS = 30_000
/** 提醒停留多久后自动退场（防久悬不散）。 */
const AUTO_DISMISS_MS = 3 * 60_000
/** 窗口失焦超过此时长 → 视为离席，香熄灭。 */
const HIDDEN_RESET_MS = 2 * 60_000
/** 前台但零操作超过此时长 → 视为离席，香熄灭。 */
const IDLE_RESET_MS = 10 * 60_000

const ACTIVITY_EVENTS: string[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
]

// 会话级单例状态（不持久化）。
const lit = ref(false) // 香是否点燃（用户手动）
const elapsedMs = ref(0)
const reminderOpen = ref(false)
const reminderLevel = ref<1 | 2>(1)
const reminderAction = ref<ReminderAction>('stretch')

// 仅被 tick 命令式读取，无需响应式；用普通变量避免 mousemove 触发无谓更新。
let lastActivityAt = Date.now()
let hiddenSince = 0
let rotateIndex = 0

let tickTimer: ReturnType<typeof setInterval> | null = null
let escalateTimer: ReturnType<typeof setTimeout> | null = null
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null
let mounted = false

function intervalMs(): number {
  return useSettingsStore().reminder.intervalMinutes * 60_000
}

function onActivity() {
  lastActivityAt = Date.now()
}

function resetIncense() {
  elapsedMs.value = 0
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
  lit.value = true
  resetIncense()
}

/** 用户手动熄香（或香尽自动熄灭），回到未点燃态。 */
function extinguish() {
  lit.value = false
  resetIncense()
  dismiss()
}

function fire() {
  reminderAction.value = nextAction()
  reminderLevel.value = 1
  reminderOpen.value = true
  lit.value = false // 香尽自熄
  resetIncense()

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

  const now = Date.now()

  // 失焦判定。
  if (document.hidden) {
    if (hiddenSince === 0) hiddenSince = now
    if (now - hiddenSince >= HIDDEN_RESET_MS) {
      extinguish()
      hiddenSince = now // 避免每 tick 重复
    }
    return
  }
  hiddenSince = 0

  // 前台但长时间零操作 → 离席。
  if (now - lastActivityAt >= IDLE_RESET_MS) {
    extinguish()
    return
  }

  elapsedMs.value += TICK_MS
  if (elapsedMs.value >= intervalMs()) fire()
}

/** 挂载（进入阅读页）：仅启动计时循环与活动监听，不自动点香。 */
function start() {
  if (mounted) return
  mounted = true
  for (const e of ACTIVITY_EVENTS) {
    window.addEventListener(e, onActivity, { passive: true, capture: true })
  }
  tickTimer = setInterval(tick, TICK_MS)
}

/** 卸载（离开阅读页）：停循环、熄香。 */
function stop() {
  if (!mounted) return
  mounted = false
  for (const e of ACTIVITY_EVENTS) {
    window.removeEventListener(e, onActivity, { capture: true })
  }
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
  extinguish()
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

/** 剩余分钟文本（悬停提示）。 */
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
    remainingText,
    burnedText,
    reminderOpen,
    reminderLevel,
    reminderAction,
    start,
    stop,
    ignite,
    extinguish,
    dismiss,
  }
}
