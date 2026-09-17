<script setup lang="ts">
import { nextTick, ref, watch, type ComponentPublicInstance } from 'vue'

import ZIcon from '@/components/common/ZIcon.vue'
import { COPY } from '@/lib/copy'
import type { FolderRow } from '@/lib/folderTree'

/**
 * 侧栏分组树的**呈现层**：吃一份已展平的行序列（`lib/folderTree.flattenVisibleRows`），
 * 吐三类意图——选中 / 开合 / 唤菜单。
 *
 * 为什么不是递归组件：键盘上下移动、`role="tree"` 的层级、错峰入场都只需在一条序列上
 * 做；递归渲染会把这些全部摊进每一层实例里。
 *
 * 「选中」与「展开」是两件事：点行名只选中（不取消、不折叠），点折页只开合。
 */
const props = defineProps<{
  rows: FolderRow[]
  selected: string
  expanded: Record<string, boolean>
  /** 根层是否展开（「书库」行那枚折页）；收起即整棵分组树收拢。 */
  open?: boolean
  /** 正在拖拽引卷（浏览器通道）：行要能接住落点提示。 */
  dropping?: boolean
  /** 指针当前悬停的分组——外层据此改遮罩文案，行内据此亮出落点。 */
  dropHover?: string
  /** 键盘 roving tabindex 的落点：全树只有这一行在 Tab 序里。 */
  activePath?: string
  /** 正在行内改名的分组路径（空串＝没在改名）。 */
  renaming?: string
  /** 改名输入框的初值（由外层在进入改名时钉住，避免与 store 刷新互相打架）。 */
  renameDraft?: string
  /** 改名时的即时校验提示（空串＝没问题）；非空则输入框下方浮出小字。 */
  renameError?: string
  /** 正在被拖动的分组路径（指针事件拖动）。 */
  draggingFolder?: string
  /** 拖动落点：目标分组路径 + 落在其前/后/内部。 */
  dragOver?: { path: string; mode: 'before' | 'after' | 'inside' }
  /** 上一次手势是拖动：行名与折页的点击要吞掉（否则拖完顺手选中了别处）。 */
  swallowClick?: boolean
}>()

const emit = defineEmits<{
  select: [path: string]
  toggle: [path: string]
  /** count 随行带上：调用方据此把非空分组的「释怀」置灰。 */
  menu: [e: { path: string; count: number; x: number; y: number }]
  /** 释怀空分组：比埋进菜单更直达（空分组的存在意义只剩这一件事）。 */
  remove: [path: string]
  /** 键盘（↑↓←→ / Home / End / Enter / Menu）——导航细节留在视图层。 */
  keydown: [e: KeyboardEvent, path: string]
  /** 焦点落点回报，供父层维持 roving tabindex。 */
  focusRow: [path: string]
  /** 拖拽引卷的落点进入 / 离开某分组。 */
  dropHover: [path: string]
  dropLeave: []
  /** 行内改名：提交 / 取消 / 输入。 */
  renameInput: [name: string]
  renameCommit: []
  renameCancel: []
  /** 分组拖动：指针按在某行上（拿起与否由外层的阈值决定）。 */
  rowPointerDown: [path: string, ev: PointerEvent]
}>()

const renameInputEl = ref<HTMLInputElement | null>(null)
/** 整棵树的容器：拖动落点判定按它内部各行的盒模型算（见 resolveDropFromPoint）。 */
const foldEl = ref<HTMLElement | null>(null)

/**
 * 改名输入框的 ref 回填。它长在 `v-for` 里，用函数 ref 只认当前那一行——
 * 模板 ref 加 v-for 会收成一数组，取值处就得靠索引猜。
 */
function bindRenameInput(el: Element | ComponentPublicInstance | null) {
  renameInputEl.value = (el as HTMLInputElement | null) ?? null
}

watch(
  () => props.renaming,
  async (path) => {
    if (!path) return
    await nextTick()
    renameInputEl.value?.focus()
    renameInputEl.value?.select()
  },
)

/** 行内改名输入框的按键：Enter 提交、Esc 取消（沿用新建分组那一套）。 */
function onRenameKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('renameCommit')
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('renameCancel')
  }
}

function onMenu(row: FolderRow, ev: MouseEvent) {
  emit('menu', {
    path: row.node.path,
    count: row.node.count,
    x: ev.clientX,
    y: ev.clientY,
  })
}

/** 行上「⋯」的落点：贴着按钮左下角，ContextMenu 自会按视口夹取。 */
function onMenuButton(row: FolderRow, ev: MouseEvent) {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  emit('menu', { path: row.node.path, count: row.node.count, x: r.left, y: r.bottom + 4 })
}

/** 右键折页也唤菜单：折页是独立按钮，事件不会冒到 `<li>` 的 contextmenu 上。 */
function onChevronContext(row: FolderRow, ev: MouseEvent) {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  emit('menu', { path: row.node.path, count: row.node.count, x: r.left, y: r.bottom + 4 })
}

/**
 * 行提示：讲清「本层 N 篇 / 共 M 篇」，并补上被截断的完整路径。
 * 两者不同才是关键信息——相同就不必念两遍。
 */
function rowTitle(row: FolderRow): string {
  const { node } = row
  const parts: string[] = []
  if (node.path.includes('/')) parts.push(node.path)
  if (node.count !== node.here) {
    parts.push(`${COPY.folderCountHere} ${node.here} ${COPY.pieceUnit}`)
  }
  parts.push(`${COPY.folderCountAll} ${node.count} ${COPY.pieceUnit}`)
  return parts.join(' · ')
}

/**
 * 计数列的口径：**先给点进去真正会看到的那个数**（本层直属），子树总数只在两者
 * 不同时以「/ 总数」跟在后面。
 *
 * 下钻模型下这两个数天然不等，只显一个就必然自相矛盾：显本层，「12 篇」的分组点进去
 * 只有 2 篇像丢东西；显总数，主区的空态又会打脸。两个一起给、把主次交给字色，读起来
 * 是一件事的两个刻度，而不是两个互相打架的数字。
 */
function hereCount(row: FolderRow): number {
  return row.node.here
}

/** 子树总数（仅在本层与它不等时显示）。 */
function allCount(row: FolderRow): number {
  return row.node.count
}

function showTotal(row: FolderRow): boolean {
  return row.node.count !== row.node.here
}

function isSelected(row: FolderRow): boolean {
  return props.selected === row.node.path
}

function isOpen(row: FolderRow): boolean {
  return props.expanded[row.node.path] !== false
}

/**
 * 拖拽引卷的落点提示：`dropping` 为真时才挂 dragover——其余时候完全是惰性的。
 * Tauri 的 HTML5 drop 事件被原生层接管、根本不会到达这里（浏览器通道才有），
 * 所以这段在桌面端不生效；它让浏览器预览与将来的原生落点共用同一份 UI。
 */
function onRowDragOver(path: string, e: DragEvent) {
  e.preventDefault()
  if (props.dropHover !== path) emit('dropHover', path)
}

/**
 * 分组拖动的起点：**指针事件**，不是 HTML5 拖放。
 *
 * 落点判定、拿起阈值、自动滚动全在外层（`useFolderDrag` + `lib/folderDrag`），
 * 这里只把「指针按在哪个组上」报上去。于是组件保持为纯呈现层，也彻底不再碰
 * `draggable`——HTML5 拖放在 Windows 的 WebView2 里会丢 drop（见 `useFolderDrag` 的说明）。
 */
function onPointerDown(row: FolderRow, ev: PointerEvent) {
  if (props.renaming) return // 改名中让位给输入框
  emit('rowPointerDown', row.node.path, ev)
}

/** 拖动过的那一下不该再触发「选中」——`click` 是 `pointerup` 之后才派的。 */
function onNameClick(row: FolderRow) {
  if (props.swallowClick) return
  emit('select', row.node.path)
}

/** 同理：拖完那一下也不该顺手把分组收起来。 */
function onToggleClick(row: FolderRow) {
  if (props.swallowClick) return
  emit('toggle', row.node.path)
}

/**
 * 行内动作钮（⋯ / 释怀）也一样：拖完那一下不该顺手弹出菜单或删掉分组。
 * 按下的那一刻它还是"点得动"的（整行可拖的前提），所以这层屏蔽要在 click 上做。
 */
function onActionClick(run: () => void) {
  if (props.swallowClick) return
  run()
}

/**
 * 引卷（从系统拖文件进窗口）的落点：逐行命中。**分组拖动不走这里**——
 * 那条路已改成指针事件，`props.dropping` 只在引卷通道为真。
 */
function resolveDropFromPoint(clientY: number): string | null {
  const list = foldEl.value?.querySelectorAll<HTMLElement>('.folder-row')
  if (!list?.length) return null
  let nearest: { path: string; distance: number } | null = null
  for (const li of list) {
    const path = li.dataset.folderRow
    if (!path) continue
    const r = li.getBoundingClientRect()
    const distance = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0
    // 行距只有 1px：缝隙里也认最近的那一行，否则遮罩文案会闪一下空
    if (!nearest || distance < nearest.distance) nearest = { path, distance }
  }
  return nearest?.path ?? null
}

function onTreeDragOver(ev: DragEvent) {
  if (!props.dropping) return
  // 必须 preventDefault：浏览器据此认定「此处可投放」，松手才会派发 drop。
  ev.preventDefault()
  const path = resolveDropFromPoint(ev.clientY)
  if (path && props.dropHover !== path) emit('dropHover', path)
}

function onTreeDrop(ev: DragEvent) {
  if (!props.dropping) return
  ev.preventDefault()
}

</script>

<template>
  <!-- 外层只管根层开合：高度 0fr ↔ 1fr，收拢后整棵树不可点 -->
  <div
    ref="foldEl"
    class="folder-fold"
    :class="open === false ? 'folder-fold-closed' : ''"
  >
    <!-- 拖拽引卷（从系统拖文件进来）的落点判定仍挂容器：逐行监听 dragover 会被行内
         子元素的边界抖动打断，导致禁止图标。分组拖动已改走指针事件，不再经过这里。 -->
    <TransitionGroup
      tag="ul"
      class="folder-rows"
      name="folder-row"
      role="tree"
      @dragover="onTreeDragOver"
      @drop="onTreeDrop"
    >
      <li
        v-for="(row, i) in rows"
        :key="row.node.path"
        class="folder-row"
        :class="{
          'folder-row-on': isSelected(row),
          'folder-row-renaming': renaming === row.node.path,
          'folder-row-lifted': draggingFolder === row.node.path,
        }"
        role="treeitem"
        :tabindex="activePath === row.node.path ? 0 : -1"
        :aria-level="row.depth + 1"
        :aria-selected="isSelected(row)"
        :aria-expanded="row.expandable ? isOpen(row) : undefined"
        :aria-label="rowTitle(row)"
        :style="{ '--row-d': `${Math.min(i, 12) * 28}ms` }"
        :data-folder-row="row.node.path"
        @keydown="emit('keydown', $event, row.node.path)"
        @focus="emit('focusRow', row.node.path)"
        @contextmenu.stop.prevent="onMenu(row, $event)"
      >
        <div
          class="group side-row folder-line"
          :class="[
            isSelected(row) ? 'side-row-on' : '',
            dropping && dropHover === row.node.path ? 'drop-target' : '',
            dragOver?.path === row.node.path && dragOver.mode === 'inside' ? 'folder-drop-inside' : '',
            dragOver?.path === row.node.path && dragOver.mode === 'before' ? 'folder-drop-before' : '',
            dragOver?.path === row.node.path && dragOver.mode === 'after' ? 'folder-drop-after' : '',
          ]"
          :data-folder-row="row.node.path"
          @pointerdown="onPointerDown(row, $event)"
          @dragover="dropping ? onRowDragOver(row.node.path, $event) : undefined"
          @dragleave="dropping ? emit('dropLeave') : undefined"
        >
          <!-- 缩进占位：层级只推名称与折页，不推尾列——所以数字全栏同一条竖线
               （见 motion.css 里 .side-row 的栅格说明）。 -->
          <span
            v-if="row.depth"
            class="folder-indent"
            :style="{ width: `${row.depth * 16}px` }"
            aria-hidden="true"
          ></span>

          <!-- 折页：只管开合，从不改变选中。收起一个内含当前选中的分组时，选中也
               不被切走——主区内容不该因为「把树收起来」而变。 -->
          <button
            v-if="row.expandable"
            type="button"
            tabindex="-1"
            class="side-cv folder-chevron-btn text-dusk transition-colors hover:bg-bamboo/12 hover:text-ink"
            :title="isOpen(row) ? COPY.folderCollapse : COPY.folderExpand"
            :aria-label="isOpen(row) ? COPY.folderCollapse : COPY.folderExpand"
            @click.stop="onToggleClick(row)"
            @contextmenu.stop.prevent="onChevronContext(row, $event)"
          >
            <ZIcon
              name="chevron-down"
              :size="12"
              :stroke-width="1.4"
              class="folder-chevron"
              :class="isOpen(row) ? '' : '-rotate-90'"
            />
          </button>
          <!-- 无子分组也留位对齐：否则同层的名字左右参差 -->
          <span v-else class="side-cv"></span>

          <!-- 改名中：名称那一格换成输入框，原位改名（不弹窗），行宽与计数列都不动，
               所以改名前后的位置感不丢。校验没过时不提交——否则报错的同时又被提交一次。 -->
          <input
            v-if="renaming === row.node.path"
            :ref="bindRenameInput"
            type="text"
            class="side-name folder-rename-input"
            :class="renameError ? 'folder-rename-bad' : ''"
            :value="renameDraft"
            :aria-label="COPY.renameFolder"
            :aria-invalid="!!renameError"
            spellcheck="false"
            autocomplete="off"
            @input="emit('renameInput', ($event.target as HTMLInputElement).value)"
            @keydown="onRenameKey"
            @keydown.stop
            @blur="!renameError && emit('renameCommit')"
            @contextmenu.stop
          />
          <span v-if="renaming === row.node.path && renameError" class="folder-rename-hint">
            {{ renameError }}
          </span>

          <button
            v-else
            type="button"
            class="folder-name side-name flex h-8 items-center gap-1.5 text-left text-sm transition-colors"
            :class="isSelected(row) ? 'text-ink' : ''"
            :title="rowTitle(row)"
            @click="onNameClick(row)"
          >
            <span class="min-w-0 flex-1 truncate">{{ row.node.name }}</span>

            <!-- 计数与动作共占右侧一格：悬停时计数隐去、动作浮出，布局不跳动 -->
            <span class="side-tail folder-tail">
              <span
                class="side-count folder-count"
                :class="row.node.count === 0 ? 'side-count-zero' : ''"
              >
                {{ hereCount(row) }}<span
                  v-if="showTotal(row)"
                  class="side-count-alt"
                >/{{ allCount(row) }}</span>
              </span>

              <!-- 非空：⋯ 唤菜单（释怀在菜单里置灰并写明缘由） -->
              <button
                v-if="row.node.count > 0"
                type="button"
                tabindex="-1"
                class="folder-action absolute inset-y-0 right-0 flex w-[1.875rem] items-center justify-end rounded text-dusk opacity-0 transition-opacity duration-200 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                :title="COPY.folderMenu"
                :aria-label="COPY.folderMenu"
                @click.stop="onActionClick(() => onMenuButton(row, $event))"
              >
                <ZIcon name="more" :size="14" />
              </button>
              <!-- 空分组：唯一可做的事就是释怀，直接露出（不必再进一层菜单） -->
              <button
                v-else
                type="button"
                tabindex="-1"
                class="folder-action absolute inset-y-0 right-0 flex w-[1.875rem] items-center justify-end rounded text-dusk opacity-0 transition-opacity duration-200 hover:text-sandal focus-visible:opacity-100 group-hover:opacity-100"
                :title="COPY.removeFolder"
                :aria-label="COPY.removeFolder"
                @click.stop="onActionClick(() => emit('remove', row.node.path))"
              >
                <ZIcon name="delete" :size="14" />
              </button>
            </span>
          </button>
        </div>
      </li>
    </TransitionGroup>
  </div>
</template>
