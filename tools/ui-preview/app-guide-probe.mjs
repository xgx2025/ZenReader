/** 真桌面端：重复验证选区 → 浮栏 → 写笔记 → 指引完成。每轮使用独立临时书库。 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { connect } from './gesture.mjs'

const opt = Object.fromEntries(process.argv.slice(2).filter((x) => x.startsWith('--') && x.includes('='))
  .map((x) => [x.slice(2, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))
if (!opt.exe) throw new Error('请指定由 tauri-guide-probe.conf.json 构建的 --exe= 路径')
const exe = resolve(opt.exe)
const runs = Number(opt.runs ?? 3)
const format = opt.format ?? 'md'
if (!['md', 'html'].includes(format)) throw new Error(`不支持格式：${format}`)
const root = resolve('tmp')
mkdirSync(root, { recursive: true })

async function evalIn(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  return response.result.value
}

async function click(cdp, selector) {
  const point = await evalIn(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`)
  if (!point) throw new Error(`找不到 ${selector}`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(60)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 })
}

async function waitFor(cdp, expression, label, limit = 30) {
  for (let i = 0; i < limit; i++) {
    if (await evalIn(cdp, expression)) return
    await sleep(500)
  }
  throw new Error(`等待 ${label} 超时`)
}

async function selectText(cdp, port) {
  if (format === 'html') {
    const frameCdp = await connect(port, 'iframe')
    try {
      if (opt.debug) {
        console.log('HTML agent started:', await evalIn(frameCdp, `window.__ZEN_AGENT_STARTED__`))
        await evalIn(frameCdp, `window.__guideProbeMouseups = 0; document.addEventListener('mouseup', () => window.__guideProbeMouseups++, false); true`)
      }
      const points = await evalIn(frameCdp, `(() => {
        const node = document.querySelector('p')?.firstChild;
        if (!node || node.nodeType !== 3 || node.textContent.length < 15) return null;
        const r = document.createRange();
        r.setStart(node, 1); r.setEnd(node, 2);
        const a = r.getBoundingClientRect();
        r.setStart(node, 12); r.setEnd(node, 13);
        const b = r.getBoundingClientRect();
        return { from: { x: Math.round(a.left + 1), y: Math.round(a.top + a.height / 2) }, to: { x: Math.round(b.right - 1), y: Math.round(b.top + b.height / 2) } };
      })()`)
      if (!points) throw new Error('HTML 正文里没有可划词的段落')
      if (opt.debug) console.log('HTML selection:', points)
      const { from, to } = points
      await frameCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
      await frameCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 })
      for (let i = 1; i <= 8; i++) {
        const t = i / 8
        await frameCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t), button: 'left', buttons: 1 })
        await sleep(30)
      }
      await frameCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 })
      if (opt.debug) console.log('HTML selected text / mouseups:', await evalIn(frameCdp, `({ text: window.getSelection()?.toString(), mouseups: window.__guideProbeMouseups })`))
    } finally {
      frameCdp.close()
    }
    return
  }
  const points = await evalIn(cdp, `(() => {
    const p = document.querySelector('.zen-prose p') || document.querySelector('iframe')?.contentDocument?.querySelector('p');
    const node = p?.firstChild;
    if (!node || node.nodeType !== 3 || node.textContent.length < 15) return null;
    const r = document.createRange();
    r.setStart(node, 1); r.setEnd(node, 2);
    const a = r.getBoundingClientRect();
    r.setStart(node, 12); r.setEnd(node, 13);
    const b = r.getBoundingClientRect();
    return { from: { x: Math.round(a.left + 1), y: Math.round(a.top + a.height / 2) }, to: { x: Math.round(b.right - 1), y: Math.round(b.top + b.height / 2) } };
  })()`)
  if (!points) throw new Error('正文里没有可划词的段落')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.from })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.from, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 8; i++) {
    const t = i / 8
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(points.from.x + (points.to.x - points.from.x) * t),
      y: Math.round(points.from.y + (points.to.y - points.from.y) * t), button: 'left', buttons: 1,
    })
    await sleep(30)
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.to, button: 'left', buttons: 0, clickCount: 1 })
}

for (let round = 1; round <= runs; round++) {
  const base = mkdtempSync(join(root, 'guide-probe-'))
  const vault = join(base, 'vault')
  mkdirSync(vault, { recursive: true })
  if (format === 'html') {
    writeFileSync(join(vault, '指引探针.html'), '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:48px;font:32px Arial}p{margin:0}</style></head><body><p>Selection gesture verifies HTML notes in the real desktop reader.</p></body></html>')
  } else {
    writeFileSync(join(vault, '指引探针.md'), '# 指引探针\n\n这是一段用于真实鼠标划词验证的文字，请选择其中一段写下觉悟。\n')
  }

  const port = 9350 + round
  const app = spawn(exe, [], {
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: join(base, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  })
  let cdp
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch { /* wait */ }
      await sleep(350)
    }
    cdp = await connect(port)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await waitFor(cdp, `!!window.__TAURI_INTERNALS__?.invoke`, 'Tauri 桥接')
    const identifier = await evalIn(cdp, `window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')`)
    if (identifier !== 'com.zenreader.guideprobe') {
      throw new Error(`拒绝在非隔离应用中运行探针：${identifier}`)
    }
    await evalIn(cdp, `window.__TAURI_INTERNALS__.invoke('write_settings', { content: ${JSON.stringify(JSON.stringify({ vaultPath: vault }))} })`)
    await evalIn(cdp, `location.reload()`)
    await waitFor(cdp, `!!document.querySelector('a[href*="/read/"]')`, '独立测试书库')
    const card = await evalIn(cdp, `document.querySelector('a[href*="/read/"]')?.textContent`)
    if (!card?.includes('指引探针')) throw new Error(`拒绝测试非探针书库：${card}`)
    await click(cdp, 'a[href*="/read/"]')
    await waitFor(cdp, format === 'html' ? `!!document.querySelector('iframe')` : `!!document.querySelector('.zen-prose p')`, '阅读正文')
    if (format === 'html') {
      await waitFor(cdp, `document.querySelector('iframe')?.srcdoc?.includes('Selection gesture')`, 'HTML 内容装入阅读框')
      await sleep(800)
    }
    if (opt.debug && format === 'html') {
      console.log('CDP targets:', (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map((target) => ({ type: target.type, url: target.url })))
      console.log('frame tree:', JSON.stringify(await cdp.send('Page.getFrameTree')))
    }
    await waitFor(cdp, `document.querySelector('.guide-card')?.textContent.includes('选一段原文')`, '划词教程')
    await selectText(cdp, port)
    await waitFor(cdp, `!!document.querySelector('[data-guide="selection-toolbar"]')`, '选区浮栏')
    await waitFor(cdp, `document.querySelector('.guide-card')?.textContent.includes('写下觉悟')`, '教程第二步')
    await click(cdp, '[data-guide="selection-toolbar"] button:nth-of-type(2)')
    await waitFor(cdp, `!!document.querySelector('[data-guide="note-composer"] textarea')`, '笔记编辑框')
    await evalIn(cdp, `(() => { const el = document.querySelector('[data-guide="note-composer"] textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, '这是一次真实手势验证。'); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await sleep(200)
    const save = await evalIn(cdp, `(() => { const el = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === '存'); if (!el) return null; el.dataset.guideProbeSave = '1'; return true })()`)
    if (!save) throw new Error('找不到笔记保存按钮')
    await click(cdp, '[data-guide-probe-save="1"]')
    if (opt.debug) {
      await sleep(500)
      console.log('post-save UI:', await evalIn(cdp, `({ dialog: !!document.querySelector('[data-guide="note-composer"]'), guide: document.querySelector('.guide-card')?.textContent, toast: document.querySelector('[role="status"]')?.textContent })`))
      console.log('post-save DB:', await evalIn(cdp, `window.__TAURI_INTERNALS__.invoke('notes_list', { dir: ${JSON.stringify(vault)}, relativePath: ${JSON.stringify(`指引探针.${format}`)} }).then(notes => ({ ok: true, count: notes.length })).catch(error => ({ ok: false, error: String(error) }))`))
    }
    await waitFor(cdp, `document.querySelector('.guide-card')?.textContent.includes('以后在这里找回')`, '笔记保存后的最后一步')
    const note = await evalIn(cdp, `document.querySelector('[data-guide="notes-panel"]')?.textContent.includes('这是一次真实手势验证。')`)
    if (!note) throw new Error('笔记未出现在右侧面板')
    console.log(`${format.toUpperCase()} 第 ${round}/${runs} 轮：真鼠标选区、浮栏点击、笔记保存与指引推进 ✅`)
  } catch (error) {
    if (cdp && opt.debug) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const path = join(base, 'failure.png')
      writeFileSync(path, Buffer.from(shot.data, 'base64'))
      console.error('调试截图:', path)
    }
    throw error
  } finally {
    cdp?.close()
    app.kill()
    await sleep(700)
  }
}
