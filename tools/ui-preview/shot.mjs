/**
 * 无头截图台：用 CDP 驱动本机 Chrome，把 ZenReader 的真实 UI 截下来、量出来。
 *
 *   node tools/ui-preview/shot.mjs <out.png> [选项]
 *
 *   --url=<地址>       默认 http://127.0.0.1:5199/（vite dev）
 *   --w= --h=          视口尺寸（默认 1280×880）
 *   --scale=           设备像素比（默认 2；看细节用 3）
 *   --wait=            导航后等待毫秒（默认 2600；含假书库索引，实测要 5s+）
 *   --theme=           light | sepia | dark（写进 localStorage 再进驻）
 *   --expanded=<JSON>  预置侧栏展开态，例如 '{"MySQL/日志":false}'
 *   --script=<js>      截图前在页面里执行的表达式（可 import 同目录的 js）
 *   --after=           --script 之后再等多久（默认 700）
 *   --hover=<选择器>   截图前把真实指针移到该元素中心（`:hover` 只有真指针认）
 *   --clip=x,y,w,h     只截这块区域
 *   --fullpage=1       截整页
 *
 * 为什么需要它：应用是 Tauri 专属，浏览器里跑不出书库；而「侧栏别扭」这类判断
 * 一旦只靠脑补，改完还是别扭。这里借 tools/ui-preview/preview.js 把原生层换成
 * 替身，于是 UI 可截图、可量盒（见 measure.mjs）。
 *
 * 沙箱提示：无头 Chrome 要开 Mojo 具名管道，受限沙箱下会 EPERM；这条命令需要
 * 放宽文件权限执行。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { setExpansionState } from './expansionState.mjs'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const CHROME = process.env.ZEN_CHROME ?? CHROME_CANDIDATES[0]
const PORT = Number(process.env.ZEN_CDP_PORT ?? 9222)
const STUB = process.env.ZEN_STUB_URL ?? 'http://127.0.0.1:5299/preview.js'
/** 预置展开态的默认 vault slug：替身那份书库路径推出来的（见 expansionState.mjs）。 */
const DEFAULT_VAULT_SLUG = 'D_Documents_My_Knowledge'

const args = process.argv.slice(2)
const out = resolve(args[0] ?? 'tmp/shot.png')
const opt = Object.fromEntries(
  args
    .slice(1)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const width = Number(opt.w ?? 1280)
const height = Number(opt.h ?? 880)
const scale = Number(opt.scale ?? 2)
const wait = Number(opt.wait ?? 2600)
const url = opt.url ?? 'http://127.0.0.1:5199/'
// Chrome 的 profile 必须落在工程之外：vite 的 watcher 会盯上工作区里的一切，
// profile 缓存文件带锁，会让 dev server 直接 EBUSY 崩掉。
const userDir = (process.env.TEMP ?? '/tmp') + '\\zenreader-shot-profile'

mkdirSync(dirname(out), { recursive: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${scale}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function waitForDevtools() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return await r.json()
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('devtools endpoint never came up')
}

let ws
let msgId = 0
const pending = new Map()

function send(method, params = {}) {
  const id = (msgId += 1)
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

try {
  await waitForDevtools()
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
      return
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console.log(
        '[exception]',
        m.params.exceptionDetails.exception?.description ??
          m.params.exceptionDetails.text,
      )
    }
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  })

  // 原生层替身与各种预置都必须在应用模块加载前就位。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `import(${JSON.stringify(STUB)}).catch(e => console.error('preview stub failed', e))`,
  })
  if (opt.expanded) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: setExpansionState(opt.expanded, opt.vaultSlug ?? DEFAULT_VAULT_SLUG),
    })
  }
  if (opt.theme) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{const k='zenreader:settings';const v=JSON.parse(localStorage.getItem(k)||'{}');v.theme=${JSON.stringify(opt.theme)};localStorage.setItem(k,JSON.stringify(v))}catch(e){}`,
    })
  }

  await send('Page.navigate', { url })
  await sleep(wait)

  if (opt.script) {
    const r = await send('Runtime.evaluate', {
      expression: opt.script,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      console.log('[script threw]', JSON.stringify(r.exceptionDetails))
    } else {
      console.log('script →', JSON.stringify(r.result?.value ?? null))
    }
    await sleep(Number(opt.after ?? 700))
  }

  if (opt.hover) {
    // `:hover` 只认真指针（合成 pointerover 触发不了它），故走 CDP 的 Input 域。
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(opt.hover)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`,
      returnByValue: true,
    })
    const at = r.result?.value
    if (!at) {
      console.log('[hover] 找不到', opt.hover)
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
      await sleep(Number(opt.after ?? 700))
    }
  }

  const shot = { format: 'png' }
  if (opt.clip) {
    const [x, y, w, h] = opt.clip.split(',').map(Number)
    shot.clip = { x, y, width: w, height: h, scale: 1 }
  }
  shot.captureBeyondViewport = opt.fullpage === '1'
  const { data } = await send('Page.captureScreenshot', shot)
  writeFileSync(out, Buffer.from(data, 'base64'))
  console.log('wrote', out)
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  chrome.kill()
  await sleep(300)
}
