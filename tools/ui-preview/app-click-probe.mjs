/**
 * 真机"折页还点得开吗"探针：用真实鼠标做**一次纯点击**（按下即抬起、不移动），
 * 看分组的开合有没有变。
 *
 * 为什么单独立一个：拖动那套手势容易把点击吃掉——在 `pointerdown` 就捕获指针，
 * 会让 `pointerup` 落到整行上、click 于是不再派发给折页（用户看到的就是"分组点不开了"）。
 * 这类回归只有真实鼠标 + 真实 click 语义才测得准。
 *
 *   node tools/ui-preview/app-click-probe.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { connect } from './gesture.mjs'

const PORT = Number(process.env.ZEN_CDP_PORT ?? 9339)
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const exe = opt.exe ?? 'src-tauri/target/debug/zenreader.exe'

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

/** 一次真实点击：按下 → 抬起（同一坐标，不移动）。 */
async function click(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
  })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
  })
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

  // 挑第一个"有子分组"的行来点（书库可能还在索引，等它长出来）
  let target = null
  for (let i = 0; i < 40 && !target; i += 1) {
    target = JSON.parse(
      await evalIn(
        cdp,
        `JSON.stringify((() => {
          const row = [...document.querySelectorAll('.folder-row')]
            .find((r) => r.querySelector('.folder-chevron-btn'))
          if (!row) return null
          const b = row.querySelector('.folder-chevron-btn').getBoundingClientRect()
          return {
            path: row.dataset.folderRow,
            x: Math.round(b.left + b.width / 2),
            y: Math.round(b.top + b.height / 2),
          }
        })())`,
      ),
    )
    if (!target) await sleep(500)
  }
  if (!target) throw new Error('侧栏里没有可开合的分组')

  for (const round of [1, 2]) {
    const before = await evalIn(cdp, ROWS)
    await click(cdp, target.x, target.y)
    await sleep(700)
    const after = await evalIn(cdp, ROWS)
    console.log(
      `第 ${round} 次点「${target.path}」的折页：行数 ${before.split('|').length} → ` +
        `${after.split('|').length}  ${before !== after ? '变了 ✅' : '没变 ❌（点不开了）'}`,
    )
  }
} finally {
  cdp?.close()
  app.kill()
  await sleep(500)
}
