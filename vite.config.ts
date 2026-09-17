import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // Tauri expects a fixed dev-server port and no auto-clearing of the console.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 文件工具用「临时文件 + 改名」落盘，临时目录带锁；watcher 盯上它就会
      // EBUSY 把整个 dev server 带走（实测：改一次样式就崩）。目录与其内部
      // 文件都要挡：watcher 递归下去照样会碰到那把锁。
      ignored: ['**/src-tauri/**', '**/*.tmpdir', '**/*.tmpdir/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
