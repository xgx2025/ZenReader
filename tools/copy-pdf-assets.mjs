/** Copy only the PDF.js runtime data needed for local, offline PDF rendering. */
import { mkdir, readdir, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const packageRoot = resolve('node_modules/pdfjs-dist')
const outputRoot = resolve('public/pdfjs-assets')
const groups = {
  cmaps: (name) => name.endsWith('.bcmap') || name.startsWith('LICENSE'),
  standard_fonts: (name) => /\.(?:pfb|ttf)$/i.test(name) || name.startsWith('LICENSE'),
  wasm: (name) => /^(?:jbig2|openjpeg|qcms_bg)\.wasm$/.test(name) || name.startsWith('LICENSE'),
}

await mkdir(outputRoot, { recursive: true })
await copyFile(join(packageRoot, 'LICENSE'), join(outputRoot, 'LICENSE'))

for (const [group, include] of Object.entries(groups)) {
  const source = join(packageRoot, group)
  const destination = join(outputRoot, group)
  await mkdir(destination, { recursive: true })
  for (const name of await readdir(source)) {
    if (include(name)) await copyFile(join(source, name), join(destination, name))
  }
}
