<script setup lang="ts">
/**
 * 写觉悟的弹窗：写（落笔）/ 观（渲染静观）双态。
 * 写态是随文长高的文本框（Markdown 源码），观态用 NoteMarkdown 即时
 * 渲染当前草稿——所见即将来面板里的所得。观态里的图与图卡可点开灯箱，
 * 灯箱浮在弹窗之上，Esc 先收灯箱再退弹窗（BaseDialog 让位）。
 */
import { nextTick, ref, watch } from 'vue'

import BaseDialog from '@/components/common/BaseDialog.vue'
import ImageViewer from '@/components/reader/ImageViewer.vue'
import NoteMarkdown from '@/components/notes/NoteMarkdown.vue'
import { COPY } from '@/lib/copy'

const props = defineProps<{
  open: boolean
  quote: string
  initial: string
  title: string
}>()
const emit = defineEmits<{ save: [text: string]; cancel: [] }>()

const text = ref('')
const mode = ref<'write' | 'view'>('write')
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const viewerSrc = ref<string | null>(null)
const viewerSvg = ref<{ html: string; ratio: number } | null>(null)

watch(
  () => props.open,
  (open) => {
    if (open) {
      text.value = props.initial
      mode.value = 'write'
      void nextTick(autogrow)
    } else {
      // 灯箱随弹窗内容卸载，状态一并归零，重开不残留。
      viewerSrc.value = null
      viewerSvg.value = null
    }
  },
)

// 观态不设文本框；切回写态须重新量高、把焦点还给笔。
watch(mode, async (m) => {
  if (m !== 'write') return
  await nextTick()
  autogrow()
  textareaEl.value?.focus()
})

/** 文本框随文长高，至半屏封顶转内滚。 */
function autogrow() {
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, Math.floor(window.innerHeight * 0.5))}px`
}

function save() {
  if (!text.value.trim()) return
  emit('save', text.value.trim())
}
</script>

<template>
  <BaseDialog :open="open" :title="title" max-width="md" @close="emit('cancel')">
    <div class="p-5">
      <blockquote
        v-if="quote"
        class="border-l-2 border-bamboo pl-3 text-sm leading-relaxed text-ink-soft"
      >
        {{ quote }}
      </blockquote>
      <div class="mt-4 flex items-center justify-between">
        <span class="text-xs text-dusk">{{ COPY.noteMdHint }}</span>
        <div class="flex items-center gap-0.5 rounded-full border border-line bg-paper-deep p-0.5">
          <button
            class="rounded-full px-3 py-0.5 text-xs transition-colors"
            :class="
              mode === 'write' ? 'bg-bamboo/15 text-bamboo' : 'text-dusk hover:text-ink'
            "
            @click="mode = 'write'"
          >
            {{ COPY.noteWrite }}
          </button>
          <button
            class="rounded-full px-3 py-0.5 text-xs transition-colors"
            :class="
              mode === 'view' ? 'bg-bamboo/15 text-bamboo' : 'text-dusk hover:text-ink'
            "
            @click="mode = 'view'"
          >
            {{ COPY.notePreview }}
          </button>
        </div>
      </div>
      <textarea
        v-if="mode === 'write'"
        ref="textareaEl"
        v-model="text"
        :placeholder="COPY.notePlaceholder"
        rows="4"
        class="mt-3 max-h-[50vh] w-full resize-none overflow-y-auto rounded-lg border border-line bg-paper-deep p-3 text-sm leading-relaxed text-ink outline-none placeholder:text-dusk focus:border-bamboo"
        @input="autogrow"
        @keydown.ctrl.enter.prevent="save"
        @keydown.meta.enter.prevent="save"
      />
      <div
        v-else
        class="mt-3 max-h-[50vh] min-h-32 overflow-y-auto rounded-lg border border-line bg-paper-deep p-3"
      >
        <NoteMarkdown
          v-if="text.trim()"
          :source="text"
          @zoom-image="viewerSrc = $event"
          @zoom-figure="viewerSvg = $event"
        />
        <p v-else class="text-sm text-dusk">{{ COPY.notePlaceholder }}</p>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button
          class="rounded-full px-4 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
          @click="emit('cancel')"
        >
          {{ COPY.cancel }}
        </button>
        <button
          class="rounded-full bg-bamboo px-4 py-1.5 text-sm text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          :disabled="!text.trim()"
          @click="save"
        >
          {{ COPY.save }}
        </button>
      </div>
    </template>
    <ImageViewer
      :src="viewerSrc"
      :svg="viewerSvg"
      @close="viewerSrc = null; viewerSvg = null"
    />
  </BaseDialog>
</template>
