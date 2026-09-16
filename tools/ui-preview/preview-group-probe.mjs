/**
 * 预览站分组排序探针：在无头 Chrome 里对 `tools/ui-preview` 那份仿真书库做一次真实手势，
 * 把「事件计数 / 落点提示 / 行序前后」打出来。
 *
 *   node tools/ui-preview/preview-group-probe.mjs --from=Java --to=Redis --at=2
 *   node tools/ui-preview/preview-group-probe.mjs --parent=MySQL --from=MySQL/锁 --to=MySQL/日志 --at=2
 *
 * 与 `app-probe.mjs`（真机桌面端）的分工：这个只验**落点逻辑**（改完几何一眼可见，
 * 不必等打包）；「drop 会不会被浏览器收回」只有真机探针测得到——预览环境的 Chrome
 * 与 WebView2 在这一层的表现并不相同。
 *
 * `--at` 是占目标行高的十分之几（1~9）：<3 上缘、3~7 行内、>7 下缘。
 * 起止点都取行**名称**的左缘——落在折页按钮上会变成点它，不是拖它。
 *
 * 前置：`node tools/ui-preview/serve.mjs`（5299）与 `npx vite --port 5199`。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { connect, mouseDrag, mouseRelease } from './gesture.mjs'

const CHROME =
  process.env.ZEN_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.ZEN_CDP_PORT ?? 9229)
const STUB = process.env.ZEN_STUB_URL ?? 'http://127.0.0.1:5299/preview.js'
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const url = opt.url ?? 'http://127.0.0.1:5199/'
const from = opt.from ?? 'Java'
const to = opt.to ?? 'Redis'
const parent = opt.parent ?? ''
const at = Number(opt.at ?? 2) / 10

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${(process.env.TEMP ?? '/tmp')}\\zenreader-preview-probe`,
    '--window-size=1280,880',
    '--no-first-run',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function waitForDevtools() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return
    } catch {
      /* not up */
    }
    await sleep(250)
  }
  throw new Error('devtools never came up')
}

const COUNTS = `(() => {
  window.__c = { start: 0, over: 0, drop: 0, leave: 0, end: 0, prevented: 0 }
  const key = { dragstart: 'start', dragover: 'over', drop: 'drop', dragleave: 'leave', dragend: 'end' }
  for (const t of Object.keys(key)) {
    document.addEventListener(t, (e) => {
      window.__c[key[t]]++
      if (t === 'dragover') setTimeout(() => { if (e.defaultPrevented) window.__c.prevented++ }, 0)
    }, true)
  }
  return 'ok'
})()`

const ROWS = `[...document.querySelectorAll('.folder-row')].map(r => r.dataset.folderRow).join('|')`
const HINT = `document.querySelector('.folder-drop-before') ? 'before'
  : document.querySelector('.folder-drop-after') ? 'after'
  : document.querySelector('.folder-drop-inside') ? 'inside' : 'none'`

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  return r.result.value
}

/** 目标行不在（父分组收着）就点开它的折页，最多试 6 次。 */
async function ensureVisible(cdp, path) {
  for (let i = 0; i < 6; i += 1) {
    if (await evalIn(cdp, `!!document.querySelector('.folder-row[data-folder-row="${path}"]')`)) {
      return
    }
    const root = parent || path.split('/').slice(0, -1).join('/') || path
    const clicked = await evalIn(
      cdp,
      `(() => {
        const btn = document.querySelector('.folder-row[data-folder-row="${root}"] .folder-chevron-btn')
        if (!btn) return 'no-chevron'
        btn.click()
        return 'clicked'
      })()`,
    )
    if (clicked === 'no-chevron') return
    await sleep(500)
  }
}

let cdp
try {
  await waitForDevtools()
  cdp = await connect(PORT)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `import(${JSON.stringify(STUB)}).catch(() => {})`,
  })
  await cdp.send('Page.navigate', { url })
  await sleep(Number(opt.wait ?? 9000))

  const before = await evalIn(cdp, ROWS)
  if (!before) throw new Error('侧栏没有分组行——预览桩没装上？')
  console.log('before  →', before)

  await ensureVisible(cdp, to)
  await ensureVisible(cdp, from)

  const geom = JSON.parse(
    await evalIn(
      cdp,
      `JSON.stringify((() => {
        const n = (p) => document.querySelector('.folder-row[data-folder-row="' + p + '"] .folder-name').getBoundingClientRect()
        const a = n(${JSON.stringify(from)})
        const b = n(${JSON.stringify(to)})
        return {
          from: { x: Math.round(a.left + 30), y: Math.round(a.top + a.height / 2) },
          to: { x: Math.round(b.left + 30), y: Math.round(b.top + b.height * ${at}) },
        }
      })())`,
    ),
  )
  console.log('geom    →', JSON.stringify(geom))

  await evalIn(cdp, COUNTS)
  await mouseDrag(cdp.send, { from: geom.from, to: geom.to, steps: Number(opt.steps ?? 12) })
  await sleep(250)
  console.log('落点提示 →', await evalIn(cdp, HINT))
  await mouseRelease(cdp.send, geom.to)
  await sleep(1500)

  const after = await evalIn(cdp, `JSON.stringify({ counts: window.__c, rows: ${ROWS} })`)
  console.log('after   →', after)
  console.log('行序    →', JSON.parse(after).rows !== before ? '变了 ✅' : '没变')
} finally {
  cdp?.close()
  chrome.kill()
  await sleep(300)
}
