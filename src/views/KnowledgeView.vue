<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import AppHeader from '@/components/common/AppHeader.vue'
import ZIcon from '@/components/common/ZIcon.vue'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import { nativeFs } from '@/lib/native'
import { COPY } from '@/lib/copy'
import type { EvidenceRole, KnowledgeRelationKind, KnowledgeTopic } from '@/types/knowledge'

const knowledge = useKnowledgeStore()
const settings = useSettingsStore()
const router = useRouter()
const route = useRoute()
const { notify } = useToast()

const selectedId = ref('')
const domainFilter = ref('')
const search = ref('')
const creating = ref(false)
const editing = ref(false)
const deleting = ref(false)
const pickingNote = ref(false)
const revisiting = ref(false)
const showHistory = ref(false)
const newTitle = ref('')
const newDomain = ref('')
const editTitle = ref('')
const editDomain = ref('')
const editSummary = ref('')
const freshAnswer = ref('')
const noteSearch = ref('')
const noteRole = ref<EvidenceRole>('supports')
const linkTarget = ref('')
const linkKind = ref<KnowledgeRelationKind>('related')
const vaultDomains = ref<string[]>([])
const mapScroll = ref<HTMLElement | null>(null)
const overview = ref(false)
const mapScale = computed(() => overview.value ? 0.76 : 1)

const topics = computed(() => knowledge.map.topics)
const selected = computed(() => topics.value.find((topic) => topic.id === selectedId.value))
const domains = computed(() => [...new Set(topics.value.map((topic) => topic.domain))])
const domainSuggestions = computed(() => [...new Set([...domains.value, ...vaultDomains.value])])
const visibleTopics = computed(() => {
  const q = search.value.trim().toLocaleLowerCase()
  return topics.value.filter((topic) =>
    (!domainFilter.value || topic.domain === domainFilter.value)
    && (!q || `${topic.title} ${topic.domain} ${topic.summary}`.toLocaleLowerCase().includes(q)),
  )
})
const visibleDomains = computed(() => [...new Set(visibleTopics.value.map((topic) => topic.domain))])
const canvasWidth = computed(() => Math.max(800, visibleDomains.value.length * 254 + 42))
const lanes = computed(() => visibleDomains.value.map((domain, index) => ({
  domain,
  x: 30 + Math.max(0, (canvasWidth.value - (visibleDomains.value.length * 254 + 42)) / 2) + index * 254,
  topics: visibleTopics.value.filter((topic) => topic.domain === domain),
})))
const positioned = computed(() => lanes.value.flatMap((lane) => lane.topics.map((topic, index) => ({
  topic,
  x: lane.x + 15,
  y: 98 + index * 132,
}))))
const positionById = computed(() => new Map(positioned.value.map((item) => [item.topic.id, item])))
const canvasHeight = computed(() => Math.max(500, ...lanes.value.map((lane) => lane.topics.length * 132 + 104)))
const paths = computed(() => knowledge.map.relations.flatMap((relation) => {
  const from = positionById.value.get(relation.fromId)
  const to = positionById.value.get(relation.toId)
  if (!from || !to) return []
  const sameLane = from.x === to.x
  const right = to.x > from.x
  const down = to.y > from.y
  const x1 = sameLane ? from.x + 98 : from.x + (right ? 196 : 0)
  const x2 = sameLane ? to.x + 98 : to.x + (right ? 0 : 196)
  const y1 = sameLane ? from.y + (down ? 96 : 0) : from.y + 48
  const y2 = sameLane ? to.y + (down ? 0 : 96) : to.y + 48
  const bend = Math.max(35, Math.abs(sameLane ? y2 - y1 : x2 - x1) * 0.42)
  return [{
    ...relation,
    d: sameLane
      ? `M ${x1} ${y1} C ${x1} ${y1 + (down ? bend : -bend)}, ${x2} ${y2 - (down ? bend : -bend)}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1 + (right ? bend : -bend)} ${y1}, ${x2 - (right ? bend : -bend)} ${y2}, ${x2} ${y2}`,
  }]
}))
const noteById = computed(() => new Map(knowledge.notes.map((note) => [note.id, note])))
const selectedEvidence = computed(() => knowledge.map.evidence
  .filter((item) => item.topicId === selectedId.value)
  .map((item) => ({ ...item, note: noteById.value.get(item.noteId) }))
  .filter((item) => item.note))
const selectedRelations = computed(() => knowledge.map.relations.filter(
  (item) => item.fromId === selectedId.value || item.toId === selectedId.value,
))
const availableNotes = computed(() => {
  const q = noteSearch.value.trim().toLocaleLowerCase()
  const used = new Set(selectedEvidence.value.map((item) => item.noteId))
  return knowledge.notes.filter((note) => !used.has(note.id)
    && (!q || `${note.quote} ${note.note} ${note.relativePath}`.toLocaleLowerCase().includes(q)))
    .slice(0, 18)
})
const suggestedNote = computed(() => {
  const id = typeof route.query.note === 'string' ? route.query.note : ''
  return id ? noteById.value.get(id) : undefined
})

const RELATION_LABEL: Record<KnowledgeRelationKind, string> = {
  depends: '依赖', related: '相关', contrasts: '相辨',
}
const EVIDENCE_LABEL: Record<EvidenceRole, string> = {
  supports: '印证', extends: '补充', questions: '存疑',
}

function selectTopic(id: string) {
  const target = topics.value.find((topic) => topic.id === id)
  if (target && !visibleTopics.value.some((topic) => topic.id === id)) {
    domainFilter.value = ''
    search.value = ''
  }
  selectedId.value = id
  editing.value = false
  revisiting.value = false
  pickingNote.value = false
  showHistory.value = false
  creating.value = false
}

watch(topics, (list) => {
  if (!list.some((item) => item.id === selectedId.value)) selectedId.value = list[0]?.id ?? ''
}, { deep: true })

watch(selectedId, async (id) => {
  await nextTick()
  const target = [...(mapScroll.value?.querySelectorAll<HTMLElement>('[data-topic-id]') ?? [])]
    .find((element) => element.dataset.topicId === id)
  target?.scrollIntoView({
    block: 'nearest', inline: 'center',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
})

onMounted(async () => {
  if (settings.vaultPath) {
    void nativeFs.readVault(settings.vaultPath).then((listing) => {
      vaultDomains.value = [...new Set(listing.dirs.map((dir) => dir.split('/')[0]).filter(Boolean))]
    }).catch(() => {})
  }
  await knowledge.load(true)
  if (!selectedId.value) selectedId.value = topics.value[0]?.id ?? ''
})

async function run(action: () => Promise<unknown>, success: string) {
  try {
    await action()
    notify(success, 'bamboo')
  } catch {
    notify('未能保存知识图，请稍后重试', 'sandal')
  }
}

async function createTopic() {
  if (!newTitle.value.trim()) return
  try {
    const topic = await knowledge.addTopic(newTitle.value, newDomain.value)
    newTitle.value = ''
    newDomain.value = ''
    domainFilter.value = ''
    search.value = ''
    selectTopic(topic.id)
    notify('主题已落入图中', 'bamboo')
  } catch {
    notify('未能新建主题', 'sandal')
  }
}

function startEdit(topic: KnowledgeTopic) {
  editTitle.value = topic.title
  editDomain.value = topic.domain === '未分域' ? '' : topic.domain
  editSummary.value = topic.summary
  editing.value = true
}

async function saveEdit() {
  if (!selected.value || !editTitle.value.trim()) return
  const id = selected.value.id
  await run(() => knowledge.updateTopic(id, {
    title: editTitle.value, domain: editDomain.value, summary: editSummary.value,
  }), '此刻的认识已存')
  editing.value = false
}

async function removeSelected() {
  const id = selected.value?.id
  if (!id) return
  deleting.value = false
  await run(() => knowledge.removeTopic(id), '主题已释怀')
}

async function connect() {
  if (!selected.value || !linkTarget.value) return
  await run(() => knowledge.addRelation(selected.value!.id, linkTarget.value, linkKind.value), '两处知识已相连')
  linkTarget.value = ''
}

async function attach(noteId: string) {
  if (!selected.value) return
  await run(() => knowledge.addEvidence(selected.value!.id, noteId, noteRole.value), '觉悟已归入主题')
  pickingNote.value = false
  noteSearch.value = ''
  if (route.query.note) void router.replace('/knowledge')
}

async function saveRevisit() {
  if (!selected.value || !freshAnswer.value.trim()) return
  await run(() => knowledge.updateTopic(selected.value!.id, {
    title: selected.value!.title,
    domain: selected.value!.domain,
    summary: freshAnswer.value,
  }), '新的认识已存，旧的留在年轮里')
  revisiting.value = false
  freshAnswer.value = ''
}

function openNote(path: string, noteId: string) {
  void router.push({ path: `/read/${encodeURIComponent(path)}`, query: { note: noteId } })
}
</script>

<template>
  <div class="knowledge-page flex h-screen flex-col overflow-hidden text-ink">
    <AppHeader active="knowledge" />

    <div v-if="!settings.vaultPath" class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <p class="font-serif text-2xl">先打开一座书库</p>
      <p class="text-sm text-ink-soft">知识图会随你的书库一同保存。</p>
      <RouterLink to="/" class="rounded-full bg-bamboo px-5 py-2 text-sm text-paper">回到书库</RouterLink>
    </div>

    <main v-else class="knowledge-main flex min-h-0 flex-1 overflow-hidden">
      <section class="flex min-w-0 flex-1 flex-col px-6 pb-5 pt-6">
        <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div class="mb-2 flex items-center gap-2 text-[11px] tracking-[0.22em] text-bamboo">
              <span class="inline-block h-px w-7 bg-bamboo/55"></span> KNOWLEDGE ATLAS · 知识脉络
            </div>
            <h2 class="font-serif text-[30px] leading-tight">让所学，彼此照见。</h2>
            <p class="mt-2 text-sm text-ink-soft">以主题为点，以关系为线；每一种认识，都能回到自己的来处。</p>
          </div>
          <button class="knowledge-primary inline-flex items-center gap-2 rounded-full bg-bamboo px-5 py-2.5 text-sm text-paper transition-transform hover:-translate-y-0.5" @click="creating = true; newDomain = domainFilter; editing = false; revisiting = false">
            <ZIcon name="plus" :size="16" /> {{ COPY.newTopic }}
          </button>
        </div>

        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex max-w-full items-center gap-1 overflow-x-auto pb-1 text-xs">
            <button class="knowledge-filter" :class="!domainFilter ? 'knowledge-filter-on' : ''" @click="domainFilter = ''">全局 · {{ topics.length }}</button>
            <button v-for="domain in domains" :key="domain" class="knowledge-filter" :class="domainFilter === domain ? 'knowledge-filter-on' : ''" @click="domainFilter = domainFilter === domain ? '' : domain">{{ domain }}</button>
          </div>
          <div class="flex items-center gap-2">
          <button class="flex items-center gap-1 rounded-full border border-line bg-paper/60 px-3 py-1.5 text-xs text-ink-soft hover:text-bamboo" :aria-pressed="overview" @click="overview = !overview"><ZIcon :name="overview ? 'expand' : 'shrink'" :size="13" />{{ overview ? '原寸' : '缩览' }}</button>
          <label class="flex items-center gap-2 rounded-full border border-line bg-paper/60 px-3 py-1.5 text-ink-soft">
            <ZIcon name="search" :size="14" />
            <input v-model="search" class="w-28 bg-transparent text-xs text-ink outline-none placeholder:text-dusk" placeholder="寻一处知识" aria-label="搜索知识主题" />
          </label>
          </div>
        </div>

        <div ref="mapScroll" class="knowledge-canvas relative min-h-0 flex-1 overflow-auto rounded-[24px] border border-line bg-paper-deep/30">
          <div v-if="knowledge.loading" class="flex h-full items-center justify-center text-sm text-ink-soft">正在展开知识图…</div>
          <div v-else-if="knowledge.error" class="flex h-full flex-col items-center justify-center gap-3 text-sm"><p>知识图暂未打开：{{ knowledge.error }}</p><button class="text-bamboo underline" @click="knowledge.load(true)">重试</button></div>
          <div v-else-if="!topics.length" class="knowledge-empty flex h-full min-h-[490px] flex-col items-center justify-center px-6 text-center">
            <div class="knowledge-empty-mark"><span></span><span></span><span></span><span></span></div>
            <span class="mt-10 text-[11px] tracking-[0.3em] text-bamboo">第一笔</span>
            <h3 class="mt-3 font-serif text-2xl">从一个想弄明白的问题开始</h3>
            <p class="mt-3 max-w-sm text-sm leading-7 text-ink-soft">例如“什么决定系统的可靠性？”<br />以后读到的文章与觉悟，都可以汇入这里。</p>
            <button class="mt-7 rounded-full border border-bamboo/45 px-5 py-2 text-sm text-bamboo hover:bg-bamboo/10" @click="creating = true">写下第一个主题</button>
            <div v-if="vaultDomains.length" class="mt-8 flex max-w-md flex-wrap items-center justify-center gap-2 text-xs"><span class="text-dusk">也可以从现有分组开始</span><button v-for="domain in vaultDomains.slice(0, 4)" :key="domain" class="rounded-full bg-bamboo/8 px-3 py-1.5 text-bamboo hover:bg-bamboo/15" @click="newDomain = domain; creating = true">{{ domain }} ↗</button></div>
          </div>
          <div v-else-if="!visibleTopics.length" class="flex h-full min-h-[490px] items-center justify-center text-sm text-ink-soft">这片图中，暂未寻到相符的主题。</div>
          <div v-else class="relative" :style="{ width: `${canvasWidth * mapScale}px`, height: `${canvasHeight * mapScale}px` }">
            <div class="relative origin-top-left" :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px`, transform: `scale(${mapScale})` }">
            <div v-for="lane in lanes" :key="lane.domain" class="knowledge-lane absolute rounded-[22px]" :style="{ left: `${lane.x}px`, top: '26px', width: '226px', height: `${canvasHeight - 50}px` }">
              <div class="flex items-center gap-2 px-5 pt-5"><span class="h-1.5 w-1.5 rounded-full bg-bamboo/60"></span><span class="font-serif text-sm text-ink-soft">{{ lane.domain }}</span><span class="ml-auto text-[11px] text-dusk">{{ lane.topics.length }}</span></div>
            </div>
            <svg class="pointer-events-none absolute inset-0" :width="canvasWidth" :height="canvasHeight" aria-hidden="true">
              <defs><marker id="knowledge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 7 4 1 7" fill="none" stroke="var(--bamboo)" stroke-width="1.5" /></marker></defs>
              <path v-for="path in paths" :key="path.id" :d="path.d" fill="none" :stroke="path.kind === 'contrasts' ? 'var(--sandal)' : 'var(--bamboo)'" :stroke-opacity="path.fromId === selectedId || path.toId === selectedId ? 0.65 : 0.3" :stroke-width="path.fromId === selectedId || path.toId === selectedId ? 2 : 1.4" :stroke-dasharray="path.kind === 'contrasts' ? '4 6' : undefined" :marker-end="path.kind === 'depends' ? 'url(#knowledge-arrow)' : undefined" />
            </svg>
            <button v-for="item in positioned" :key="item.topic.id" :data-topic-id="item.topic.id" class="knowledge-node absolute text-left" :class="item.topic.id === selectedId ? 'knowledge-node-on' : ''" :style="{ left: `${item.x}px`, top: `${item.y}px` }" :aria-pressed="item.topic.id === selectedId" @click="selectTopic(item.topic.id)">
              <span class="knowledge-node-index">{{ String(topics.indexOf(item.topic) + 1).padStart(2, '0') }}</span>
              <span class="knowledge-node-title">{{ item.topic.title }}</span>
              <span class="knowledge-node-foot"><span>{{ item.topic.summary ? '已有认识' : '尚待落笔' }}</span><span class="h-px w-5 bg-bamboo/35"></span><span>{{ knowledge.map.evidence.filter((e) => e.topicId === item.topic.id).length }} 则觉悟</span></span>
            </button>
            </div>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-between text-[11px] text-dusk">
          <span>点选主题查看来处 · 箭头表示依赖 · 虚线表示相辨</span>
          <span>{{ domains.length }} 个领域 · {{ topics.length }} 个主题 · {{ knowledge.map.relations.length }} 条联系</span>
        </div>
      </section>

      <aside class="knowledge-inspector flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-line bg-paper/45 px-6 pb-8 pt-7 xl:w-[370px]">
        <template v-if="creating">
          <button class="mb-7 flex items-center gap-2 self-start text-xs text-ink-soft hover:text-bamboo" @click="creating = false"><ZIcon name="back" :size="14" /> 返回图谱</button>
          <span class="knowledge-eyebrow">NEW THREAD · 新的一笔</span>
          <h3 class="mt-3 font-serif text-2xl">写下一处想弄明白的事</h3>
          <p class="mt-3 text-sm leading-6 text-ink-soft">可以是一个问题，也可以是一个正在建立的概念。</p>
          <label class="knowledge-field mt-8">主题名称<input v-model="newTitle" autofocus maxlength="64" placeholder="例如：什么决定系统的可靠性？" @keydown.enter="createTopic" /></label>
          <label class="knowledge-field mt-5">所属领域<input v-model="newDomain" list="knowledge-domains" maxlength="36" placeholder="例如：软件工程" @keydown.enter="createTopic" /></label>
          <datalist id="knowledge-domains"><option v-for="domain in domainSuggestions" :key="domain" :value="domain" /></datalist>
          <p class="mt-3 text-xs leading-5 text-dusk">领域只是图上的位置；主题之间仍可以跨领域相连。</p>
          <button class="mt-8 rounded-full bg-bamboo px-5 py-2.5 text-sm text-paper disabled:opacity-40" :disabled="!newTitle.trim()" @click="createTopic">落入图中</button>
        </template>

        <template v-else-if="selected">
          <div v-if="suggestedNote" class="mb-5 rounded-xl border border-bamboo/30 bg-bamboo/8 p-3 text-xs leading-5">
            <p class="text-bamboo">来自阅读中的觉悟</p>
            <p class="mt-1 line-clamp-2 text-ink-soft">{{ suggestedNote.note || suggestedNote.quote }}</p>
            <div class="mt-2 flex items-center gap-2"><select v-model="noteRole" aria-label="这则觉悟的作用" class="rounded-lg bg-paper-deep px-2 py-1 text-ink"><option value="supports">印证</option><option value="extends">补充</option><option value="questions">存疑</option></select><button class="text-bamboo underline" @click="attach(suggestedNote.id)">归入当前主题</button></div>
          </div>
          <div class="mb-6 flex items-center justify-between"><span class="knowledge-eyebrow">TOPIC · {{ selected.domain }}</span><button class="text-ink-soft hover:text-bamboo" title="编辑主题" @click="startEdit(selected)"><ZIcon name="edit" :size="16" /></button></div>
          <template v-if="editing">
            <label class="knowledge-field">主题名称<input v-model="editTitle" maxlength="64" /></label>
            <label class="knowledge-field mt-4">所属领域<input v-model="editDomain" list="knowledge-domains" maxlength="36" /></label>
            <datalist id="knowledge-domains"><option v-for="domain in domainSuggestions" :key="domain" :value="domain" /></datalist>
            <label class="knowledge-field mt-4">此刻的认识<textarea v-model="editSummary" rows="7" placeholder="用自己的话写下目前的理解…" /></label>
            <div class="mt-4 flex gap-2"><button class="rounded-full bg-bamboo px-4 py-2 text-xs text-paper" :disabled="!editTitle.trim()" @click="saveEdit">保存</button><button class="rounded-full px-4 py-2 text-xs text-ink-soft hover:bg-paper-deep" @click="editing = false">取消</button></div>
            <button class="mt-10 self-start text-xs text-sandal hover:underline" @click="deleting = true">释怀此主题</button>
          </template>
          <template v-else>
            <h3 class="font-serif text-[25px] leading-[1.45]">{{ selected.title }}</h3>
            <div class="mt-6 border-t border-line pt-5">
              <div class="flex items-center justify-between"><span class="knowledge-eyebrow">此刻的认识</span><button class="text-xs text-bamboo hover:underline" @click="startEdit(selected)">修订</button></div>
              <p v-if="selected.summary && !revisiting" class="mt-3 whitespace-pre-wrap font-serif text-[15px] leading-8 text-ink-soft">{{ selected.summary }}</p>
              <button v-else class="mt-3 rounded-xl border border-dashed border-bamboo/35 px-4 py-4 text-left text-sm leading-6 text-ink-soft hover:bg-bamboo/5" @click="startEdit(selected)">还没有结论。把阅读后真正想通的事，写在这里。</button>
              <button v-if="selected.summary && !revisiting" class="mt-4 inline-flex items-center gap-2 text-xs text-bamboo hover:underline" @click="revisiting = true; freshAnswer = ''"><ZIcon name="refresh" :size="13" /> 温故 · 重新回答</button>
              <div v-if="revisiting" class="mt-4 rounded-xl bg-paper-deep/55 p-3"><p class="mb-2 text-xs text-ink-soft">旧认识已暂时收起。写下你现在的回答：</p><textarea v-model="freshAnswer" rows="4" class="w-full resize-y rounded-lg bg-paper px-3 py-2 text-sm text-ink outline-none" placeholder="此刻我认为…" /><div class="mt-2 flex items-center gap-3"><button class="rounded-full bg-bamboo px-3 py-1.5 text-xs text-paper disabled:opacity-40" :disabled="!freshAnswer.trim()" @click="saveRevisit">保存新认识</button><button class="text-xs text-ink-soft hover:text-ink" @click="revisiting = false">返回旧认识</button></div></div>
              <button v-if="selected.revisions.length" class="mt-4 block text-xs text-ink-soft hover:text-bamboo" @click="showHistory = !showHistory">{{ showHistory ? '收起' : '展开' }}年轮 · {{ selected.revisions.length }} 次旧认识</button>
              <div v-if="showHistory" class="mt-3 space-y-3 border-l border-bamboo/25 pl-3"><div v-for="revision in [...selected.revisions].reverse()" :key="revision.savedAt" class="text-xs leading-6 text-ink-soft"><span class="text-dusk">{{ revision.savedAt.slice(0, 10) }}</span><p class="whitespace-pre-wrap">{{ revision.summary }}</p></div></div>
            </div>

            <div class="mt-7 border-t border-line pt-5">
              <div class="flex items-center justify-between"><span class="knowledge-eyebrow">觉悟来处 · {{ selectedEvidence.length }}</span><button class="text-xs text-bamboo hover:underline" @click="pickingNote = !pickingNote">＋ 归入觉悟</button></div>
              <div v-if="pickingNote" class="mt-3 rounded-xl border border-line bg-paper-deep/35 p-3">
                <input v-model="noteSearch" class="w-full rounded-lg bg-paper px-3 py-2 text-xs text-ink outline-none placeholder:text-dusk" placeholder="寻原文、心得或文档名" />
                <select v-model="noteRole" class="mt-2 w-full rounded-lg bg-paper px-3 py-2 text-xs text-ink outline-none"><option value="supports">印证</option><option value="extends">补充</option><option value="questions">存疑</option></select>
                <div class="mt-2 max-h-44 space-y-1 overflow-y-auto"><button v-for="note in availableNotes" :key="note.id" class="block w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-bamboo/10" @click="attach(note.id)"><span class="block truncate text-ink">{{ note.note || note.quote }}</span><span class="mt-1 block truncate text-dusk">{{ note.relativePath }}</span></button><p v-if="!availableNotes.length" class="py-3 text-center text-xs text-dusk">尚无可归入的觉悟</p></div>
              </div>
              <div class="mt-3 space-y-2"><div v-for="entry in selectedEvidence" :key="entry.noteId" class="knowledge-evidence rounded-xl p-3"><div class="flex items-center justify-between"><span class="text-[10px] tracking-wider text-bamboo">{{ EVIDENCE_LABEL[entry.role] }}</span><button class="text-dusk hover:text-sandal" title="移除关联" @click="run(() => knowledge.removeEvidence(selected!.id, entry.noteId), '关联已移除')"><ZIcon name="close" :size="12" /></button></div><p class="mt-1.5 line-clamp-3 text-xs leading-5 text-ink-soft">{{ entry.note?.note || entry.note?.quote }}</p><button class="mt-2 max-w-full truncate text-[11px] text-dusk hover:text-bamboo" @click="openNote(entry.note!.relativePath, entry.noteId)">{{ entry.note?.relativePath }} ↗</button></div><p v-if="!selectedEvidence.length" class="text-xs leading-6 text-dusk">把不同文章里的觉悟汇到这里，结论才有来处。</p></div>
            </div>

            <div class="mt-7 border-t border-line pt-5">
              <span class="knowledge-eyebrow">与别处相连 · {{ selectedRelations.length }}</span>
              <div class="mt-3 space-y-2"><div v-for="relation in selectedRelations" :key="relation.id" class="flex items-center gap-2 text-xs"><span class="rounded-full bg-bamboo/10 px-2 py-1 text-bamboo">{{ relation.kind === 'depends' && relation.toId === selectedId ? '支撑' : RELATION_LABEL[relation.kind] }}</span><button class="min-w-0 flex-1 truncate text-left text-ink-soft hover:text-bamboo" @click="selectTopic(relation.fromId === selectedId ? relation.toId : relation.fromId)">{{ topics.find((t) => t.id === (relation.fromId === selectedId ? relation.toId : relation.fromId))?.title }}</button><button title="断开关系" class="text-dusk hover:text-sandal" @click="run(() => knowledge.removeRelation(relation.id), '联系已断开')"><ZIcon name="close" :size="12" /></button></div><p v-if="!selectedRelations.length" class="text-xs text-dusk">还没有连到别的主题。</p></div>
              <div v-if="topics.length > 1" class="mt-4 grid grid-cols-[1fr_1fr_auto] gap-1.5"><select v-model="linkTarget" aria-label="要连接的主题" class="min-w-0 rounded-lg bg-paper-deep/70 px-2 py-2 text-xs text-ink outline-none"><option value="">选择主题</option><option v-for="topic in topics.filter((t) => t.id !== selectedId)" :key="topic.id" :value="topic.id">{{ topic.title }}</option></select><select v-model="linkKind" aria-label="关系类型" class="min-w-0 rounded-lg bg-paper-deep/70 px-2 py-2 text-xs text-ink outline-none"><option value="related">相关</option><option value="depends">依赖</option><option value="contrasts">相辨</option></select><button class="rounded-lg bg-bamboo/10 px-2 text-bamboo disabled:opacity-30" title="建立联系" :disabled="!linkTarget" @click="connect"><ZIcon name="plus" :size="14" /></button></div>
            </div>
          </template>
        </template>
        <template v-else><span class="knowledge-eyebrow">KNOWLEDGE ATLAS</span><h3 class="mt-4 font-serif text-xl">每个主题，都是一次主动理解。</h3><p v-if="suggestedNote" class="mt-3 text-sm leading-7 text-ink-soft">这则觉悟还没有主题承接。写下一个问题，把它变成知识图的起点。</p><p v-else class="mt-3 text-sm leading-7 text-ink-soft">从图中选一个主题，或写下新的问题。</p><button v-if="suggestedNote" class="mt-5 self-start rounded-full bg-bamboo px-4 py-2 text-xs text-paper" @click="creating = true">新建主题来归入</button></template>
      </aside>
    </main>
    <ConfirmDialog :open="deleting" title="释怀此主题" message="此主题的总结、年轮与关联将一起移除；原文和觉悟笔记仍在书库中。" confirm-label="释怀" @confirm="removeSelected" @close="deleting = false" />
  </div>
</template>

<style scoped>
.knowledge-page { background: radial-gradient(52rem 32rem at 48% -10%, color-mix(in srgb, var(--bamboo) 6%, transparent), transparent 75%), var(--paper); }
:global([data-theme='light']) .knowledge-page { --dusk: #727775; }
:global([data-theme='sepia']) .knowledge-page { --dusk: #80715f; }
:global([data-theme='dark']) .knowledge-page { --dusk: #989184; }
.knowledge-primary { box-shadow: 0 5px 18px color-mix(in srgb, var(--bamboo) 16%, transparent); }
.knowledge-filter { flex: none; border-radius: 999px; padding: 7px 13px; color: var(--ink-soft); transition: background .2s, color .2s; }
.knowledge-filter:hover { background: color-mix(in srgb, var(--bamboo) 8%, transparent); }
.knowledge-filter-on { background: color-mix(in srgb, var(--bamboo) 14%, transparent); color: var(--bamboo); }
.knowledge-canvas { background-image: radial-gradient(color-mix(in srgb, var(--ink) 10%, transparent) .6px, transparent .6px); background-size: 19px 19px; }
.knowledge-lane { border: 1px solid color-mix(in srgb, var(--bamboo) 14%, transparent); background: linear-gradient(160deg, color-mix(in srgb, var(--paper) 40%, transparent), color-mix(in srgb, var(--paper-deep) 32%, transparent)); }
.knowledge-node { z-index: 1; display: flex; flex-direction: column; width: 196px; height: 96px; border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); border-radius: 14px; padding: 11px 13px 10px; background: var(--paper); box-shadow: 0 3px 10px color-mix(in srgb, var(--ink) 4%, transparent), 0 14px 30px color-mix(in srgb, var(--ink) 4%, transparent); transition: transform .25s, border-color .25s, box-shadow .25s; }
.knowledge-node:hover { transform: translateY(-4px); border-color: color-mix(in srgb, var(--bamboo) 55%, transparent); }
.knowledge-node-on { border-color: var(--bamboo); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bamboo) 12%, transparent), 0 12px 25px color-mix(in srgb, var(--ink) 8%, transparent); }
.knowledge-node-index { font-family: Georgia, serif; font-size: 10px; letter-spacing: .12em; color: var(--bamboo); }
.knowledge-node-title { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; margin-top: 4px; font-family: var(--font-serif); font-size: 14px; line-height: 1.35; color: var(--ink); }
.knowledge-node-foot { display: flex; align-items: center; gap: 5px; margin-top: auto; font-size: 11px; color: var(--dusk); }
.knowledge-inspector { box-shadow: -14px 0 32px color-mix(in srgb, var(--ink) 2%, transparent); }
.knowledge-eyebrow { font-size: 10px; letter-spacing: .19em; color: var(--bamboo); }
.knowledge-field { display: block; font-size: 11px; letter-spacing: .08em; color: var(--ink-soft); }
.knowledge-field input, .knowledge-field textarea { display: block; width: 100%; margin-top: 9px; border: 1px solid var(--line); border-radius: 11px; background: color-mix(in srgb, var(--paper-deep) 36%, transparent); padding: 11px 12px; font-size: 13px; letter-spacing: normal; color: var(--ink); outline: none; }
.knowledge-field input:focus, .knowledge-field textarea:focus { border-color: var(--bamboo); }
.knowledge-evidence { border: 1px solid var(--line); background: color-mix(in srgb, var(--paper-deep) 36%, transparent); }
.knowledge-empty-mark { position: relative; width: 122px; height: 105px; }
.knowledge-empty-mark::before, .knowledge-empty-mark::after { content: ''; position: absolute; left: 24px; top: 46px; width: 80px; height: 1px; background: color-mix(in srgb, var(--bamboo) 45%, transparent); transform: rotate(-25deg); }
.knowledge-empty-mark::after { transform: rotate(36deg); }
.knowledge-empty-mark span { position: absolute; z-index: 1; width: 16px; height: 16px; border: 1px solid var(--bamboo); border-radius: 50%; background: var(--paper); }
.knowledge-empty-mark span:nth-child(1) { left: 15px; top: 64px; }.knowledge-empty-mark span:nth-child(2) { left: 98px; top: 27px; }.knowledge-empty-mark span:nth-child(3) { left: 86px; top: 83px; }.knowledge-empty-mark span:nth-child(4) { left: 43px; top: 11px; width: 24px; height: 24px; background: var(--bamboo); box-shadow: 0 0 0 8px color-mix(in srgb, var(--bamboo) 11%, transparent); }
@media (max-width: 980px) { .knowledge-main { flex-direction: column; overflow: auto; }.knowledge-main > section { min-height: 650px; }.knowledge-inspector { width: 100%; min-height: 340px; overflow: visible; border-top: 1px solid var(--line); border-left: 0; } }
@media (prefers-reduced-motion: reduce) { .knowledge-node, .knowledge-primary { transition: none; } }
</style>
