import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { nativeFs } from '@/lib/native'
import {
  folderPathFromRelative,
  resolveTitle,
  vaultFile,
  readNotesIndex,
  writeNotesIndex,
} from '@/lib/vault'
import { renderMarkdown } from '@/lib/markdown/parser'
import { parseFrontmatter } from '@/lib/markdown/frontmatter'
import { countWords, computeReadingTime, makeExcerpt } from '@/lib/markdown/structure'
import { useSettingsStore } from '@/stores/settings'
import { useProgressStore } from '@/stores/progress'
import type { VaultFile, FolderNode } from '@/types/document'

type SortKey = 'modified' | 'title'

/** Progressive-index metadata for a single file, filled in lazily. */
export interface IndexedMeta {
  title: string
  excerpt: string
  wordCount: number
  readingTime: number
}

function collectFolderPaths(nodes: FolderNode[], acc: string[]): void {
  for (const n of nodes) {
    acc.push(n.path)
    collectFolderPaths(n.children, acc)
  }
}

function sortNodes(nodes: FolderNode[]): void {
  nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  for (const n of nodes) sortNodes(n.children)
}

export function buildFolderTree(files: VaultFile[], dirs: string[]): FolderNode[] {
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

  // Establish all directory nodes first, so empty folders still show up.
  for (const dir of dirs) {
    const parts = dir.split('/').filter(Boolean)
    let siblings = root
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const node = ensureNode(currentPath)
      if (!siblings.includes(node)) siblings.push(node)
      siblings = node.children
    }
  }

  // Count files directly under each folder.
  for (const f of files) {
    const folder = folderPathFromRelative(f.relativePath)
    if (!folder) continue
    const node = ensureNode(folder)
    node.count += 1
  }

  sortNodes(root)
  return root
}

export const useLibraryStore = defineStore('library', () => {
  const settings = useSettingsStore()

  const files = ref<VaultFile[]>([])
  /** Directory paths (relative), including empty folders. */
  const dirs = ref<string[]>([])
  /** Lazy per-file metadata, keyed by relativePath. */
  const index = ref<Record<string, IndexedMeta>>({})
  const search = ref('')
  const selectedFolder = ref('')
  const sortBy = ref<SortKey>('modified')
  const loading = ref(false)

  let indexGen = 0

  const hasVault = computed(() => settings.vaultPath.length > 0)

  const totalCount = computed(() => files.value.length)

  const filtered = computed<VaultFile[]>(() => {
    let list = files.value

    if (selectedFolder.value) {
      const prefix = `${selectedFolder.value}/`
      list = list.filter((f) => {
        const folder = folderPathFromRelative(f.relativePath)
        return folder === selectedFolder.value || folder.startsWith(prefix)
      })
    }

    const q = search.value.trim().toLowerCase()
    if (q) {
      list = list.filter((f) => {
        const meta = index.value[f.relativePath]
        const title = meta?.title ?? resolveTitle({}, f.name)
        return (
          title.toLowerCase().includes(q) ||
          (meta?.excerpt ?? '').toLowerCase().includes(q)
        )
      })
    }

    return [...list].sort((a, b) => {
      if (sortBy.value === 'title') {
        const ta = index.value[a.relativePath]?.title ?? resolveTitle({}, a.name)
        const tb = index.value[b.relativePath]?.title ?? resolveTitle({}, b.name)
        return ta.localeCompare(tb, 'zh')
      }
      return b.mtime - a.mtime
    })
  })

  const folderTree = computed<FolderNode[]>(() =>
    buildFolderTree(files.value, dirs.value),
  )

  /** Every folder path in the vault, flattened (for "move to" picking). */
  const flatFolders = computed<string[]>(() => {
    const acc: string[] = []
    collectFolderPaths(folderTree.value, acc)
    return acc
  })

  async function refresh() {
    if (!hasVault.value) {
      files.value = []
      dirs.value = []
      index.value = {}
      return
    }
    loading.value = true
    try {
      const listing = await nativeFs.readVault(settings.vaultPath)
      files.value = listing.files
      dirs.value = listing.dirs
      index.value = {}
      indexVault(listing.files)
    } catch (e) {
      console.error('[zenreader] read_vault failed', e)
      files.value = []
      dirs.value = []
    } finally {
      loading.value = false
    }
  }

  async function openVault() {
    const dir = await nativeFs.pickFolder()
    if (!dir) return
    settings.setVaultPath(dir)
    await refresh()
  }

  /** Create a real directory (分组) inside the vault, then rescan. */
  async function createFolder(name: string) {
    const clean = name.trim()
    if (!clean || clean.includes('/') || clean.includes('\\')) return
    const parent = selectedFolder.value
    const relDir = parent ? `${parent}/${clean}` : clean
    await nativeFs.createDir(vaultFile(settings.vaultPath, relDir))
    await refresh()
  }

  /** Move a document's file on disk, migrating its notes to the new key. */
  async function moveDocument(from: string, to: string) {
    await nativeFs.moveFile(
      vaultFile(settings.vaultPath, from),
      vaultFile(settings.vaultPath, to),
    )
    const notes = await readNotesIndex(settings.vaultPath)
    if (notes[from]) {
      const moved = notes[from].map((n) => ({ ...n, relativePath: to }))
      notes[to] = [...(notes[to] ?? []), ...moved]
      delete notes[from]
      await writeNotesIndex(settings.vaultPath, notes)
    }
    useProgressStore().move(from, to) // reading position follows the file
    await refresh()
  }

  /** Delete a document's file on disk, dropping its notes + progress. */
  async function removeDocument(relativePath: string) {
    await nativeFs.deleteFile(vaultFile(settings.vaultPath, relativePath))
    const notes = await readNotesIndex(settings.vaultPath)
    if (notes[relativePath]) {
      delete notes[relativePath]
      await writeNotesIndex(settings.vaultPath, notes)
    }
    useProgressStore().drop(relativePath)
    await refresh()
  }

  /** Parse files one-by-one in the background, filling `index` as it goes. */
  async function indexVault(list: VaultFile[]) {
    const gen = ++indexGen
    for (const f of list) {
      if (gen !== indexGen) return // superseded by a newer refresh
      try {
        const source = await nativeFs.readFile(f.path)
        const { data, content } = parseFrontmatter(source)
        const { plainText } = renderMarkdown(content)
        const wordCount = countWords(plainText)
        index.value[f.relativePath] = {
          title: resolveTitle(data, f.name),
          excerpt: makeExcerpt(plainText),
          wordCount,
          readingTime: computeReadingTime(wordCount),
        }
      } catch {
        // leave unindexed; the card falls back to the file name
      }
      // Yield so the UI stays responsive during a large scan.
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  return {
    files,
    index,
    search,
    selectedFolder,
    sortBy,
    loading,
    hasVault,
    totalCount,
    filtered,
    folderTree,
    flatFolders,
    refresh,
    openVault,
    createFolder,
    moveDocument,
    removeDocument,
  }
})
