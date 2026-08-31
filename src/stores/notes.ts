import { ref } from 'vue'
import { defineStore } from 'pinia'

import {
  addNote,
  deleteNote,
  listNotes,
  updateNote,
} from '@/lib/notesApi'
import { useSettingsStore } from '@/stores/settings'
import type { Note } from '@/types/note'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<Note[]>([])
  const relativePath = ref('')

  const settings = useSettingsStore()

  async function load(relPath: string) {
    relativePath.value = relPath
    notes.value = await listNotes(settings.vaultPath, relPath)
  }

  async function add(note: Note) {
    await addNote(settings.vaultPath, note)
    notes.value = await listNotes(settings.vaultPath, relativePath.value)
  }

  async function remove(id: string) {
    await deleteNote(settings.vaultPath, id)
    notes.value = notes.value.filter((n) => n.id !== id)
  }

  async function update(id: string, patch: Partial<Pick<Note, 'note' | 'kind'>>) {
    const ts = new Date().toISOString()
    await updateNote(
      settings.vaultPath,
      id,
      patch.note ?? null,
      patch.kind ?? null,
      ts,
    )
    notes.value = notes.value.map((n) =>
      n.id === id ? { ...n, ...patch, updatedAt: ts } : n,
    )
  }

  function clear() {
    notes.value = []
    relativePath.value = ''
  }

  return { notes, relativePath, load, add, update, remove, clear }
})
