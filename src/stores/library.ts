import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { db } from '@/lib/db/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import type { Document, FolderNode } from '@/types/document'

type SortKey = 'lastOpenedAt' | 'updatedAt' | 'title'

export function buildFolderTree(documents: Document[]): FolderNode[] {
  const root: FolderNode[] = []
  const map = new Map<string, FolderNode>()

  const ensureNode = (path: string): FolderNode => {
    let node = map.get(path)
    if (node) return node
    const name = path.split('/').pop() ?? path
    node = { name, path, children: [], count: 0 }
    map.set(path, node)
    return node
  }

  for (const doc of documents) {
    const parts = doc.folderPath ? doc.folderPath.split('/').filter(Boolean) : []
    if (parts.length === 0) continue

    let siblings = root
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const node = ensureNode(currentPath)
      if (!siblings.includes(node)) siblings.push(node)
      siblings = node.children
    }

    const node = map.get(doc.folderPath)
    if (node) node.count += 1
  }

  return root
}

export const useLibraryStore = defineStore('library', () => {
  const documents = useLiveQuery<Document[]>(() => db.documents.toArray(), [])

  const search = ref('')
  const selectedFolder = ref('')
  const sortBy = ref<SortKey>('lastOpenedAt')

  const filtered = computed<Document[]>(() => {
    let docs = documents.value

    if (selectedFolder.value) {
      const prefix = `${selectedFolder.value}/`
      docs = docs.filter(
        (d) =>
          d.folderPath === selectedFolder.value ||
          d.folderPath.startsWith(prefix),
      )
    }

    const q = search.value.trim().toLowerCase()
    if (q) {
      docs = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.excerpt.toLowerCase().includes(q) ||
          d.plainText.toLowerCase().includes(q),
      )
    }

    return [...docs].sort((a, b) => {
      if (sortBy.value === 'title') {
        return a.title.localeCompare(b.title, 'zh')
      }
      return (b[sortBy.value] ?? '').localeCompare(a[sortBy.value] ?? '')
    })
  })

  const folderTree = computed<FolderNode[]>(() =>
    buildFolderTree(documents.value),
  )

  const totalCount = computed(() => documents.value.length)

  return {
    documents,
    search,
    selectedFolder,
    sortBy,
    filtered,
    folderTree,
    totalCount,
  }
})
