import { db } from './db'
import type { Document } from '@/types/document'

export const documentRepo = {
  add(doc: Document) {
    return db.documents.add(doc)
  },

  bulkAdd(docs: Document[]) {
    return db.documents.bulkAdd(docs)
  },

  get(id: string) {
    return db.documents.get(id)
  },

  getAll() {
    return db.documents.toArray()
  },

  count() {
    return db.documents.count()
  },

  update(id: string, changes: Partial<Document>) {
    return db.documents.update(id, changes)
  },

  remove(id: string) {
    return db.documents.delete(id)
  },

  async touch(id: string) {
    return db.documents.update(id, { lastOpenedAt: new Date().toISOString() })
  },
}
