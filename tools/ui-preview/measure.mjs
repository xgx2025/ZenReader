/**
 * 对齐量测台：把侧栏各栏位的真实盒模型打出来，用来验「三条对齐线」。
 *
 *   node tools/ui-preview/measure.mjs [--url=...] [--script=<js>]
 *
 * 判据（本机 w-56 = 224px 侧栏下）：
 *   书库标题 / 区带标题 / 顶层分组名的 x  → 三者相等（44）
 *   任意深度分组的 .folder-tail 右缘     → 全部相等（204）
 *   折页与书架图标的水平中心             → 相等（29）
 *
 * 沙箱提示：同 shot.mjs，需要放宽文件权限执行。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = process.env.ZEN_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.ZEN_CDP_PORT ?? 9224)
const STUB = process.env.ZEN_STUB_URL ?? 'http://127.0.0.1:5299/preview.js'
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const url = opt.url ?? 'http://127.0.0.1:5199/'

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${(process.env.TEMP ?? '/tmp')}\\zenreader-measure-profile`,
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
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return await r.json()
    } catch {
      /* not up */
    }
    await sleep(250)
  }
  throw new Error('devtools never came up')
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

const MEASURE = `(() => {
  const box = (sel, label) => {
    const el = sel.startsWith('@') ? document.querySelector(sel.slice(1)) : sel()
    if (!el) return { label, missing: true }
    const r = el.getBoundingClientRect()
    return {
      label,
      x: +r.x.toFixed(1),
      right: +r.right.toFixed(1),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
    }
  }
  const rows = [...document.querySelectorAll('.folder-row')]
  const rail = (path, sub) => {
    const r = rows.find((x) => x.dataset.folderRow === path)
    const el = r?.querySelector(sub)
    if (!el) return { label: path + ' ' + sub, missing: true }
    const b = el.getBoundingClientRect()
    return { label: path + ' ' + sub, x: +b.x.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1) }
  }
  const out = [
    box('@.side-root-icon', '书库 · 图标'),
    box('@.side-row-root .side-title', '书库 · 名称'),
    box('@.side-row-root .side-count', '书库 · 计数'),
    box('@.side-head-toggle', '分组 · 折页'),
    box('@.side-head .side-title', '分组 · 名称'),
    box('@.side-head-action', '分组 · ＋'),
  ]
  rows.forEach((r) => {
    const p = r.dataset.folderRow
    out.push(rail(p, '.folder-name > span'))
    out.push(rail(p, '.folder-tail'))
    out.push(rail(p, '.folder-chevron-btn'))
  })

  // 三条判据
  const x = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().x)
  const right = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().right)
  const tails = rows.map((r) => Math.round(r.querySelector('.folder-tail').getBoundingClientRect().right))
  out.push({
    label: '判据',
    名称左基线: [x('.side-row-root .side-title'), x('.side-head .side-title'), x('.folder-row .folder-name > span')],
    尾列右缘: Array.from(new Set(tails)),
    计数右缘: right('.side-row-root .side-count'),
  })
  return JSON.stringify(out, null, 1)
})()`

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
    }
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `import(${JSON.stringify(STUB)}).catch(e => console.error('stub failed', e))`,
  })
  if (opt.expanded) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{localStorage.setItem('zenreader.folder.expanded.D__Documents_My_Knowledge', ${JSON.stringify(opt.expanded)})}catch(e){}`,
    })
  }
  await send('Page.navigate', { url })
  await sleep(Number(opt.wait ?? 5000))

  if (opt.script) {
    const r = await send('Runtime.evaluate', {
      expression: opt.script,
      awaitPromise: true,
      returnByValue: true,
    })
    console.log(r.exceptionDetails ? '[script threw] ' + JSON.stringify(r.exceptionDetails) : String(r.result.value))
    await sleep(600)
  }

  const m = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
  console.log(m.result.value)
} finally {
  ws?.close()
  chrome.kill()
  await sleep(300)
}
