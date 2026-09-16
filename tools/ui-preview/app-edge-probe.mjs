/**
 * 真机边界探针：把最后一行以下的空白带（列表下方的空隙）也走一遍——那是"排到最后"
 * 唯一能落脚的地方（容器里的空白不属于任何一行）。
 *
 *   node tools/ui-preview/app-edge-probe.mjs --runs=4
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { connect, mouseDrag, mouseRelease } from './gesture.mjs'

const PORT = Number(process.env.ZEN_CDP_PORT ?? 9337)
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const exe = opt.exe ?? 'src-tauri/target/debug/zenreader.exe'
const runs = Number(opt.runs ?? 4)
const grabx = Number(opt.grabx ?? 36)

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
  await sleep(Number(opt.wait ?? 12000))

  for (let round = 1; round <= runs; round += 1) {
    const before = await evalIn(cdp, ROWS)
    const paths = before.split('|')
    const first = paths[0]

    // 落点：整个树的最后一行之下 40px —— 视觉上就是"列表末尾的空白"
    const geom = JSON.parse(
      await evalIn(
        cdp,
        `JSON.stringify((() => {
          const rows = [...document.querySelectorAll('.folder-row')]
          const a = rows.find((r) => r.dataset.folderRow === ${JSON.stringify(first)}).getBoundingClientRect()
          const z = rows[rows.length - 1].getBoundingClientRect()
          return {
            from: { x: ${grabx}, y: Math.round(a.top + a.height / 2) },
            to: { x: ${grabx}, y: Math.round(z.bottom + 40) },
            lastRow: rows[rows.length - 1].dataset.folderRow,
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
    const moved = after.split('|').indexOf(first) > 0
    if (!moved) failures += 1
    console.log(
      `第 ${round} 手：${first} 拖到末行「${geom.lastRow}」之下  提示=${hint}  ` +
        `位置=${moved ? '挪到后面了 ✅' : '没动 ❌'}`,
    )
  }
  console.log(`\n合计 ${runs} 手，丢了 ${failures} 手 ${failures === 0 ? '✅ 稳定' : '❌ 仍不稳'}`)
} finally {
  cdp?.close()
  app.kill()
  await sleep(500)
}
