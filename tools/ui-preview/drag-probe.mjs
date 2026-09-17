/**
 * 拖放探针：用**真实**鼠标手势（CDP Input 域）驱动页面的原生 HTML5 拖放，把实际
 * 发生的 drag 事件与计数打出来。用来复现「拖动时一直显示禁止图标、松手没反应」
 * 这类只在真浏览器里出现的问题——合成的 DragEvent 走不到浏览器的拖放状态机，
 * 永远测不出这类病（这正是这个 bug 一度漏网的原因）。
 *
 *   node tools/ui-preview/drag-probe.mjs [--url=...] [--from=SpringBoot] [--to=agent]
 *
 * 判读：`drop` 是否为 1。为 0 而 `over` 不为 0、且 `leave` 成串，就是「落点边界
 * 抖动导致浏览器收回投放判定」——即曾经的 bug。`control` 行是页面上一对最朴素的
 * draggable/drop 对照，它若 drop=1 而应用侧 drop=0，说明问题在本应用而不在环境。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { connect, mouseDrag, mouseRelease } from './gesture.mjs'

const CHROME =
  process.env.ZEN_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.ZEN_CDP_PORT ?? 9226)
const STUB = process.env.ZEN_STUB_URL ?? 'http://127.0.0.1:5299/preview.js'
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const url = opt.url ?? 'http://127.0.0.1:5199/'
const from = opt.from ?? 'SpringBoot'
const to = opt.to ?? 'agent'

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${(process.env.TEMP ?? '/tmp')}\\zenreader-drag-probe`,
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
      if (r.ok) return
    } catch {
      /* not up */
    }
    await sleep(250)
  }
  throw new Error('devtools never came up')
}

const INSTALL = `(() => {
  window.__c = { start: 0, over: 0, drop: 0, leave: 0, end: 0 }
  window.__pd = 0
  const origPD = Event.prototype.preventDefault
  Event.prototype.preventDefault = function () {
    if (this.type === 'dragover') window.__pd++
    return origPD.call(this)
  }
  const key = { dragstart: 'start', dragover: 'over', drop: 'drop', dragleave: 'leave', dragend: 'end' }
  for (const t of Object.keys(key)) {
    document.addEventListener(t, () => { window.__c[key[t]]++ }, true)
  }
  return 'ok'
})()`

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

  // 对照组：页面上插一对最朴素的 draggable/drop
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const box = document.createElement('div')
      box.style.cssText = 'position:fixed;left:600px;top:60px;width:180px;height:420px;z-index:9999'
      box.innerHTML = '<div id="csrc" draggable="true" style="height:60px;background:#ccd">对照源</div>' +
        '<div id="cdst" style="margin-top:220px;height:120px;background:#ddc">对照目标</div>'
      document.body.appendChild(box)
      window.__ctrl = { drop: 0 }
      document.getElementById('csrc').addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'x'))
      const d = document.getElementById('cdst')
      d.addEventListener('dragover', (e) => e.preventDefault())
      d.addEventListener('drop', (e) => { e.preventDefault(); window.__ctrl.drop++ })
      return 'ok'
    })()`,
    returnByValue: true,
  })
  await cdp.send('Runtime.evaluate', { expression: INSTALL, returnByValue: true })

  const geom = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const pick = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect()
        return { x: Math.round(r.x + 100), y: Math.round(r.y + r.height / 2) }
      }
      const cr = document.getElementById('csrc').getBoundingClientRect()
      const cd = document.getElementById('cdst').getBoundingClientRect()
      return {
        from: pick('.folder-row[data-folder-row="${from}"] .folder-line'),
        to: pick('.folder-row[data-folder-row="${to}"] .folder-line'),
        cfrom: { x: Math.round(cr.x + cr.width / 2), y: Math.round(cr.y + cr.height / 2) },
        cto: { x: Math.round(cd.x + cd.width / 2), y: Math.round(cd.y + cd.height / 2) },
      }
    })())`,
    returnByValue: true,
  })
  const g = JSON.parse(geom.result.value)

  // 应用侧：连续小步移动（用户真实的手势）
  await mouseDrag(cdp.send, { from: g.from, to: g.to })
  await mouseRelease(cdp.send, g.to)
  await sleep(1500)
  const app = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({ ...window.__c, preventedDragover: window.__pd, rows: [...document.querySelectorAll('.folder-row')].map(r => r.dataset.folderRow).join(',') })`,
    returnByValue: true,
  })
  console.log('app     →', app.result.value)

  // 对照组
  await cdp.send('Runtime.evaluate', { expression: `window.__ctrl.drop = 0`, returnByValue: true })
  await mouseDrag(cdp.send, { from: g.cfrom, to: g.cto })
  await mouseRelease(cdp.send, g.cto)
  await sleep(600)
  const ctrl = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__ctrl)`,
    returnByValue: true,
  })
  console.log('control →', ctrl.result.value, '（drop=1 说明环境本身能派发 drop）')
} finally {
  cdp?.close()
  chrome.kill()
  await sleep(300)
}
