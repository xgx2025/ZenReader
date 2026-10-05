import { computed, ref } from 'vue'

export type GuideId = 'vault' | 'import' | 'note' | 'folder-create' | 'folder-scope' | 'folder-move' | 'knowledge' | 'zen' | 'clock'
export type GuideEvent = 'vault-opened' | 'import-page' | 'imported' | 'text-selected' | 'composer-opened' | 'note-saved' | 'folder-created' | 'topic-ready' | 'evidence-attached' | 'summary-saved'

export interface GuideStep {
  route: '/' | '/import' | '/knowledge' | '/read'
  target: string
  title: string
  body: string
  event?: GuideEvent
  nextLabel?: string
}

export const GUIDE_ORDER: GuideId[] = ['vault', 'import', 'note', 'folder-create', 'folder-scope', 'folder-move', 'knowledge', 'zen', 'clock']

export const GUIDES: Record<GuideId, { title: string; steps: GuideStep[] }> = {
  vault: { title: '打开书库', steps: [
    { route: '/', target: '[data-guide="open-vault"]', title: '先打开一座书库', body: '选择一个本地文件夹。已有 .md / .html 文章可直接读取；也可以选空文件夹，再用「引卷」加入文章。', event: 'vault-opened' },
    { route: '/', target: '[data-guide="library-main"]', title: '书库已打开', body: '这里显示文件夹里的文章。已有文章可直接开卷；空书库请点「引卷（导入文件）」。', nextLabel: '明白了' },
  ] },
  import: { title: '引卷入库', steps: [
    { route: '/', target: '[data-guide="import-link"]', title: '引入第一篇文章', body: '点击「引卷」，把外部文章加入当前书库。已有文档的文件夹也可以直接作为书库打开。', event: 'import-page' },
    { route: '/import', target: '[data-guide="import-target"]', title: '先确认落点', body: '「引入到」决定文章放在哪个分组。不需要分类就保留「根目录」。', nextLabel: '落点已确认' },
    { route: '/import', target: '[data-guide="import-actions"]', title: '选择文章', body: '单篇选「引卷」，整批选「拾整卷」；也可拖入 .md / .html 文件。导入成功后会显示结果。', event: 'imported' },
    { route: '/import', target: '[data-guide="import-result"]', title: '确认引卷结果', body: '「已引入」大于 0 才算成功；「已略过」与错误可在本页查看。回书库即可开卷阅读。', nextLabel: '完成' },
  ] },
  note: { title: '划词写觉悟', steps: [
    { route: '/read', target: '[data-guide="reader-text"]', title: '选一段原文', body: '用鼠标选中想记住的一小段文字。松开后会出现操作浮栏；若文章无法选字，可在上方「觉悟」中新建自由笔记。', event: 'text-selected' },
    { route: '/read', target: '[data-guide="selection-toolbar"]', title: '写下觉悟', body: '「驻足」只留下高亮；「写下觉悟」会带上原文建立笔记。请点后者。', event: 'composer-opened' },
    { route: '/read', target: '[data-guide="note-composer"]', title: '用自己的话写一句', body: '在「写」里落笔，可切到「观」预览；写好点「存」。', event: 'note-saved' },
    { route: '/read', target: '[data-guide="notes-panel"]', title: '以后在这里找回', body: '上方「觉悟」可找回、编辑这篇文章的笔记，也能把笔记归入知识图。', nextLabel: '完成' },
  ] },
  'folder-create': { title: '新建分组', steps: [
    { route: '/', target: '[data-guide="folder-create"]', title: '看清新分组的位置', body: '点「分组」旁的新建可建顶层；要建子分组，打开那个分组的「⋯」并选「新建子分组」。确认创建位置，填入名称后点「创建」。', event: 'folder-created' },
  ] },
  'folder-scope': { title: '浏览分组', steps: [
    { route: '/', target: '[data-guide="folder-scope"]', title: '分组只显示本层文章', body: '右侧是当前分组本层的文章；子分组中的文章仍在左侧。可点面包屑或侧栏「书库」返回。', nextLabel: '明白了' },
  ] },
  'folder-move': { title: '移动文章', steps: [
    { route: '/', target: '[data-guide="folder-move"]', title: '移动到别的分组', body: '卡片的「更多操作」里可选「移到分组」。这会移动本地文件，笔记与阅读进度随文件迁移。', nextLabel: '明白了' },
  ] },
  knowledge: { title: '知识图入门', steps: [
    { route: '/knowledge', target: '[data-guide="knowledge-topic"]', title: '先写一个想回答的问题', body: '点「新建主题」，用问题命名。所属领域只是图上的位置，主题仍可跨领域相连。已有主题可直接选中。', event: 'topic-ready' },
    { route: '/knowledge', target: '[data-guide="knowledge-evidence"]', title: '归入一则觉悟', body: '在「觉悟来处」选择笔记，并标明它是「印证 / 补充 / 存疑」。从笔记进入知识图时，可直接归入这则笔记。', event: 'evidence-attached' },
    { route: '/knowledge', target: '[data-guide="knowledge-summary"]', title: '写下此刻的认识', body: '用自己的话写当前的回答并保存。以后点「温故」重新回答，旧认识会留在「年轮」里。', event: 'summary-saved' },
  ] },
  zen: { title: '禅境', steps: [
    { route: '/read', target: '[data-guide="zen-button"]', title: '静心阅读', body: '点「禅境」可隐去界面；过场可点击跳过，按 Esc 退出。若开启沉浸全屏，出定也会退出全屏。', nextLabel: '明白了' },
  ] },
  clock: { title: '禅钟', steps: [
    { route: '/read', target: '[data-guide="clock-button"]', title: '一炷香仍会继续', body: '点香后，即使切换窗口或缩进托盘，计时仍会继续。再次点香可打开控制，随时「熄香」。', nextLabel: '明白了' },
  ] },
}

const active = ref<GuideId | null>(null)
const stepIndex = ref(0)
const helpOpen = ref(false)
const status = ref<Partial<Record<GuideId, 'done' | 'skipped'>>>({})
let scope = ''

function save() {
  try { localStorage.setItem(`zenreader.guides.v1:${scope}`, JSON.stringify(status.value)) } catch { /* storage unavailable */ }
}

function setGuideScope(vaultPath: string) {
  const next = vaultPath || 'no-vault'
  if (scope === next) return
  // Selecting the first vault changes the storage scope while the opening guide is active.
  const openingFirstVault = scope === 'no-vault' && next !== 'no-vault' && active.value === 'vault'
  scope = next
  try { status.value = JSON.parse(localStorage.getItem(`zenreader.guides.v1:${scope}`) || '{}') } catch { status.value = {} }
  if (!openingFirstVault) {
    active.value = null
    stepIndex.value = 0
  }
}

function beginGuide(id: GuideId, at = 0) {
  active.value = id
  stepIndex.value = Math.min(Math.max(0, at), GUIDES[id].steps.length - 1)
  helpOpen.value = false
}

function suggestGuide(id: GuideId, at = 0) {
  if (active.value || helpOpen.value || status.value[id]) return
  beginGuide(id, at)
}

function finishGuide(skipped = false) {
  if (!active.value) return
  status.value = { ...status.value, [active.value]: skipped ? 'skipped' : 'done' }
  save()
  active.value = null
  stepIndex.value = 0
}

function nextGuide() {
  if (!active.value) return
  if (stepIndex.value + 1 >= GUIDES[active.value].steps.length) finishGuide()
  else stepIndex.value++
}

function guideEvent(event: GuideEvent) {
  if (!active.value) return
  if (GUIDES[active.value].steps[stepIndex.value]?.event === event) nextGuide()
}

export function useGuide() {
  return {
    active, stepIndex, helpOpen, status,
    current: computed(() => active.value ? GUIDES[active.value].steps[stepIndex.value] : null),
    setGuideScope, beginGuide, suggestGuide, finishGuide, nextGuide, guideEvent,
  }
}
