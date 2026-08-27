import { onScopeDispose, ref, type Ref } from 'vue'
import { liveQuery } from 'dexie'

/** Wrap Dexie `liveQuery` in a Vue ref that auto-syncs with IndexedDB. */
export function useLiveQuery<T>(querier: () => Promise<T>, initial: T): Ref<T> {
  const result = ref(initial) as Ref<T>

  const observable = liveQuery(querier)
  const subscription = observable.subscribe({
    next: (value) => {
      result.value = value
    },
    error: (err) => {
      console.error('[zenreader] liveQuery error', err)
    },
  })

  onScopeDispose(() => subscription.unsubscribe())

  return result
}
