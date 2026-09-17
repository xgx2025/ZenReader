import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

// 原生事件通道只服务「从系统拖文件进来」，与分组拖动无关；接上真件只会让拆卸阶段
// 冒出无关的 unhandled rejection。这里换成哑件，测的还是本页自己的那套逻辑。
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}))

import LibraryView from './LibraryView.vue'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import router from '@/router'

/**
 * 侧栏分组拖动的**端到端**契约：真 DOM + 真事件，走完
 * FolderTree（落点判定）→ LibraryView（意图组装）→ store（folderOrder）→ buildFolderTree（重排）。
 *
 * 为什么要有这一层：`FolderTree.test.ts` 只验组件自己的 emit，`folderTree.test.ts` 只验
 * `mergeFolderOrder` 的纯算法——**中间那段接线**（落点模式 → 目标父级 → 传给 store 的
 * 完整显示序）谁都没验。它断过一次的代价就是「拖了半天，序纹丝不动」。
 *
 * 其中一个用例还原的是 2026-09-16 真机上撞到的几何边界（见 `resolveDropFromPoint` 的
 * 注释）：行高 32 + 行距 1，指针压在目标行下缘**之下**几像素时，落点必须仍归到那一行
 * ——否则既没有插入线、松手也不改序。
 */

/** 仿真书库：顶层若干分组 + 一个带子分组的分组（子行会插在父行之后）。 */
const FOLDERS = ['agent', 'Java', 'MySQL', 'MySQL/日志', 'Redis', 'SpringBoot', 'test']

/** 目录表是**可变**的：跨层拖动真的走 rename_dir，替身得跟着改，才验得到搬家。 */
let dirs = [...FOLDERS]
/** 替身收到的原生命令流水（断言用）。 */
const commands: Array<{ cmd: string; args: Record<string, unknown> }> = []

function listing() {
  return {
    files: dirs
      .filter((f) => !f.includes('/'))
      .map((f, i) => ({
        name: `${f} 卷.md`,
        path: `D:\\vault\\${f}\\${f} 卷.md`,
        relativePath: `${f}/${f} 卷.md`,
        mtime: 1000 - i,
      })),
    dirs,
  }
}

/** 原生层替身：只答本页初始化真正会问的那几条命令。 */
function installNativeStub() {
  commands.length = 0
  // isTauri() 只看 globalThis.isTauri（不是 __TAURI_INTERNALS__）——少了这句，
  // settings 会走 localStorage 分支、vaultPath 停在空中，整棵树根本长不出来。
  ;(window as unknown as { isTauri: boolean }).isTauri = true
  ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    transformCallback: (cb: unknown) => {
      const id = Math.floor(Math.random() * 1e9)
      ;(window as unknown as Record<string, unknown>)[`_${id}`] = cb
      return id
    },
    invoke: (cmd: string, args: Record<string, unknown>) => {
      commands.push({ cmd, args })
      switch (cmd) {
        case 'read_settings':
          return Promise.resolve(JSON.stringify({ vaultPath: 'D:\\vault' }))
        case 'read_vault':
          return Promise.resolve(listing())
        case 'read_file':
          // 排布文件首启不存在 → 调用方按「无自定义序」处理
          if (String(args?.path ?? '').endsWith('arrange.json')) {
            return Promise.reject(new Error('not found'))
          }
          return Promise.resolve('# 标题\n\n正文。\n')
        case 'rename_dir': {
          const from = String(args?.from ?? '')
          const to = String(args?.to ?? '')
          dirs = dirs.map((d) =>
            d === from ? to : d.startsWith(`${from}/`) ? to + d.slice(from.length) : d,
          )
          return Promise.resolve(null)
        }
        default:
          return Promise.resolve(null)
      }
    },
  }
}

let app: App | null = null
let host: HTMLElement | null = null

/** 行高 32、行距 1：与 motion.css 的 `.folder-line + .folder-line` 同源。 */
const ROW_H = 32
const ROW_GAP = 1
const FIRST_TOP = 100

function rowTop(index: number): number {
  return FIRST_TOP + index * (ROW_H + ROW_GAP)
}

/** jsdom 的盒模型恒为 0：按生产行距钉住每一行的 top/bottom，落点算法才跑得起来。 */
function stubRowRects() {
  const els = [...(host?.querySelectorAll<HTMLElement>('.folder-row') ?? [])]
  els.forEach((el, i) => {
    const top = rowTop(i)
    el.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + ROW_H,
        height: ROW_H,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: top,
      }) as DOMRect
  })
}

function rowPaths(): string[] {
  return [...(host?.querySelectorAll<HTMLElement>('.folder-row') ?? [])].map(
    (el) => el.dataset.folderRow ?? '',
  )
}

function lineOf(path: string): HTMLElement {
  const el = host?.querySelector<HTMLElement>(`[data-folder-row="${path}"] .folder-line`)
  if (!el) throw new Error(`row not found: ${path}`)
  return el
}

/**
 * 一次完整拖动手势（**指针事件**）：按下 → 越过阈值 → 移到落点 → 松手。
 *
 * 与真机的差别只有"没有真指针"：`pointerdown` 由行自己派发并冒泡，
 * `pointermove`/`pointerup` 由 window 收（与组件里挂的监听同源）。
 */
async function dragTo(
  from: string,
  to: string,
  clientYOf: (top: number, index: number) => number,
  grab: 'line' | 'name' | 'chevron' = 'line',
) {
  const paths = rowPaths()
  const fromIndex = paths.indexOf(from)
  const toIndex = paths.indexOf(to)
  if (fromIndex < 0 || toIndex < 0) throw new Error(`row missing: ${from} / ${to}`)
  const clientY = clientYOf(rowTop(toIndex), toIndex)
  const startY = rowTop(fromIndex) + ROW_H / 2

  pointer(grabPoint(from, grab), 'pointerdown', startY)
  await nextTick()
  // 第一小步只为越过阈值（5px）——真机上"拿起"本来就发生在一两像素之后
  pointer(window, 'pointermove', startY + 8)
  pointer(window, 'pointermove', clientY)
  await nextTick()
  pointer(window, 'pointerup', clientY)
}

/**
 * 抓哪儿。行身、折页、名称按钮都能把这行拿起来——**整行可拖**是这一版的契约：
 * 曾经行内控件对命中测试隐形，可拖区域只剩"折页与名称之间那条缝"，用户看到的
 * 就是「只有前面一小段能拖，还没有任何提示」。
 */
function grabPoint(path: string, grab: 'line' | 'name' | 'chevron'): HTMLElement {
  const line = lineOf(path)
  if (grab === 'line') return line
  if (grab === 'chevron') {
    const chevron = line.querySelector<HTMLElement>('.folder-chevron-btn')
    if (!chevron) throw new Error(`chevron not found: ${path}`)
    return chevron
  }
  const name = line.querySelector<HTMLElement>('.folder-name')
  if (!name) throw new Error(`name not found: ${path}`)
  return name
}

/**
 * 假 DOM 里的指针捕获：`setPointerCapture` 记下元素，`pointer()` 把事件只发给它。
 *
 * 这不是锦上添花——真实浏览器就是这么转发的，而"在行上捕获指针"会把随后的
 * `pointerup` 从折页挪到整行，click 的派发对象跟着变（见「折页点得开」那条用例）。
 * 不模拟捕获的假 DOM 会把这类 bug 全放过去。
 */
let captured: HTMLElement | null = null
/** 按下时命中的元素：浏览器据"按下元素与松开元素的最近公共祖先"决定 click 落到谁头上。 */
let pressed: HTMLElement | null = null

function pointer(target: EventTarget, type: string, clientY: number): void {
  const el = target instanceof HTMLElement ? target : null
  if (type === 'pointerdown') pressed = el
  const to = captured ?? el ?? target
  if (type === 'pointerup') captured = null
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(ev, { clientX: 100, clientY, button: 0, pointerId: 1 })
  to.dispatchEvent(ev)
  // 松手时浏览器补派 click：**按下与松开落在同一个元素上**才派。指针捕获会把松手
  // 挪到被捕获的元素上，于是按钮再也收不到 click——"分组点不开"正是这么来的。
  //
  // 这套模拟只求两条：不捕获时点击照常、捕获到别处时点击不派发。浏览器的真实规则
  // 还要绕（最近公共祖先等），拿不准的部分交给 `tools/ui-preview/app-click-probe.mjs`
  // 用真鼠标真 click 去验。
  if (type === 'pointerup' && pressed) {
    const release = el ?? (to instanceof HTMLElement ? to : null)
    if (release === pressed) {
      pressed.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }
    pressed = null
  }
}

/**
 * 一次**真实**的点击（按下 → 抬起，中间没动），click 由 pointer() 按浏览器规则补派。
 */
async function realClick(el: HTMLElement): Promise<void> {
  const row = el.closest<HTMLElement>('.folder-row')
  const y = rowTop(rowPaths().indexOf(row?.dataset.folderRow ?? '')) + ROW_H / 2
  pointer(el, 'pointerdown', y)
  await nextTick()
  pointer(el, 'pointerup', y)
  await nextTick()
}

/** 让所有挂起的微任务与零延时定时器跑完（搬家那条链有好几跳）。 */
async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}

/**
 * 展开态是**模块级单例**：同一个模块实例内，前一个用例改过的开合会留到下一个用例
 * （`bindVault` 只在书库根路径变化时重载）。所以这里显式把父分组点开，并等子行真的
 * 出现——每个用例都从同一份确定的行序起步，行下标才不会各算各的。
 */
async function ensureChild(parent: string, child: string) {
  for (let i = 0; i < 10 && !rowPaths().includes(child); i += 1) {
    host?.querySelector<HTMLElement>(`[data-folder-row="${parent}"] .folder-chevron-btn`)?.click()
    await settle()
  }
}

async function mountView() {
  host = document.createElement('div')
  document.body.appendChild(host)
  const pinia = createPinia()
  setActivePinia(pinia)
  app = createApp(LibraryView)
  app.use(pinia)
  app.use(router)
  await useSettingsStore().init()
  await useLibraryStore().refresh()
  app.mount(host)
  await settle()
  await ensureChild('MySQL', 'MySQL/日志')
  stubRowRects()
}

/**
 * 展开态是**模块级单例**且按书库根路径存 localStorage：不清就跨用例串味，展开的子行
 * 会在下一个用例里消失（行下标随之全错）。
 *
 * 另外把行的进出场过渡时长压成 0：jsdom 不会真的跑 CSS 过渡，元素会永远停在
 * "离场中"而不被移除——行序断言会读到一个已经消失的旧行。
 */
const NO_TRANSITION = `
  .folder-row-enter-active, .folder-row-leave-active, .folder-row-move,
  .side-row, .folder-chevron { transition: none !important; }
`

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = `<style>${NO_TRANSITION}</style>`
  localStorage.clear()
  dirs = [...FOLDERS]
  installNativeStub()
  // jsdom 没有 rAF。**必须真的回调**——Vue 的过渡结束判定也走 rAF，
  // 只返回一个 id 会让离场的行永远留在 DOM 里（行序断言会读到旧行）。
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) =>
    setTimeout(() => fn(performance.now()), 0),
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  // jsdom 的 Element 没有 scrollTo / scrollIntoView（换分组回卷首、聚焦时都会用到）
  Element.prototype.scrollTo = () => {}
  Element.prototype.scrollIntoView = () => {}
  // 指针捕获：只记"谁捕获了"，转发交给 pointer() 做（见那里的说明）
  captured = null
  Element.prototype.setPointerCapture = function (this: HTMLElement) {
    captured = this
  }
  Element.prototype.releasePointerCapture = () => {
    captured = null
  }
})

afterEach(() => {
  app?.unmount()
  app = null
  host = null
  localStorage.clear()
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

describe('LibraryView · 分组拖动排序（端到端）', () => {
  it('把 Java 拖到 Redis 上缘，侧栏行序真的换过', async () => {
    await mountView()
    // MySQL 默认展开：子行紧跟在父行之后
    expect(rowPaths()).toEqual([
      'agent',
      'Java',
      'MySQL',
      'MySQL/日志',
      'Redis',
      'SpringBoot',
      'test',
    ])

    await dragTo('Java', 'Redis', (top) => top + 2)
    await settle()

    expect(rowPaths()).toEqual([
      'agent',
      'MySQL',
      'MySQL/日志',
      'Java',
      'Redis',
      'SpringBoot',
      'test',
    ])
  })

  it('落点判定结果会落到 folderOrder（重启后仍按此序）', async () => {
    await mountView()
    const library = useLibraryStore()

    await dragTo('test', 'agent', (top) => top + 2) // 首行上缘 → 排到最前
    await settle()

    expect(rowPaths()[0]).toBe('test')
    expect(library.folderOrder[0]).toBe('test')
  })

  /**
   * 真机复现的那条几何边界：指针压在目标行下缘**之下**（相邻行的缝隙那一带）时，
   * 落点必须仍归到这一行。旧实现里这个位置给不出落点（或错误地落到末行）。
   */
  it('指针落在行下缘之外几像素（缝隙带），仍按最近一行排序', async () => {
    await mountView()

    await dragTo('MySQL', 'Redis', (top) => top + ROW_H + 6)
    await settle()

    // 落在 Redis 的下半 → after，即排在 Redis 与 SpringBoot 之间
    expect(rowPaths()).toEqual([
      'agent',
      'Java',
      'Redis',
      'MySQL',
      'MySQL/日志',
      'SpringBoot',
      'test',
    ])
  })

  it('缝隙带落在首行之下时不会错判到末行（旧实现的 `return last` 就会）', async () => {
    await mountView()

    // agent 是首行、行高最短的那条路：指针在它下缘之下 6px
    await dragTo('MySQL', 'agent', (top) => top + ROW_H + 6)
    await settle()

    // 归到 agent → after，即排在 agent 与 Java 之间
    expect(rowPaths()).toEqual([
      'agent',
      'MySQL',
      'MySQL/日志',
      'Java',
      'Redis',
      'SpringBoot',
      'test',
    ])
  })

  it('落在行中段 = 移进那个分组（跨层），树里出现子分组', async () => {
    await mountView()
    const library = useLibraryStore()

    await dragTo('Redis', 'MySQL', (top) => top + ROW_H / 2)
    await settle()

    expect(commands.find((c) => c.cmd === 'rename_dir')?.args).toMatchObject({
      from: 'Redis',
      to: 'MySQL/Redis',
    })
    expect(
      library.folderTree.find((n) => n.path === 'MySQL')?.children.map((c) => c.path),
    ).toContain('MySQL/Redis')
    expect(rowPaths()).not.toContain('Redis')
  })

  /**
   * 反例：把 Java 放到紧邻的 MySQL 之前 ＝ 现状，属 no-op。它必须**什么都不改**：
   * 行序不动、`folderOrder` 也不该被写（否则一次看起来没动的拖动会白白排一次序）。
   */
  it('拖到相邻位置造成 no-op 时不改序', async () => {
    await mountView()
    const library = useLibraryStore()
    const before = rowPaths()

    await dragTo('Java', 'MySQL', (top) => top + 2) // Java 已在 MySQL 之前
    await settle()

    expect(rowPaths()).toEqual(before)
    expect(library.folderOrder).toEqual([])
  })

  /**
   * 拖动过的那一下不该再选中任何分组——`click` 是 `pointerup` **之后**才派的，
   * 于是"拖完顺手选中了别的组"曾经是这类实现的经典副作用。
   */
  it('拖动之后的那一次点击被吞掉，不改变选中', async () => {
    await mountView()

    await dragTo('Java', 'Redis', (top) => top + 2)
    await settle()
    const selectedBefore = document.querySelector('.side-row-on')?.closest('.folder-row')
    expect(selectedBefore).toBeNull() // 全程没选中过

    // 松手后浏览器补派的那一下 click
    lineOf('Redis').querySelector<HTMLElement>('.folder-name')?.click()
    await settle()
    // 被吞：选中仍为空（没有 .side-row-on）
    expect(document.querySelector('.folder-row .side-row-on')).toBeNull()
  })

  it('没拖动过的普通点击照旧选中该分组', async () => {
    await mountView()

    await realClick(grabPoint('Java', 'name'))
    await settle()

    expect(document.querySelector('.folder-row .side-row-on')).not.toBeNull()
  })

  /**
   * **整行可拖**：从名称按钮上按下也能把这行拿起来（真机上用户正是按在名字上拖的）。
   * 这一条是「只能拖前面一小段」那个体验问题的回归守卫。
   */
  it('按在分组名上拖动，同样能把这行拿起来排序', async () => {
    await mountView()

    await dragTo('Java', 'Redis', (top) => top + 2, 'name')
    await settle()

    expect(rowPaths()).toEqual([
      'agent',
      'MySQL',
      'MySQL/日志',
      'Java',
      'Redis',
      'SpringBoot',
      'test',
    ])
  })

  it('按在折页上拖动，同样能把这行拿起来（折页的点击语义不受影响）', async () => {
    await mountView()

    // MySQL 本来就在 Redis 之前，故要挑一个"真的会换位"的落点
    await dragTo('MySQL', 'agent', (top) => top + 2, 'chevron')
    await settle()

    expect(rowPaths()).toEqual([
      'MySQL',
      'MySQL/日志',
      'agent',
      'Java',
      'Redis',
      'SpringBoot',
      'test',
    ])
  })

  /**
   * 折页上"按着不动"，仍是一次开合，不该被拖动手势吃掉。
   *
   * 这条曾经是**假绿**：当时直接调 `chevron.click()`，绕过了指针序列，于是漏掉了
   * 「在行上捕获指针 → pointerup 被重定向到整行 → click 落在整行上、折页收不到」这个
   * 回归（用户看到的就是"分组点不开了"）。现在 click 按浏览器的规则补派，且假 DOM
   * 会模拟指针捕获。
   */
  it('折页上按着不动仍是开合，不是拖动', async () => {
    await mountView()
    expect(rowPaths()).toContain('MySQL/日志')

    const chevron = grabPoint('MySQL', 'chevron')
    await realClick(chevron)
    await settle()

    // 开合生效：子行退场（说明折页自己的 click 收到了）
    expect(rowPaths()).not.toContain('MySQL/日志')
    // 且没有被当成拖动（行序没变）
    expect(rowPaths()).toEqual(['agent', 'Java', 'MySQL', 'Redis', 'SpringBoot', 'test'])
  })

  /** 名称按钮上按着不动，仍是一次选中。 */
  it('名称上按着不动仍是选中，不是拖动', async () => {
    await mountView()

    await realClick(grabPoint('Java', 'name'))
    await settle()

    expect(document.querySelector('.folder-row .side-row-on')).not.toBeNull()
    expect(rowPaths()).toContain('MySQL/日志') // 没顺手折叠、也没拖走
  })
})
