import { ref } from 'vue'
import { defineStore } from 'pinia'

import { noteRepo } from '@/lib/db/notes'
import type { Note } from '@/types/note'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<Note[]>([])
  const documentId = ref('')

  async function load(id: string) {
    documentId.value = id
    notes.value = await noteRepo.byDocument(id)
  }

  async function add(note: Note) {
    await noteRepo.add(note)
    notes.value = await noteRepo.byDocument(note.documentId)
  }

  async function remove(id: string) {
    await noteRepo.remove(id)
    if (documentId.value) {
      notes.value = await noteRepo.byDocument(documentId.value)
    }
  }

  function clear() {
    notes.value = []
    documentId.value = ''
  }

  return { notes, documentId, load, add, remove, clear }
})
