import { beforeEach, describe, expect, it } from 'vitest'
import { useGuide } from './useGuide'

let vaultNumber = 0

beforeEach(() => {
  localStorage.clear()
  vaultNumber++
  useGuide().setGuideScope(`test-vault-${vaultNumber}`)
})

describe('new user guide progress', () => {
  it('waits for the actual action and persists completed steps per vault', () => {
    const guide = useGuide()
    guide.beginGuide('import')
    guide.guideEvent('imported')
    expect(guide.stepIndex.value).toBe(0)

    guide.guideEvent('import-page')
    expect(guide.stepIndex.value).toBe(1)
    guide.nextGuide()
    expect(guide.stepIndex.value).toBe(2)
    guide.guideEvent('imported')
    expect(guide.stepIndex.value).toBe(3)
    guide.nextGuide()
    expect(guide.status.value.import).toBe('done')

    guide.suggestGuide('import')
    expect(guide.active.value).toBeNull()
    guide.beginGuide('import')
    expect(guide.active.value).toBe('import')
  })

  it('keeps the opening guide through the first vault selection', () => {
    const guide = useGuide()
    guide.setGuideScope('')
    guide.beginGuide('vault')
    guide.setGuideScope(`first-vault-${vaultNumber}`)
    guide.guideEvent('vault-opened')
    expect(guide.active.value).toBe('vault')
    expect(guide.stepIndex.value).toBe(1)
    guide.nextGuide()
    expect(guide.status.value.vault).toBe('done')
  })

  it('remembers a skip without blocking an explicit replay', () => {
    const guide = useGuide()
    guide.beginGuide('note')
    guide.finishGuide(true)
    guide.suggestGuide('note')
    expect(guide.active.value).toBeNull()
    guide.beginGuide('note')
    expect(guide.active.value).toBe('note')
  })
})
