import { ref } from 'vue'
import { defineStore } from 'pinia'

import { nativeKnowledge, nativeNotes } from '@/lib/native'
import { useSettingsStore } from '@/stores/settings'
import type { Note } from '@/types/note'
import {
  EMPTY_KNOWLEDGE_MAP,
  type EvidenceRole,
  type KnowledgeMapData,
  type KnowledgeRelationKind,
  type KnowledgeTopic,
} from '@/types/knowledge'

function parseMap(raw: string): KnowledgeMapData {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('知识图数据无法读取')
  const map = value as Partial<KnowledgeMapData>
  if (!Array.isArray(map.topics) || !Array.isArray(map.relations) || !Array.isArray(map.evidence)) {
    throw new Error('知识图数据格式无效')
  }
  return {
    topics: map.topics.map((topic) => ({ ...topic, revisions: topic.revisions ?? [] })),
    relations: map.relations,
    evidence: map.evidence,
  }
}

export const useKnowledgeStore = defineStore('knowledge', () => {
  const settings = useSettingsStore()
  const map = ref<KnowledgeMapData>(structuredClone(EMPTY_KNOWLEDGE_MAP))
  const notes = ref<Note[]>([])
  const loading = ref(false)
  const error = ref('')
  let loadedVault = ''
  let writeQueue: Promise<void> = Promise.resolve()

  async function load(force = false) {
    const vault = settings.vaultPath
    if (!vault) {
      map.value = structuredClone(EMPTY_KNOWLEDGE_MAP)
      notes.value = []
      loadedVault = ''
      return
    }
    if (!force && loadedVault === vault) return
    loading.value = true
    error.value = ''
    try {
      await writeQueue.catch(() => {})
      const [raw, allNotes] = await Promise.all([
        nativeKnowledge.load(vault),
        nativeNotes.listAll(vault),
      ])
      if (settings.vaultPath !== vault) return
      const parsed = parseMap(raw)
      const live = new Set(allNotes.map((note) => note.id))
      // A removed document takes its notes with it. Its old evidence must not linger.
      parsed.evidence = parsed.evidence.filter((entry) => live.has(entry.noteId))
      map.value = parsed
      notes.value = allNotes
      loadedVault = vault
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  function persist(): Promise<void> {
    const vault = settings.vaultPath
    const content = JSON.stringify(map.value)
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await nativeKnowledge.save(vault, content)
    })
    return writeQueue
  }

  function addTopic(title: string, domain: string): Promise<KnowledgeTopic> {
    const now = new Date().toISOString()
    const topic: KnowledgeTopic = {
      id: crypto.randomUUID(),
      title: title.trim(),
      domain: domain.trim() || '未分域',
      summary: '',
      createdAt: now,
      updatedAt: now,
      revisions: [],
    }
    map.value.topics.push(topic)
    return persist().then(() => topic)
  }

  function updateTopic(id: string, patch: Pick<KnowledgeTopic, 'title' | 'domain' | 'summary'>) {
    const topic = map.value.topics.find((item) => item.id === id)
    if (!topic) return Promise.resolve()
    const summary = patch.summary.trim()
    if (topic.summary && topic.summary !== summary) {
      topic.revisions.push({ summary: topic.summary, savedAt: topic.updatedAt })
    }
    topic.title = patch.title.trim()
    topic.domain = patch.domain.trim() || '未分域'
    topic.summary = summary
    topic.updatedAt = new Date().toISOString()
    return persist()
  }

  function removeTopic(id: string) {
    map.value.topics = map.value.topics.filter((item) => item.id !== id)
    map.value.relations = map.value.relations.filter((item) => item.fromId !== id && item.toId !== id)
    map.value.evidence = map.value.evidence.filter((item) => item.topicId !== id)
    return persist()
  }

  function addRelation(fromId: string, toId: string, kind: KnowledgeRelationKind) {
    if (fromId === toId || map.value.relations.some((item) =>
      item.kind === kind && (
        (item.fromId === fromId && item.toId === toId)
        || (kind !== 'depends' && item.fromId === toId && item.toId === fromId)
      ),
    )) return Promise.resolve()
    map.value.relations.push({ id: crypto.randomUUID(), fromId, toId, kind })
    return persist()
  }

  function removeRelation(id: string) {
    map.value.relations = map.value.relations.filter((item) => item.id !== id)
    return persist()
  }

  function addEvidence(topicId: string, noteId: string, role: EvidenceRole) {
    map.value.evidence = map.value.evidence.filter(
      (item) => !(item.topicId === topicId && item.noteId === noteId),
    )
    map.value.evidence.push({ topicId, noteId, role })
    return persist()
  }

  function removeEvidence(topicId: string, noteId: string) {
    map.value.evidence = map.value.evidence.filter(
      (item) => !(item.topicId === topicId && item.noteId === noteId),
    )
    return persist()
  }

  return {
    map, notes, loading, error, load, addTopic, updateTopic, removeTopic,
    addRelation, removeRelation, addEvidence, removeEvidence,
  }
})
