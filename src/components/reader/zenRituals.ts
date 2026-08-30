/**
 * 入定动画注册表 —— 各档风格的单一事实源。
 *
 * 「仪式组件契约」（ZenRitualInk / ZenRitualLeaf / ZenRitualIncense 均须遵守）：
 *  1. 组件自导自演全部时间线，依次 emit `stage(1|2|3)`——1 顶栏化去、
 *     2 面板隐去边距舒展、3 稳态澄明，节奏约在全程 30% / 60% / 85% 处，
 *     由 ReaderView 门控各 UI 层（语义不得更动）；
 *  2. 轻触任意处 emit `skip`，由父层收束直达稳态；
 *  3. 收势时 emit `finish`，父层卸下覆盖层；
 *  4. 时间线常量集中置顶、与样式同源（改动两处同步）；
 *  5. 颜色一律取主题变量（--ink / --paper / --sandal / --bamboo 等），
 *     亮 / 暮 / 夜三主题自动适配。
 *
 * 轻雾（mist）没有组件——它就是 ReaderView 里那口现成的短雾（puff），
 * prefers-reduced-motion 下无论选哪档都走这一路。
 */
import type { Component } from 'vue'

import type { ZenEntryStyle } from '@/types/settings'

import ZenRitualInk from './ZenRitualInk.vue'
import ZenRitualLeaf from './ZenRitualLeaf.vue'
import ZenRitualIncense from './ZenRitualIncense.vue'

import { COPY } from '@/lib/copy'

/** 有完整仪式组件的三档（随机档在其间现抽，轻雾除外）。 */
export type ZenRitualKey = Exclude<ZenEntryStyle, 'mist' | 'random'>

export interface ZenEntryOption {
  key: ZenEntryStyle
  label: string
  hint: string
}

/** 设置面板「入定动画」分段按钮的有序档位。 */
export const ZEN_ENTRY_OPTIONS: ZenEntryOption[] = [
  { key: 'ink', label: COPY.zenEntryInk, hint: COPY.zenEntryInkHint },
  { key: 'leaf', label: COPY.zenEntryLeaf, hint: COPY.zenEntryLeafHint },
  { key: 'incense', label: COPY.zenEntryIncense, hint: COPY.zenEntryIncenseHint },
  { key: 'mist', label: COPY.zenEntryMist, hint: COPY.zenEntryMistHint },
  { key: 'random', label: COPY.zenEntryRandom, hint: COPY.zenEntryRandomHint },
]

/** 三套仪式组件，ReaderView 与设置面板试播共用。 */
export const ZEN_RITUAL_COMPONENTS: Record<ZenRitualKey, Component> = {
  ink: ZenRitualInk,
  leaf: ZenRitualLeaf,
  incense: ZenRitualIncense,
}

/** 随机档现抽一个具体风格，其余原样返回（结果绝不会是 random）。 */
export function resolveZenEntry(
  style: ZenEntryStyle,
): Exclude<ZenEntryStyle, 'random'> {
  if (style !== 'random') return style
  const pool: ZenRitualKey[] = ['ink', 'leaf', 'incense']
  return pool[Math.floor(Math.random() * pool.length)]
}
