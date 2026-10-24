/** Real WebView2 smoke test for opening, turning and resuming a local PDF. */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { connect } from './gesture.mjs'

const exe = resolve(process.argv.find((a) => a.startsWith('--exe='))?.slice(6) ?? 'src-tauri/target/release/zenreader.exe')
const base = mkdtempSync(join(resolve('tmp'), 'pdf-probe-'))
const vault = join(base, 'vault')
mkdirSync(vault, { recursive: true })

function makePdf() {
  const contents = [1, 2, 3].map((n) => `BT /F1 24 Tf 72 700 Td (ZenReader PDF page ${n}) Tj ET`)
  const stream = (value) => `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R /PageMode /UseOutlines >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 10 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(contents[0]),
    '<< /Type /Outlines /First 11 0 R /Last 12 0 R /Count 2 >>',
    stream(contents[1]),
    stream(contents[2]),
    '<< /Title (Start) /Parent 8 0 R /Next 12 0 R /Dest [3 0 R /Fit] >>',
    '<< /Title (Middle) /Parent 8 0 R /Prev 11 0 R /Dest [4 0 R /Fit] >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n` })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

writeFileSync(join(vault, 'PDF 探针.pdf'), makePdf())
const importSource = join(base, 'PDF 引入探针.pdf')
writeFileSync(importSource, makePdf())
const port = 9367
const app = spawn(exe, [], {
  stdio: 'ignore',
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: join(base, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
})
let cdp
async function evaluate(expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}
async function until(expression, label) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(expression)) return
    await sleep(350)
  }
  const detail = await evaluate(`fetch('zenasset://asset/PDF%20%E6%8E%A2%E9%92%88.pdf').then(async r => JSON.stringify({body:document.body.innerText.slice(0,400), errors:window.__pdfErrors, status:r.status, bytes:(await r.arrayBuffer()).byteLength})).catch(e => JSON.stringify({body:document.body.innerText.slice(0,400), errors:window.__pdfErrors, fetchError:String(e)}))`)
  throw new Error(`等待 ${label} 超时：${detail}`)
}

try {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch { /* wait */ }
    await sleep(350)
  }
  cdp = await connect(port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await until('!!window.__TAURI_INTERNALS__?.invoke', 'Tauri 桥接')
  const identifier = await evaluate("window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')")
  if (identifier !== 'com.zenreader.guideprobe') throw new Error(`拒绝在非隔离应用中运行：${identifier}`)
  await evaluate(`window.__TAURI_INTERNALS__.invoke('write_settings', { content: ${JSON.stringify(JSON.stringify({ vaultPath: vault }))} })`)
  await evaluate('location.reload()')
  await until('!!document.querySelector(\'a[href*="/pdf/"]\')', 'PDF 书库卡片')
  await evaluate('window.__pdfErrors=[]; const oldError=console.error; console.error=(...args)=>{window.__pdfErrors.push(args.map(String)); oldError(...args)}; true')
  await evaluate('document.querySelector(\'a[href*="/pdf/"]\').click()')
  await until('!!document.querySelector(\'canvas[width]:not([width="300"])\')', 'PDF 页面画布')
  await until('document.querySelectorAll(\'.pdf-text-layer span\').length > 0', 'PDF 文字层')
  await evaluate('document.querySelector(\'button[aria-pressed]\').click()')
  await until('document.body.innerText.includes("Start")', 'PDF 目录')
  const originalWidth = await evaluate('document.querySelector("canvas").getBoundingClientRect().width')
  await evaluate('document.querySelector(\'button[aria-label="放大页面"]\').click()')
  await until(`document.querySelector('canvas')?.getBoundingClientRect().width > ${originalWidth}`, 'PDF 放大')
  await evaluate('document.querySelector(\'button[aria-label="适合宽度"]\').click()')
  await evaluate('document.querySelector(\'button[aria-label="下一页"]\').click()')
  await until('document.querySelector(\'input[aria-label="页码"]\')?.value === "2"', '翻到第 2 页')
  await sleep(1000)
  await evaluate('location.reload()')
  await until('document.querySelector(\'input[aria-label="页码"]\')?.value === "2"', '续读第 2 页')
  await until('document.querySelectorAll(\'.pdf-text-layer span\').length > 0', '续读页文字层')
  for (const theme of ['light', 'sepia', 'dark']) {
    await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`)
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(base, `pdf-reader-${theme}.png`), Buffer.from(screenshot.data, 'base64'))
  }
  console.log('三套主题截图：', base)
  await evaluate("location.href = location.origin + '/import'")
  await until('!!document.querySelector(\'input[type="file"][accept*=".pdf"]\')', 'PDF 导入入口')
  const dom = await cdp.send('DOM.getDocument')
  const fileInput = await cdp.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: 'input[type="file"][accept*=".pdf"]' })
  await cdp.send('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [importSource] })
  await until('document.body.innerText.includes("已引入 1")', 'PDF 文件导入')
  await evaluate("location.href = location.origin + '/'")
  await until('document.body.innerText.includes("PDF 引入探针")', '导入后书库卡片')
  console.log('PDF 打开、文字层、目录、缩放、翻页、续读和导入均通过 ✅')
} finally {
  cdp?.close()
  app.kill()
  await sleep(500)
}
