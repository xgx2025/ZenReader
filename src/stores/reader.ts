import { ref } from 'vue'
import { defineStore } from 'pinia'

import { documentRepo } from '@/lib/db/documents'
import type { Document } from '@/types/document'

export const useReaderStore = defineStore('reader', () => {
  const current = ref<Document | null>(null)
  const loading = ref(false)

  async function open(id: string): Promise<Document | null> {
    loading.value = true
    try {
      const doc = await documentRepo.get(id)
      current.value = doc ?? null
      if (doc) await documentRepo.touch(id)
      return doc ?? null
    } finally {
      loading.value = false
    }
  }

  function close() {
    current.value = null
  }

  return { current, loading, open, close }
})
