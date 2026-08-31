<script setup lang="ts">
import type { FolderNode } from '@/types/document'

defineProps<{
  nodes: FolderNode[]
  selected: string
  depth?: number
}>()

const emit = defineEmits<{
  select: [path: string]
  menu: [e: { path: string; x: number; y: number }]
}>()

function onMenu(node: FolderNode, e: MouseEvent) {
  emit('menu', { path: node.path, x: e.clientX, y: e.clientY })
}
</script>

<template>
  <ul class="space-y-0.5">
    <!-- .stop 关键：递归树里子 `<li>` 嵌在父 `<li>` 内，右键子分组若不阻断
         冒泡，会一路触发所有祖先 `<li>` 的菜单事件，最后指向的却是父分组。 -->
    <li
      v-for="node in nodes"
      :key="node.path"
      @contextmenu.stop.prevent="onMenu(node, $event)"
    >
      <button
        class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm text-ink-soft transition-colors duration-200 hover:bg-bamboo/10 hover:text-ink"
        :class="{ 'bg-bamboo/15 font-medium text-ink': selected === node.path }"
        :style="{ paddingLeft: `${(depth ?? 0) * 14 + 10}px` }"
        @click="emit('select', node.path)"
      >
        <span class="truncate">{{ node.name }}</span>
        <span class="text-xs text-dusk">{{ node.count }}</span>
      </button>

      <FolderTree
        v-if="node.children.length"
        :nodes="node.children"
        :selected="selected"
        :depth="(depth ?? 0) + 1"
        @select="emit('select', $event)"
        @menu="emit('menu', $event)"
      />
    </li>
  </ul>
</template>
