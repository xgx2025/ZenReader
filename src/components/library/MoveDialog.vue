<script setup lang="ts">
import ZIcon from '@/components/common/ZIcon.vue'
import { COPY } from '@/lib/copy'

defineProps<{ open: boolean; folders: string[]; currentPath: string }>()
const emit = defineEmits<{ select: [path: string]; close: [] }>()

function baseName(path: string): string {
  return path.split('/').pop() ?? path
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
          class="max-h-[70vh] w-full max-w-xs overflow-y-auto rounded-xl border border-line bg-paper shadow-[0_16px_48px_rgba(0,0,0,0.16)]"
        >
          <header
            class="flex items-center justify-between border-b border-line px-4 py-3"
          >
            <h2 class="font-serif text-base text-ink">{{ COPY.moveTo }}</h2>
            <button
              class="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
              @click="emit('close')"
            >
              <ZIcon name="close" :size="16" />
            </button>
          </header>

          <nav class="space-y-0.5 p-2">
            <button
              class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
              :class="{ 'bg-bamboo/15 text-ink': currentPath === '' }"
              @click="emit('select', '')"
            >
              <ZIcon name="folder" :size="15" class="shrink-0 text-sandal" />
              {{ COPY.moveToRoot }}
            </button>

            <button
              v-for="f in folders"
              :key="f"
              class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
              :class="{ 'bg-bamboo/15 text-ink': currentPath === f }"
              @click="emit('select', f)"
            >
              <ZIcon name="folder" :size="15" class="shrink-0 text-sandal" />
              <span class="min-w-0 truncate">{{ baseName(f) }}</span>
              <span class="ml-auto truncate text-xs text-dusk">{{ f }}</span>
            </button>

            <p v-if="folders.length === 0" class="px-2.5 py-2 text-xs text-dusk">
              尚无分组
            </p>
          </nav>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
