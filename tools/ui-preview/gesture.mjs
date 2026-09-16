/**
 * 手势工具：用 CDP 的 Input 域派发**真实**鼠标事件，让浏览器自己走 native drag
 * 状态机（合成 DragEvent 绕不过这一步——它不会触发页面自带的 draggable 逻辑）。
 *
 * 配套 shot.mjs 用：shot 只管截图，本模块只管手势，二者经 CDP 共用。
 * 用法：在 --script 里 import 并调用，见工具末尾的 dragDemo。
 */
import { setTimeout as sleep } from 'node:timers/promises'

export const CDP = {
  port: Number(process.env.ZEN_CDP_PORT ?? 9222),
}

async function wsUrl(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  return list.find((t) => t.type === 'page').webSocketDebuggerUrl
}

/**
 * 借页面里已有的一条 CDP 连接不可行（无法注入），故本模块自己开一条。
 * 返回一个 sender，用完 close()。
 */
export async function connect(port = CDP.port) {
  const ws = new WebSocket(await wsUrl(port))
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
  }
  return {
    send(method, params = {}) {
      const mid = (id += 1)
      return new Promise((res, rej) => {
        pending.set(mid, { res, rej })
        ws.send(JSON.stringify({ id: mid, method, params }))
      })
    },
    close: () => ws.close(),
  }
}

/** 鼠标左键按下并按 steps 段移动；返回轨迹（供调用方在别处复用）。 */
export async function mouseDrag(send, { from, to, steps = 12, holdMs = 120 }) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  // Chromium 需要一点位移才开始拖拽（否则判为点击）
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: from.x + 8,
    y: from.y + 4,
    button: 'left',
    buttons: 1,
  })
  await sleep(holdMs)
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + (to.x - from.x) * t),
      y: Math.round(from.y + (to.y - from.y) * t),
      button: 'left',
      buttons: 1,
    })
    await sleep(30)
  }
}

export async function mouseRelease(send, at) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: at.x,
    y: at.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
}
