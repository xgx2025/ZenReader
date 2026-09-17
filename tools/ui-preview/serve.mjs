/**
 * 本地静态服务：把 tools/ui-preview/ 下的预览桩以固定 URL 送进浏览器。
 *
 * 为什么不用 vite 的 public/：public/ 里的东西会被原样拷进 dist/ 并随桌面端一起
 * 分发；这个桩只服务于「在浏览器里看真实 UI」，不该进产物。
 *
 *   node tools/ui-preview/serve.mjs [--port=5299]
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(
  (process.argv.find((a) => a.startsWith('--port=')) ?? '--port=5299').slice(7),
)

const FILES = {
  '/preview.js': 'preview.js',
  '/profile.json': 'profile.json',
}

createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const file = FILES[path]
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  try {
    const body = await readFile(join(here, file))
    res.writeHead(200, {
      'content-type': file.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : 'text/javascript; charset=utf-8',
      // 桩与 vite dev 不同源（5299 vs 5173/5199），而 ES 模块是 CORS 请求——
      // 少了这个头，浏览器会静默拒绝执行，页面就停在「尚未打开书库」。
      'access-control-allow-origin': '*',
      // 每次进驻都重新取，避免改完桩还吃旧缓存
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(e))
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`[ui-preview] stub on http://127.0.0.1:${port}/preview.js`)
})
