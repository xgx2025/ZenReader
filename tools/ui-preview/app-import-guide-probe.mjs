/** 真桌面端：空书库 → 引卷 → 失败不推进 → 成功入库 → 返回后教程完成。 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { connect } from './gesture.mjs'

const opt = Object.fromEntries(process.argv.slice(2).filter((x) => x.startsWith('--') && x.includes('='))
  .map((x) => [x.slice(2, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))
if (!opt.exe) throw new Error('请指定由 tauri-guide-probe.conf.json 构建的 --exe= 路径')
const exe = resolve(opt.exe)
const root = resolve('tmp')
mkdirSync(root, { recursive: true })
const base = mkdtempSync(join(root, 'guide-import-probe-'))
const vault = join(base, 'vault')
const source = join(base, '待引入.md')
const unsupported = join(base, '不支持.txt')
const sourceFolder = join(base, '整卷')
mkdirSync(vault)
mkdirSync(join(sourceFolder, '子分组'), { recursive: true })
writeFileSync(source, '# 第一篇文章\n\n来自外部文件。\n')
writeFileSync(unsupported, 'unsupported extension')
writeFileSync(join(sourceFolder, '子分组', '第二篇.md'), '# 第二篇文章\n')
writeFileSync(join(sourceFolder, '第三篇.html'), '<!doctype html><html><body><p>Third document.</p></body></html>')

async function evalIn(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  return response.result.value
}

async function waitFor(cdp, expression, label, limit = 40) {
  for (let i = 0; i < limit; i++) {
    if (await evalIn(cdp, expression)) return
    await sleep(500)
  }
  throw new Error(`等待 ${label} 超时`)
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

async function feedFile(cdp, path, selector = 'input[type="file"]:not([webkitdirectory])') {
  const { root: documentRoot } = await cdp.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector })
  if (!nodeId) throw new Error(`找不到文件输入框：${selector}`)
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [path] })
}

const port = 9381
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
  await cdp.send('DOM.enable')
  await waitFor(cdp, `!!window.__TAURI_INTERNALS__?.invoke`, 'Tauri 桥接')
  const identifier = await evalIn(cdp, `window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')`)
  if (identifier !== 'com.zenreader.guideprobe') throw new Error(`拒绝在非隔离应用中运行探针：${identifier}`)
  await evalIn(cdp, `window.__TAURI_INTERNALS__.invoke('write_settings', { content: ${JSON.stringify(JSON.stringify({ vaultPath: vault }))} })`)
  await evalIn(cdp, `location.reload()`)

  await waitFor(cdp, `document.querySelector('.guide-card')?.textContent.includes('引入第一篇文章')`, '空书库引卷指引')
  await click(cdp, '[data-guide="import-link"]')
  await waitFor(cdp, `document.querySelector('.guide-card')?.textContent.includes('先确认落点')`, '导入目标分组步骤')
  // Let the anchored card settle before the physical press/release sequence.
  await sleep(500)
  await click(cdp, '.guide-card > div:last-child button')
  await waitFor(cdp, `document.querySelector('.guide-card')?.textContent.includes('选择文章')`, '选择文章步骤')

  await feedFile(cdp, unsupported)
  await waitFor(cdp, `document.querySelector('[data-guide="import-result"]')?.textContent.includes('已略过 1')`, '不支持文件的略过结果')
  if (!await evalIn(cdp, `document.querySelector('.guide-card')?.textContent.includes('选择文章')`)) {
    throw new Error('零篇引入时教程错误推进')
  }

  await feedFile(cdp, source)
  await waitFor(cdp, `document.querySelector('[data-guide="import-result"]')?.textContent.includes('已引入 1')`, '单文件成功结果')
  await waitFor(cdp, `document.querySelector('.guide-card')?.textContent.includes('确认引卷结果')`, '结果确认步骤')
  if (!existsSync(join(vault, '待引入.md'))) throw new Error('文件未写入独立书库')

  await feedFile(cdp, sourceFolder, 'input[webkitdirectory]')
  await waitFor(cdp, `document.querySelector('[data-guide="import-result"]')?.textContent.includes('已引入 2')`, '整文件夹引入结果')
  if (!existsSync(join(vault, '整卷', '子分组', '第二篇.md')) || !existsSync(join(vault, '整卷', '第三篇.html'))) {
    throw new Error('整文件夹的目录结构未保留')
  }
  await click(cdp, '[data-guide="import-result"] a[href="/"]')
  await waitFor(cdp, `location.pathname === '/'`, '返回书库')
  await waitFor(cdp, `JSON.parse(localStorage.getItem(${JSON.stringify(`zenreader.guides.v1:${vault}`)}) || '{}').import === 'done'`, '引卷指引完成状态')
  console.log('空书库提示、文件略过不推进、单文件与整文件夹入库、返回书库后完成 ✅')
} finally {
  cdp?.close()
  app.kill()
  await sleep(700)
}
