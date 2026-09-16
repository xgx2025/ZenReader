/**
 * 真机"抓哪儿都能拖"探针：把同一行的**左侧（折页槽）/ 中段（名称）/ 右侧（计数·⋯）**
 * 各抓一次，看是不是每一处都能把这行拿起来。
 *
 * 背景：行内控件曾经对命中测试隐形（HTML5 拖放时代的 `pointer-events: none`），
 * 可拖区域只剩折页与名称之间那几条缝——用户看到的就是「只有长条前面一小段能拖，
 * 还没有任何提示」。改走指针事件后整行都该能抓。
 *
 *   node tools/ui-preview/app-grab-probe.mjs --runs=1
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { connect, mouseDrag, mouseRelease } from './gesture.mjs'

const PORT = Number(process.env.ZEN_CDP_PORT ?? 9338)
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const exe = opt.exe ?? 'src-tauri/target/debug/zenreader.exe'
const runs = Number(opt.runs ?? 1)

const app = spawn(exe, [], {
  stdio: 'ignore',
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: `${process.env.TEMP}\\zenreader-probe-ebwebview`,
  },
})

const ROWS = `[...document.querySelectorAll('.folder-row')].map(r => r.dataset.folderRow).join('|')`

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  return r.result.value
}

/** 把当前末行拖到首行之前——每次都会真的改变顺序，于是"没变"只可能是没抓起来。 */
async function tryGrab(cdp, zone) {
  const setup = JSON.parse(
    await evalIn(
      cdp,
      `JSON.stringify((() => {
        const rows = [...document.querySelectorAll('.folder-row')]
        const last = rows[rows.length - 1]
        const first = rows[0]
        const g = last.querySelector('.folder-line').getBoundingClientRect()
        const t = first.querySelector('.folder-line').getBoundingClientRect()
        const x =
          ${JSON.stringify(zone)} === 'left' ? Math.round(g.left + 14)
          : ${JSON.stringify(zone)} === 'mid' ? Math.round(g.left + g.width * 0.45)
          : Math.round(g.right - 14)
        const hit = document.elementFromPoint(x, Math.round(g.top + g.height / 2))
        return {
          from: { x, y: Math.round(g.top + g.height / 2) },
          to: { x, y: Math.round(t.top + 2) },
          grabbed: last.dataset.folderRow,
          target: first.dataset.folderRow,
          hit: hit ? String(hit.className || hit.tagName) : 'none',
        }
      })())`,
    ),
  )
  const before = await evalIn(cdp, ROWS)
  await mouseDrag(cdp.send, { from: setup.from, to: setup.to, steps: 12 })
  await sleep(200)
  const dragging = await evalIn(cdp, `document.body.classList.contains('folder-drag-active')`)
  await mouseRelease(cdp.send, setup.to)
  await sleep(1200)
  const after = await evalIn(cdp, ROWS)
  return { ...setup, dragging, moved: after !== before }
}

let cdp
try {
  let up = false
  for (let i = 0; i < 100 && !up; i += 1) {
    try {
      up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok
    } catch {
      /* not up */
    }
    if (!up) await sleep(300)
  }
  if (!up) throw new Error('devtools 没起来')
  cdp = await connect(PORT)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await sleep(Number(opt.wait ?? 12000))

  for (let round = 1; round <= runs; round += 1) {
    for (const zone of ['left', 'mid', 'right']) {
      const r = await tryGrab(cdp, zone)
      console.log(
        `第 ${round} 轮 ${zone.padEnd(5)} 抓 ${r.grabbed} → ${r.target} 之前  ` +
          `命中=${String(r.hit).split(' ')[0]}  拿起=${r.dragging ? '是' : '否'}  ` +
          `${r.moved ? '行序变了 ✅' : '行序没变 ❌'}`,
      )
    }
  }
} finally {
  cdp?.close()
  app.kill()
  await sleep(500)
}
