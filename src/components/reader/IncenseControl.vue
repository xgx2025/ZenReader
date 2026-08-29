<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import IncenseFigure from '@/components/reader/IncenseFigure.vue'
import { useZenClock } from '@/composables/useZenClock'
import { COPY } from '@/lib/copy'

/**
 * 香控件 -- 工具栏与禅境共用。
 *
 * 未燃：点击点香（通知父级展示「香已点燃」提示）。
 * 已燃：点击弹出迷你浮层（燃香图 + 已燃/还剩 + 熄香按钮）--
 * 熄香只出现在浮层里，消掉「单击误触白燃」的心痛。
 */
const props = withDefaults(defineProps<{ variant?: 'toolbar' | 'zen' }>(), {
  variant: 'toolbar',
})

const emit = defineEmits<{ ignite: [] }>()

const { lit, preHintActive, progress, remainingText, burnedText, ignite, extinguish } =
  useZenClock()

const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)

// 燃香图配色：未燃一柱静香极淡；燃后檀色生烟；香将尽时去浊转清。
const figureClass = computed(() => {
  if (!lit.value) return 'text-dusk opacity-40 hover:text-sandal hover:opacity-70'
  if (preHintActive.value) return 'text-sandal'
  return 'text-sandal opacity-80'
})

const title = computed(() => {
  if (!lit.value) return COPY.igniteHint
  if (preHintActive.value) return remainingText.value
  return `${burnedText.value} · ${remainingText.value}`
})

function onButtonClick() {
  if (lit.value) {
    menuOpen.value = !menuOpen.value
  } else {
    ignite()
    emit('ignite')
  }
}

function onSnuff() {
  extinguish()
  menuOpen.value = false
}

// 香熄（含香尽自熄）时随手关掉浮层。
watch(lit, (v) => {
  if (!v) menuOpen.value = false
})

function onDocMouseDown(e: MouseEvent) {
  if (menuOpen.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) menuOpen.value = false
}

watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('keydown', onKeydown, true)
  } else {
    document.removeEventListener('mousedown', onDocMouseDown, true)
    document.removeEventListener('keydown', onKeydown, true)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true)
  document.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="flex shrink-0 items-center justify-center transition-colors"
      :class="variant === 'zen' ? 'h-8 w-8' : 'h-9 w-8'"
      :title="title"
      @click="onButtonClick"
    >
      <IncenseFigure
        :progress="progress"
        :lit="lit"
        :hot="preHintActive"
        size="sm"
        class="h-8 transition-opacity duration-500"
        :class="[figureClass, variant === 'zen' ? 'w-3.5' : 'w-4']"
      />
    </button>

    <!-- 燃香进度浮层 -->
    <Transition name="fade-slide">
      <div
        v-if="menuOpen"
        class="absolute top-full z-50 mt-1.5 w-52 rounded-xl border border-line bg-paper/95 p-3.5 shadow-zen-md backdrop-blur-sm"
        :class="variant === 'zen' ? 'right-0' : 'left-0'"
      >
        <div class="flex items-center gap-4">
          <!-- 燃香图：香身随燃而短，火光悬于燃点 -->
          <IncenseFigure
            :progress="progress"
            :lit="lit"
            :hot="preHintActive"
            size="lg"
            class="h-14 w-5 text-sandal"
          />
          <div class="flex flex-col gap-1 text-xs leading-snug">
            <span class="tabular-nums text-ink-soft">{{ burnedText }}</span>
            <span class="tabular-nums text-sandal">{{ remainingText }}</span>
          </div>
        </div>

        <button
          type="button"
          class="mt-3 w-full rounded-full border border-line px-2 py-1.5 text-xs text-ink-soft transition-colors hover:border-sandal hover:text-ink"
          @click="onSnuff"
        >
          {{ COPY.snuff }}
        </button>
      </div>
    </Transition>
  </div>
</template>
