<script setup lang="ts">
/**
 * 正文图片灯箱：点击文档里的图，全屏深纱放大静观。
 * 轻触任意处或 Esc 收起；图以 fade + 轻缩放入场，不抢图的戏。
 * 开启期间以捕获阶段拦下 Esc，避免阅读页把 Esc 拿去出定/关面板。
 */
import { watch } from 'vue'

const props = defineProps<{ src: string | null }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (!props.src) return
  e.stopPropagation()
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.src,
  (v) => {
    if (v) window.addEventListener('keydown', onKey, true)
    else window.removeEventListener('keydown', onKey, true)
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="src" class="img-viewer" @click="emit('close')">
        <img :src="src" class="img-viewer-img" alt="" @click.stop />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.img-viewer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 4vmin;
  background: color-mix(in srgb, var(--ink) 62%, transparent);
  backdrop-filter: blur(6px);
  cursor: zoom-out;
}
.img-viewer-img {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 6px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 35%);
  animation: img-viewer-in 360ms var(--ease-zen) both;
}
@keyframes img-viewer-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
