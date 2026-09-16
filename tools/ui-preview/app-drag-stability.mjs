/**
 * 真机稳定性探针：同一手势连做 N 次，每次都换一对**真正会改变顺序**的分组，
 * 报「落点提示是否亮起 / 行序是否变了」。
 *
 * 为什么不能只跑一次：HTML5 拖放时代（`doc/sidebar-ux.md` 第六轮）同一手势的 drop
 * 会在 0/1 之间跳，单次成功说明不了任何事。改成指针事件后，这个脚本就是判据。
 *
 *   node tools/ui-preview/app-drag-stability.mjs --runs=5
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { connect, mouseDrag, mouseRelease } from './gesture.mjs'

const PORT = Number(process.env.ZEN_CDP_PORT ?? 9336)
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const exe = opt.exe ?? 'src-tauri/target/debug/zenreader.exe'
const runs = Number(opt.runs ?? 5)
const parent = opt.parent ?? 'MySQL'
const grabx = Number(opt.grabx ?? 36)
const wait = Number(opt.wait ?? 12000)

const app = spawn(exe, [], {
  stdio: 'ignore',
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: `${process.env.TEMP}\\zenreader-probe-ebwebview`,
  },
})

const ROWS = `[...document.querySelectorAll('.folder-row')].map(r => r.dataset.folderRow).join('|')`
const HINT = `document.querySelector('.folder-drop-before') ? 'before'
  : document.querySelector('.folder-drop-after') ? 'after'
  : document.querySelector('.folder-drop-inside') ? 'inside' : 'none'`

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  return r.result.value
}

/** 把某个父分组展开（点它的折页），最多等若干拍。 */
async function ensureChild(cdp, path) {
  for (let i = 0; i < 6; i += 1) {
    if (await evalIn(cdp, `!!document.querySelector('.folder-row[data-folder-row="${path}"]')`)) return
    await evalIn(
      cdp,
      `document.querySelector('.folder-row[data-folder-row="${parent}"] .folder-chevron-btn')?.click()`,
    )
    await sleep(700)
  }
}

let cdp
let failures = 0
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
  await sleep(wait)
  await ensureChild(cdp, `${parent}/日志`)

  for (let round = 1; round <= runs; round += 1) {
    const before = await evalIn(cdp, ROWS)
    // 每次都把**当前行序里的最后一行**拖到第一行之前：无论上一次结果如何，
    // 这一手一定改变顺序（不是 no-op），于是"没变"只能解释为手势丢了。
    const paths = before.split('|')
    const last = paths[paths.length - 1]
    const first = paths[0]

    const geom = JSON.parse(
      await evalIn(
        cdp,
        `JSON.stringify((() => {
          const n = (p) => document.querySelector('.folder-row[data-folder-row="' + p + '"] .folder-name').getBoundingClientRect()
          const a = n(${JSON.stringify(last)})
          const b = n(${JSON.stringify(first)})
          return {
            from: { x: ${grabx}, y: Math.round(a.top + a.height / 2) },
            to: { x: ${grabx}, y: Math.round(b.top + 2) },
          }
        })())`,
      ),
    )

    await mouseDrag(cdp.send, { from: geom.from, to: geom.to, steps: 12 })
    await sleep(200)
    const hint = await evalIn(cdp, HINT)
    await mouseRelease(cdp.send, geom.to)
    await sleep(1200)

    const after = await evalIn(cdp, ROWS)
    const changed = after !== before
    if (!changed) failures += 1
    console.log(
      `第 ${round} 手：${last} → ${first} 之前  提示=${hint}  行序=${changed ? '变了 ✅' : '没变 ❌'}`,
    )
  }
  console.log(`\n合计 ${runs} 手，丢了 ${failures} 手 ${failures === 0 ? '✅ 稳定' : '❌ 仍不稳'}`)
} finally {
  cdp?.close()
  app.kill()
  await sleep(500)
}
