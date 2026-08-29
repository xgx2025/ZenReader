<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ open: boolean; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()

const menuEl = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    // Place at the pointer first, then clamp once the size is known.
    pos.value = { x: props.x, y: props.y }
    await nextTick()
    const el = menuEl.value
    if (!el) return
    const pad = 8
    const { width, height } = el.getBoundingClientRect()
    pos.value = {
      x: Math.max(pad, Math.min(props.x, window.innerWidth - width - pad)),
      y: Math.max(pad, Math.min(props.y, window.innerHeight - height - pad)),
    }
  },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50"
        @click.self="emit('close')"
        @contextmenu.prevent.self="emit('close')"
      >
        <div
          ref="menuEl"
          class="absolute min-w-40 rounded-lg border border-line bg-paper p-1 shadow-zen-md"
          :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
          role="menu"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
