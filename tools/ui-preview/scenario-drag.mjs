/**
 * 临时：用真实的 DragEvent 走一遍「拖动排序」与「拖拽移动」，回报结果。用完即删。
 *
 * 无头环境没有真指针，故手工派发 dragstart / dragover / drop，并带上 dataTransfer
 * 替身——走的仍是组件里那套落点判定（上/下 1/4 = 排序，中间 = 移入）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function transfer() {
  const store = {}
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (k, v) => (store[k] = v),
    getData: (k) => store[k] ?? '',
    setDragImage: () => {},
  }
}

function fire(el, type, { clientY, dataTransfer } = {}) {
  const rect = el.getBoundingClientRect()
  const ev = new Event(type, { bubbles: true, cancelable: true })
  ev.clientX = rect.left + rect.width / 2
  ev.clientY = clientY ?? rect.top + rect.height / 2
  ev.dataTransfer = dataTransfer ?? transfer()
  el.dispatchEvent(ev)
  return ev
}

export default async function () {
  const rows = () => [...document.querySelectorAll('.folder-row')]
  const line = (p) => rows().find((r) => r.dataset.folderRow === p)?.querySelector('.folder-line')
  const order = () => rows().map((r) => r.dataset.folderRow)
  const out = { start: order() }

  // —— 1) 同层排序：把 test 拖到 agent 之前 ——
  const dt1 = transfer()
  fire(line('test'), 'dragstart', { dataTransfer: dt1 })
  await sleep(150)
  const agentLine = line('agent')
  const r1 = agentLine.getBoundingClientRect()
  fire(agentLine, 'dragover', { clientY: r1.top + 2, dataTransfer: dt1 }) // 上 1/4 → before
  await sleep(150)
  out.beforeIndicator = !!document.querySelector('.folder-drop-before')
  fire(agentLine, 'drop', { clientY: r1.top + 2, dataTransfer: dt1 })
  fire(line('test') ?? agentLine, 'dragend', { dataTransfer: dt1 })
  await sleep(2000)
  out.afterReorder = order()

  // —— 2) 跨层移入：把 test 拖进 MySQL（中间） ——
  const dt2 = transfer()
  fire(line('test'), 'dragstart', { dataTransfer: dt2 })
  await sleep(150)
  const mysqlLine = line('MySQL')
  const r2 = mysqlLine.getBoundingClientRect()
  fire(mysqlLine, 'dragover', { clientY: r2.top + r2.height / 2, dataTransfer: dt2 })
  await sleep(150)
  out.insideIndicator = !!document.querySelector('.folder-drop-inside')
  fire(mysqlLine, 'drop', { clientY: r2.top + r2.height / 2, dataTransfer: dt2 })
  await sleep(2500)
  out.afterMove = order()

  // —— 3) 拒绝：把 MySQL 拖进自己的子分组 ——
  const dt3 = transfer()
  fire(line('MySQL'), 'dragstart', { dataTransfer: dt3 })
  await sleep(150)
  const child = line('MySQL/日志')
  if (child) {
    const r3 = child.getBoundingClientRect()
    fire(child, 'dragover', { clientY: r3.top + r3.height / 2, dataTransfer: dt3 })
    fire(child, 'drop', { clientY: r3.top + r3.height / 2, dataTransfer: dt3 })
  }
  await sleep(1500)
  out.afterSelfNest = order()
  out.stillHasMySQL = order().includes('MySQL')

  return out
}
