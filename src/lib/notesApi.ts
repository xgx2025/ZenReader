import { nativeNotes } from '@/lib/native'
import type { Note } from '@/types/note'

/**
 * 觉悟笔记的持久化入口：把书库根路径（vaultPath）与笔记操作绑定，
 * 具体读写落在 Rust 侧 SQLite（`.zenreader/notes.db`），不再是全量 JSON。
 */

/** 列出某篇文档的全部笔记。 */
export function listNotes(vaultPath: string, relativePath: string): Promise<Note[]> {
  return nativeNotes.list(vaultPath, relativePath)
}

/** 新增一条笔记。 */
export function addNote(vaultPath: string, note: Note): Promise<void> {
  return nativeNotes.add(vaultPath, note)
}

/** 更新一条笔记的文本与/或类型（`null` 表示不更新该字段），并刷新 updatedAt。 */
export function updateNote(
  vaultPath: string,
  id: string,
  noteText: string | null,
  kind: string | null,
  updatedAt: string,
): Promise<void> {
  return nativeNotes.update(vaultPath, id, noteText, kind, updatedAt)
}

/** 删除一条笔记。 */
export function deleteNote(vaultPath: string, id: string): Promise<void> {
  return nativeNotes.remove(vaultPath, id)
}

/** 文档移动后，把其名下笔记的路径改到新位置。 */
export function moveDocumentNotes(
  vaultPath: string,
  from: string,
  to: string,
): Promise<void> {
  return nativeNotes.moveDocument(vaultPath, from, to)
}

/** 删除文档时，清掉该文档名下全部笔记。 */
export function deleteDocumentNotes(
  vaultPath: string,
  relativePath: string,
): Promise<void> {
  return nativeNotes.deleteDocument(vaultPath, relativePath)
}
