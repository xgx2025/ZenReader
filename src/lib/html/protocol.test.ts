import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'

import { isFrameEvent, isHostCommand, plainAnchorItems, PROTOCOL_VERSION } from './protocol'

describe('html/protocol · 信封与命令白名单', () => {
  it('宿主命令 / 帧事件的分类', () => {
    expect(isHostCommand('cmd.applyAnchors')).toBe(true)
    expect(isHostCommand('cmd.reportNow')).toBe(true)
    expect(isHostCommand('evt.ready')).toBe(false)
    expect(isFrameEvent('evt.scroll')).toBe(true)
    expect(isFrameEvent('evt.selection')).toBe(true)
    expect(isFrameEvent('cmd.setZoom')).toBe(false)
    expect(isHostCommand('garbage')).toBe(false)
    expect(isFrameEvent('garbage')).toBe(false)
  })

  it('版本固定为 1——信封契约不随改动漂移', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it('高亮数据跨 iframe 前去掉响应式代理', () => {
    const notes = reactive([{ noteId: 'n1', anchor: { quote: '一段原文', prefix: '前', suffix: '后', occurrence: 0 } }])
    expect(() => structuredClone(notes)).toThrow()
    expect(structuredClone(plainAnchorItems(notes))).toEqual([
      { noteId: 'n1', anchor: { quote: '一段原文', prefix: '前', suffix: '后', occurrence: 0 } },
    ])
  })
})
