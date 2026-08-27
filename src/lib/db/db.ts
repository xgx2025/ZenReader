import Dexie, { type EntityTable } from 'dexie'

import type { Document } from '@/types/document'
import type { Note } from '@/types/note'

export const DB_NAME = 'zenreader'

export const db = new Dexie(DB_NAME) as Dexie & {
  documents: EntityTable<Document, 'id'>
  notes: EntityTable<Note, 'id'>
}

// v1: content tables. Folders are derived from `folderPath`, no separate table.
db.version(1).stores({
  documents: 'id, updatedAt, lastOpenedAt, title, folderPath',
  notes: 'id, documentId, createdAt',
})
