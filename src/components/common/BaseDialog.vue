<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import { COPY } from '@/lib/copy'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 标准头部（标题 + 关闭钮）；不传则由插槽自绘头部。 */
    title?: string
    maxWidth?: 'xs' | 'sm' | 'md'
    /** 提供后卡片限高并内部滚动（如 '85vh'）。 */
    maxHeight?: string
    /** 无标题头部的弹窗用它补充可访问名称。 */
    ariaLabel?: string
  }>(),
  { title: '', maxWidth: 'md', maxHeight: '', ariaLabel: '' },
)

const emit = defineEmits<{ close: [] }>()

const cardEl = ref<HTMLElement | null>(null)
let lastFocused: HTMLElement | null = null

const WIDTH: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // 捕获阶段截停，避免冒泡到阅读器的层级式 Esc 处理。
    e.stopPropagation()
    emit('close')
    return
  }
  // 焦点圈禁：Tab 始终留在弹窗之内。
  if (e.key !== 'Tab' || !cardEl.value) return
  const focusables = cardEl.value.querySelectorAll<HTMLElement>(
    'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === cardEl.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null
      window.addEventListener('keydown', onKeydown, true)
      await nextTick()
      cardEl.value?.focus()
    } else {
      window.removeEventListener('keydown', onKeydown, true)
      lastFocused?.focus()
      lastFocused = null
    }
  },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
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
          ref="cardEl"
          role="dialog"
          aria-modal="true"
          :aria-label="title || ariaLabel || undefined"
          tabindex="-1"
          class="w-full rounded-2xl border border-line bg-paper shadow-zen-lg outline-none"
          :class="[WIDTH[maxWidth], maxHeight ? 'overflow-y-auto' : '']"
          :style="maxHeight ? { maxHeight } : undefined"
        >
          <header
            v-if="title"
            class="flex items-center justify-between border-b border-line px-5 py-4"
          >
            <h2 class="font-serif text-lg text-ink">{{ title }}</h2>
            <button
              class="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bamboo/10 hover:text-ink"
              :title="COPY.close"
              @click="emit('close')"
            >
              <ZIcon name="close" :size="17" />
            </button>
          </header>
          <slot />
          <slot name="footer" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
