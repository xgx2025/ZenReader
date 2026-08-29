import { ref } from 'vue'
import { defineStore } from 'pinia'

import { readNotesIndex, writeNotesIndex } from '@/lib/vault'
import { useSettingsStore } from '@/stores/settings'
import type { Note } from '@/types/note'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<Note[]>([])
  const relativePath = ref('')

  const settings = useSettingsStore()

  async function load(relPath: string) {
    relativePath.value = relPath
    const index = await readNotesIndex(settings.vaultPath)
    notes.value = index[relPath] ?? []
  }

  async function add(note: Note) {
    const index = await readNotesIndex(settings.vaultPath)
    const list = [...(index[note.relativePath] ?? []), note]
    index[note.relativePath] = list
    await writeNotesIndex(settings.vaultPath, index)
    notes.value = list
  }

  async function remove(id: string) {
    const index = await readNotesIndex(settings.vaultPath)
    const list = (index[relativePath.value] ?? []).filter((n) => n.id !== id)
    index[relativePath.value] = list
    await writeNotesIndex(settings.vaultPath, index)
    notes.value = list
  }

  async function update(id: string, patch: Partial<Pick<Note, 'note' | 'kind'>>) {
    const ts = new Date().toISOString()
    const index = await readNotesIndex(settings.vaultPath)
    const list = (index[relativePath.value] ?? []).map((n) =>
      n.id === id ? { ...n, ...patch, updatedAt: ts } : n,
    )
    index[relativePath.value] = list
    await writeNotesIndex(settings.vaultPath, index)
    notes.value = list
  }

  function clear() {
    notes.value = []
    relativePath.value = ''
  }

  return { notes, relativePath, load, add, update, remove, clear }
})
