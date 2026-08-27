<script setup lang="ts">
import type { FolderNode } from '@/types/document'

defineProps<{
  nodes: FolderNode[]
  selected: string
  depth?: number
}>()

const emit = defineEmits<{ select: [path: string] }>()
</script>

<template>
  <ul class="space-y-0.5">
    <li v-for="node in nodes" :key="node.path">
      <button
        class="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm text-ink-soft transition-colors duration-200 hover:bg-bamboo/10"
        :class="{ 'bg-bamboo/15 text-ink': selected === node.path }"
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
      />
    </li>
  </ul>
</template>
