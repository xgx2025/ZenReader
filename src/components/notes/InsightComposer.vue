<script setup lang="ts">
import { ref, watch } from 'vue'

import BaseDialog from '@/components/common/BaseDialog.vue'
import { COPY } from '@/lib/copy'

const props = defineProps<{
  open: boolean
  quote: string
  initial: string
  title: string
}>()
const emit = defineEmits<{ save: [text: string]; cancel: [] }>()

const text = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) {
      text.value = props.initial
    }
  },
)

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
      <textarea
        v-model="text"
        :placeholder="COPY.notePlaceholder"
        rows="4"
        class="mt-4 w-full resize-none rounded-lg border border-line bg-paper-deep p-3 text-sm leading-relaxed text-ink outline-none placeholder:text-dusk focus:border-bamboo"
        @keydown.ctrl.enter.prevent="save"
        @keydown.meta.enter.prevent="save"
      />
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
  </BaseDialog>
</template>
