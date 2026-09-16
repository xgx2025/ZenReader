/**
 * 真机拖放探针：把**打包好的桌面端**拉起来，用 CDP 真实鼠标手势试一次分组拖动，
 * 把「事件计数 / 落点提示 / 行序前后 / 落盘结果」一并打出来。
 *
 *   # 同层排序（拖到目标行上缘 = before）
 *   node tools/ui-preview/app-probe.mjs --from=Java --to=Redis --at=2
 *
 *   # 跨层搬入（落在目标行中段 = inside）
 *   node tools/ui-preview/app-probe.mjs --from=Redis --to=MySQL --at=5
 *
 *   # 深层同层排序（先自动展开父分组）
 *   node tools/ui-preview/app-probe.mjs --parent=MySQL --from=MySQL/锁 --to=MySQL/日志 --at=2
 *
 * `--at` 是占目标行高的十分之几（1~9）：<3 上缘、3~7 行内、>7 下缘。
 * 起止点都取行**名称**的左缘——落在折页按钮上会变成点它，不是拖它。
 *
 * 为什么需要它：合成 DragEvent 走得到组件的落点逻辑，却走不到 WebView2 + wry 的
 * 原生拖放协议。预览站（Chrome）里正常、真机上不动，差别只在这一层。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'

import { connect, mouseDrag, mouseRelease } from './gesture.mjs'

const PORT = Number(process.env.ZEN_CDP_PORT ?? 9333)
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const exe = opt.exe ?? 'src-tauri/target/debug/zenreader.exe'
const from = opt.from ?? 'Java'
const to = opt.to ?? 'Redis'
const parent = opt.parent ?? ''
const at = Number(opt.at ?? 2) / 10
const wait = Number(opt.wait ?? 12000)
const arrange =
  opt.arrange ?? 'D:\\Documents\\My Knowledge\\.zenreader\\arrange.json'
const udf = opt.udf ?? `${process.env.TEMP}\\zenreader-probe-ebwebview`

const app = spawn(exe, [], {
  stdio: 'ignore',
  env: {
    ...process.env,
    // WebView2 认这两个环境变量：一个开 CDP 端口，一个另立用户目录
    // （否则会与正在运行的那个实例抢 EBWebView 的锁，起不来第二个）。
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: udf,
  },
})

const ROWS = `[...document.querySelectorAll('.folder-row')].map(r => r.dataset.folderRow).join('|')`
const COUNTS = `(() => {
  window.__c = { down: 0, move: 0, up: 0 }
  window.__c.last = { active: false, hint: 'none' }
  document.addEventListener('pointerdown', () => window.__c.down++, true)
  document.addEventListener('pointermove', () => window.__c.move++, true)
  document.addEventListener('pointerup', () => window.__c.up++, true)
  return 'ok'
})()`

/** 手势看不到中间态时用它：把 pointer 事件与拖动态一并读出来。 */
const READ_STATE = `JSON.stringify({
  counts: window.__c,
  body: document.body.className,
  hint: document.querySelector('.folder-drop-before') ? 'before'
    : document.querySelector('.folder-drop-after') ? 'after'
    : document.querySelector('.folder-drop-inside') ? 'inside' : 'none',
})`

const HINT = `document.querySelector('.folder-drop-before') ? 'before'
  : document.querySelector('.folder-drop-after') ? 'after'
  : document.querySelector('.folder-drop-inside') ? 'inside' : 'none'`

/**
 * 记下拖放事件的完整序列——排障用。`--trace=1` 才开：装上这组捕获监听器本身就会
 * 改变浏览器的拖放时序（原本必丢的 drop 会变得不丢），所以它只能用于**看**，不能
 * 当判据；判定一律用不开 trace 的裸跑。
 */
const TRACE = `(() => {
  window.__trace = []
  for (const t of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    document.addEventListener(t, (e) => {
      const el = e.target
      window.__trace.push([
        t,
        Math.round(e.clientY),
        (el && el.dataset && el.dataset.folderRow) || (el && el.className ? String(el.className).split(' ')[0] : el && el.tagName),
      ])
    }, true)
  }
  return 'ok'
})()`

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  return r.result.value
}

/** 目标行不在（父分组收着）就点开它的折页，最多试 6 次。 */
async function ensureVisible(cdp, path) {
  for (let i = 0; i < 6; i += 1) {
    const there = await evalIn(
      cdp,
      `!!document.querySelector('.folder-row[data-folder-row="${path}"]')`,
    )
    if (there) return
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
    console.log('展开    →', root)
    await sleep(900)
  }
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
  if (!up) throw new Error('devtools 没起来（WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 没被接受？）')
  cdp = await connect(PORT)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await sleep(wait)

  const before0 = await evalIn(cdp, ROWS)
  if (!before0) throw new Error('侧栏没有分组行——书库没打开？')

  await ensureVisible(cdp, to)
  await ensureVisible(cdp, from)
  // 展开动作会改行序，故"拖前"要在展开之后再取
  const before = await evalIn(cdp, ROWS)
  console.log('before  →', before)

  const geom = JSON.parse(
    await evalIn(
      cdp,
      `JSON.stringify((() => {
        const n = (p) => document.querySelector('.folder-row[data-folder-row="' + p + '"] .folder-name').getBoundingClientRect()
        const a = n(${JSON.stringify(from)})
        const b = n(${JSON.stringify(to)})
        const at = (x, y) => {
          const el = document.elementFromPoint(x, y)
          return el ? (el.className || el.tagName) : 'none'
        }
        // 起手点取"折页与名称之间的那一段行身"（默认 36px）：那里只可能是 .folder-line，
        // 而名称按钮/折页/⋯ 都是独立控件——按在它们身上是点击，不是拿起。
        const gx = Number(${JSON.stringify(opt.grabx ?? '36')})
        return {
          from: { x: gx, y: Math.round(a.top + a.height / 2) },
          to: { x: gx, y: Math.round(b.top + b.height * ${at}) },
          hitFrom: at(gx, Math.round(a.top + a.height / 2)),
          hitTo: at(gx, Math.round(b.top + b.height * ${at})),
        }
      })())`,
    ),
  )
  console.log('geom    →', JSON.stringify(geom))

  await evalIn(cdp, COUNTS)
  if (opt.trace === '1') await evalIn(cdp, TRACE)
  await mouseDrag(cdp.send, { from: geom.from, to: geom.to, steps: Number(opt.steps ?? 12) })
  await sleep(250)
  // 拖到落点、还没松手时读一次：拖动态与插入线都该在这一刻亮着
  console.log('拖拽中  →', await evalIn(cdp, READ_STATE))
  await mouseRelease(cdp.send, geom.to)
  await sleep(2000)

  const after = await evalIn(cdp, `JSON.stringify({ counts: window.__c, rows: ${ROWS} })`)
  console.log('after   →', after)
  if (opt.trace === '1') console.log('trace   →', await evalIn(cdp, `JSON.stringify(window.__trace)`))

  const changed = JSON.parse(after).rows !== before
  console.log('行序    →', changed ? '变了 ✅' : '没变（可能是 no-op 落点：拖到自己相邻的位置）')

  try {
    const raw = JSON.parse(await readFile(arrange, 'utf8'))
    console.log('落盘    → folderOrder', JSON.stringify(raw.folderOrder))
  } catch (e) {
    console.log('落盘    → 读不到', String(e))
  }
} finally {
  cdp?.close()
  app.kill()
  await sleep(500)
}
