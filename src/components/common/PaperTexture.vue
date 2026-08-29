<script setup lang="ts">
import { ref } from 'vue'

import { usePaperTexture } from '@/composables/usePaperTexture'

const canvasEl = ref<HTMLCanvasElement | null>(null)
const { supported } = usePaperTexture(canvasEl)
</script>

<template>
  <!-- 宣纸颗粒：全局静态叠层（内容之上、弹层之下）。
       WebGL 不可用时整块不渲染，静默退回纯色纸底。 -->
  <canvas
    v-if="supported"
    ref="canvasEl"
    class="pointer-events-none fixed inset-0 z-40 h-full w-full"
    aria-hidden="true"
  ></canvas>
</template>
