import { ref } from 'vue'

import { isTauri, openExternal } from '@/lib/native'
import {
  RELEASE_PAGE,
  getAppVersion,
  fetchLatest,
  isNewerVersion,
} from '@/lib/update'
import { COPY } from '@/lib/copy'
import { useToast } from '@/composables/useToast'

/** 模块级单例：检查状态全局一份，设置面板与启动检查共用。 */
const checking = ref(false)
const currentVersion = ref<string | null>(null)

/**
 * 更新检查：拉 GitHub 最新发布版与本版比对。
 * - 发现新版：带「前往」动作的轻提示，点击开发布页
 * - 已最新 / 尚无发布 / 网络失败：仅手动检查时说一声，自动检查完全无感
 */
export function useUpdateCheck() {
  const { notify } = useToast()

  async function checkUpdate(manual: boolean): Promise<void> {
    if (!isTauri() || checking.value) return
    checking.value = true
    try {
      const current = currentVersion.value ?? (await getAppVersion())
      if (current) currentVersion.value = current

      const latest = await fetchLatest()
      if (!latest) {
        if (manual) notify(COPY.noReleaseYet, 'dusk')
        return
      }
      if (isNewerVersion(latest, current ?? '')) {
        notify(`${COPY.updateAvailable} v${latest}`, 'bamboo', {
          label: COPY.updateGoFetch,
          onClick: () => openExternal(RELEASE_PAGE),
        })
      } else if (manual) {
        notify(COPY.upToDate, 'bamboo')
      }
    } catch {
      if (manual) notify(COPY.updateCheckFailed, 'sandal')
    } finally {
      checking.value = false
    }
  }

  return { checking, currentVersion, checkUpdate }
}
