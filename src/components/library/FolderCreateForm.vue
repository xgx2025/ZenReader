<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

import { COPY } from '@/lib/copy'

defineProps<{
  parentLabel: string
  name: string
  error: string
  saving: boolean
}>()

const emit = defineEmits<{
  input: [name: string]
  submit: []
  cancel: []
}>()

const inputEl = ref<HTMLInputElement | null>(null)
onMounted(() => nextTick(() => inputEl.value?.focus()))

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('submit')
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
  }
}
</script>

<template>
  <div data-guide="folder-create" class="side-form" @keydown.stop>
    <p class="text-[11px] leading-snug text-ink-soft">{{ COPY.newFolderUnder }}{{ parentLabel }}</p>
    <input
      ref="inputEl"
      :value="name"
      :placeholder="COPY.folderName"
      :aria-label="COPY.folderName"
      :aria-invalid="!!error"
      :disabled="saving"
      class="w-full rounded-lg bg-paper-deep/60 px-2.5 py-1.5 text-sm text-ink caret-bamboo outline-none placeholder:text-dusk transition-colors focus:bg-paper-deep"
      @input="emit('input', ($event.target as HTMLInputElement).value)"
      @keydown="onKeydown"
    />
    <p v-if="error" class="text-[11px] text-sandal" role="alert">{{ error }}</p>
    <div class="flex gap-1.5">
      <button
        type="button"
        class="side-form-btn bg-bamboo text-paper hover:opacity-90 disabled:opacity-40"
        :disabled="saving"
        @click="emit('submit')"
      >{{ COPY.create }}</button>
      <button
        type="button"
        class="side-form-btn text-ink-soft hover:bg-bamboo/10 hover:text-ink"
        :disabled="saving"
        @click="emit('cancel')"
      >{{ COPY.cancel }}</button>
    </div>
  </div>
</template>
