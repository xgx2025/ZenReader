<script setup lang="ts">
import { computed } from 'vue'

export type IconName =
  | 'back'
  | 'search'
  | 'bookmark'
  | 'import'
  | 'folder'
  | 'note'
  | 'edit'
  | 'delete'
  | 'settings'
  | 'zen'
  | 'toc'
  | 'close'
  | 'plus'
  | 'minus'
  | 'sun'
  | 'sunset'
  | 'moon'
  | 'refresh'
  | 'expand'
  | 'shrink'
  | 'more'
  | 'bell'
  | 'incense'
  | 'droplet'
  | 'eye'
  | 'breath'
  | 'figure'
  | 'keyboard'
  | 'chevron-down'
  | 'library'

const props = withDefaults(
  defineProps<{ name: IconName; size?: number; strokeWidth?: number }>(),
  { size: 18, strokeWidth: 1.25 },
)

// Thin, hand-drawn-feel stroke icons (no fill).
const ICONS: Record<IconName, string> = {
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bookmark:
    '<path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"/>',
  import:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6"/><path d="m9 15 3 3 3-3"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  note:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  edit:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  delete:
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  settings:
    '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
  zen: '<circle cx="12" cy="12" r="8"/><path d="M12 12h.01"/>',
  toc: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  sunset:
    '<path d="M12 9V3"/><path d="m5 6.5 1.5 1.5"/><path d="m19 6.5-1.5 1.5"/><path d="M3 15h2"/><path d="M19 15h2"/><path d="M7 15a5 5 0 0 1 10 0"/><path d="M2 19h20"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  shrink: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  incense: '<path d="M12 20V8"/><path d="M12 8c.6-.9.6-1.8 0-2.6"/><path d="M9 20h6"/>',
  droplet: '<path d="M12 4C12 4 7 10 7 14a5 5 0 0 0 10 0c0-4-5-10-5-10z"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  breath: '<path d="M12.5 6.5A2.2 2.2 0 1 1 10.5 10H3"/><path d="M12.5 14.5A2.2 2.2 0 1 0 10.5 18.5H3"/>',
  figure: '<circle cx="12" cy="5" r="2"/><path d="M12 9v11"/><path d="M12 12l-4 2.5"/><path d="M12 12l4 2.5"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01"/><path d="M10 9h.01"/><path d="M14 9h.01"/><path d="M18 9h.01"/><path d="M6 13h.01"/><path d="M10 13h.01"/><path d="M14 13h.01"/><path d="M18 13h.01"/><path d="M8 16h8"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  // 实底书架（书库根行专用）：1024 视箱的填充图形，逐 path 覆盖
  // svg 级的 fill=none/stroke 默认，视箱见 ICON_VIEWBOX。
  library:
    '<path fill="currentColor" stroke="none" d="M321.21 73.7h-181a18.53 18.53 0 0 0-18.52 18.53v859.66a18.53 18.53 0 0 0 18.52 18.53h181a18.53 18.53 0 0 0 18.53-18.53V92.23a18.53 18.53 0 0 0-18.53-18.53z m-90.5 734a46.5 46.5 0 1 1 46.49-46.5 46.5 46.5 0 0 1-46.49 46.54z m69.4-487.7H161.3v-23.35h138.81z m0-104.63H161.3V192h138.81z m288.5-142.69h-181a18.53 18.53 0 0 0-18.53 18.53v859.66a18.53 18.53 0 0 0 18.53 18.53h181a18.53 18.53 0 0 0 18.53-18.53V91.21a18.53 18.53 0 0 0-18.53-18.53z m-90.5 734a46.5 46.5 0 1 1 46.5-46.5 46.5 46.5 0 0 1-46.5 46.54zM567.52 319H428.7v-23.38h138.82z m0-104.62H428.7V191h138.82z"/><path fill="currentColor" stroke="none" d="M796.15 53.91L618.32 87.64a18.51 18.51 0 0 0-14.75 21.65L763.75 953.9a18.53 18.53 0 0 0 21.65 14.75l177.84-33.73A18.52 18.52 0 0 0 978 913.27L817.81 68.66a18.53 18.53 0 0 0-21.66-14.75zM844 792a46.49 46.49 0 1 1 37-54.34A46.5 46.5 0 0 1 844 792z m-22.68-492.19l-136.39 25.87-4.35-22.93L817 276.88zM801.82 197l-136.38 25.89-4.35-22.89 136.38-25.87z"/>',
}

/** 个别图形用非 24 视箱（如实底书架来自 1024 图集）。 */
const ICON_VIEWBOX: Partial<Record<IconName, string>> = {
  library: '0 0 1024 1024',
}

const path = computed(() => ICONS[props.name] ?? '')
const viewBox = computed(() => ICON_VIEWBOX[props.name] ?? '0 0 24 24')
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="viewBox"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="path"
  />
</template>
