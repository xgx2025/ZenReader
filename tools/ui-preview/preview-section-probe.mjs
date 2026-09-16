/**
 * 区带「分组」那两条动作在**真鼠标**下的语义（第十轮）。
 *
 *   node tools/ui-preview/preview-section-probe.mjs [--url=...]
 *
 * 为什么另开一条：`scenario-section-collapse.mjs` 用 `el.click()` 与直接调状态，
 * 绕过了整条指针序列——AGENTS.md 里「分组点不开」的假绿就是这么来的。这里走 CDP
 * `Input` 域的真鼠标，并且**每一条都跑两轮**。
 *
 * 判据：
 *   1. 左键点标签 / 点空白 → 什么都不发生（标签不是开关了）
 *   2. 右键点区带标题 → 菜单出现，且正好是「收起全部分组 / 展开全部分组」两条
 *   3. 点「收起全部分组」→ 行数 → 0；菜单自己关掉
 *   4. 右键再点「展开全部分组」→ 行数复原；已处于目标态的那一条是 disabled
 *   5. Alt+左键点标签 → 直接收起（1 次），再 Alt+点 → 复原
 *
 * 沙箱提示：无头 Chrome 要开 Mojo 具名管道，受限沙箱下会 EPERM。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { CLEAR_EXPANSION_STATE } from './expansionState.mjs'

const CHROME = process.env.ZEN_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.ZEN_CDP_PORT ?? 9222)
const STUB = process.env.ZEN_STUB_URL ?? 'http://127.0.0.1:5299/preview.js'
const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)
const url = opt.url ?? 'http://127.0.0.1:5199/'

/** CDP 修饰键位：Alt = 1，Ctrl = 2，Meta = 4，Shift = 8。 */
const ALT = 1

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${(process.env.TEMP ?? '/tmp')}\\zenreader-section-probe-profile`,
    '--window-size=900,600',
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
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
    ?.value

async function mouse(type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: extra.button ?? 'left',
    buttons: type === 'mouseReleased' ? 0 : extra.buttons ?? 1,
    clickCount: 1,
    modifiers: extra.modifiers ?? 0,
  })
}

/** 真鼠标一次完整点击（可指定按钮与修饰键）。 */
async function clickAt(x, y, { button = 'left', modifiers = 0 } = {}) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers })
  await sleep(40)
  await mouse('mousePressed', x, y, { button, modifiers })
  await sleep(40)
  await mouse('mouseReleased', x, y, { button, modifiers })
  // 菜单的离场动画（fade）还在树上，读状态要等它走完——否则会把「已关」读成「还开着」。
  await sleep(600)
}

/** 目标元素上的某个相对位置（fx / fy 是宽高的比例）。选择器可写成 `sel@i` 取第 i 个。 */
async function pointOn(selector, fx = 0.5, fy = 0.5) {
  const [sel, idx] = selector.split('@')
  return evalJs(`(() => {
    const list = [...document.querySelectorAll(${JSON.stringify(sel)})]
    const el = ${idx === undefined ? 'list[0]' : `list[${Number(idx)}]`}
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width * ${fx}), y: Math.round(r.top + r.height * ${fy}) }
  })()`)
}

const state = async () =>
  JSON.parse(
    await evalJs(`JSON.stringify({
    rows: document.querySelectorAll('.folder-row').length,
    menuOpen: !!document.querySelector('[role="menu"]'),
    menuItems: [...document.querySelectorAll('[role="menu"] button')].map((b) => ({
      text: b.textContent.trim(),
      disabled: b.disabled,
    })),
    // 第十轮撤掉的东西：这一行上不该再有「整行开关」或它的状态折页
    legacyRowButton: !!document.querySelector('.side-head-btn'),
    legacyCaret: !!document.querySelector('.side-head-caret'),
  })`),
  )

const results = []
const record = (name, round, before, after, pass) =>
  results.push({ 验什么: name, 轮次: round, 点前: before, 点后: after, 判据: pass ? 'PASS' : 'FAIL' })

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
  // 展开态是持久化的：上一轮探针若把「全部分组」收着退出，下一轮开局就是 0 行。
  // 判据要的是「从全开出发」，故每次先按**前缀**清掉展开记录（缺键＝展开）——
  // 不拼完整键：slug 规则是应用的实现细节，替身换 vaultPath 时拼出来的键会悄悄对不上。
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CLEAR_EXPANSION_STATE })
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `import(${JSON.stringify(STUB)}).catch(e => console.error('stub failed', e))`,
  })
  await send('Page.navigate', { url })
  await sleep(Number(opt.wait ?? 9000))

  const openRows = (await state()).rows
  if (!openRows) {
    console.log('侧栏没有分组行：确认书库桩是否加载（stub 未就绪时页面停在「尚未打开书库」）')
    process.exit(0)
  }

  // 0. 第十轮撤掉的东西不该回来：区带标题上不再有整行开关，也没有它的状态折页
  {
    const s = await state()
    record('区带标题上没有残留的整行开关', 1, '—', '—', !s.legacyRowButton && !s.legacyCaret)
  }

  // 1. 左键点标签 / 点空白：不该有任何变化
  for (let round = 1; round <= 2; round += 1) {
    for (const [name, fx] of [
      ['左键点标签', 0.24],
      ['左键点行尾空白', 0.62],
    ]) {
      const before = await state()
      const at = await pointOn('.side-head', fx)
      await clickAt(at.x, at.y)
      const after = await state()
      record(
        name,
        round,
        before.rows,
        after.rows,
        after.rows === before.rows && !after.menuOpen,
      )
    }
  }

  // 2–4. 右键唤菜单 → 收起全部分组 → 再右键 → 展开全部分组
  for (let round = 1; round <= 2; round += 1) {
    const before = await state()
    const at = await pointOn('.side-head', 0.3)
    await clickAt(at.x, at.y, { button: 'right' })
    const opened = await state()
    const items = opened.menuItems.map((m) => m.text)
    record(
      '右键唤出本区菜单（两条动作）',
      round,
      before.rows,
      items,
      opened.menuOpen && items.length === 2 && items[0].includes('收起') && items[1].includes('展开'),
    )

    // 菜单里第一项：收起全部分组
    const collapseAt = await pointOn('[role="menu"] button', 0.5, 0.3)
    if (!collapseAt) {
      record('点「收起全部分组」', round, opened.rows, '找不到菜单项', false)
      const dbg = await evalJs(`(() => {
        const m = document.querySelector('[role="menu"]')
        return JSON.stringify({
          exists: !!m,
          html: m ? m.outerHTML.slice(0, 400) : null,
          overlays: [...document.querySelectorAll('.fixed.inset-0')].length,
        })
      })()`)
      results.push({ 诊断: dbg })
      console.log(JSON.stringify(results, null, 1))
      process.exit(0)
    }
    await clickAt(collapseAt.x, collapseAt.y)
    const collapsed = await state()
    record('点「收起全部分组」', round, opened.rows, collapsed.rows, collapsed.rows === 0 && !collapsed.menuOpen)

    // 再右键：此时应只剩「展开全部分组」可点
    const at2 = await pointOn('.side-head', 0.3)
    await clickAt(at2.x, at2.y, { button: 'right' })
    const reopened = await state()
    const expandAt = await pointOn('[role="menu"] button@1', 0.5, 0.5)
    await clickAt(expandAt.x, expandAt.y)
    const expanded = await state()
    record(
      '点「展开全部分组」',
      round,
      reopened.menuItems.map((m) => (m.disabled ? '−' : '+') + m.text).join(' | '),
      expanded.rows,
      expanded.rows === before.rows,
    )
  }

  // 5. Alt+左键点标签：不经菜单直接折叠 / 展开
  for (let round = 1; round <= 2; round += 1) {
    const before = await state()
    const at = await pointOn('.side-head', 0.2)
    await clickAt(at.x, at.y, { modifiers: ALT })
    const folded = await state()
    await clickAt(at.x, at.y, { modifiers: ALT })
    const restored = await state()
    record(
      'Alt+左键点标签',
      round,
      before.rows,
      { 折叠后: folded.rows, 再点后: restored.rows },
      folded.rows === 0 && restored.rows === before.rows && !folded.menuOpen,
    )
  }

  console.log(JSON.stringify(results, null, 1))
} finally {
  ws?.close()
  chrome.kill()
  await sleep(300)
}
