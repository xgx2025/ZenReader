import { db } from './db'
import type { Note } from '@/types/note'

export const noteRepo = {
  add(note: Note) {
    return db.notes.add(note)
  },

  bulkAdd(notes: Note[]) {
    return db.notes.bulkAdd(notes)
  },

  byDocument(documentId: string) {
    return db.notes.where('documentId').equals(documentId).sortBy('createdAt')
  },

  async remove(id: string) {
    return db.notes.delete(id)
  },

  async removeByDocument(documentId: string) {
    return db.notes.where('documentId').equals(documentId).delete()
  },
}
