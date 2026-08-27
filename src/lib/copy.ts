/**
 * Poetic microcopy — centralized so the "禅" voice stays consistent.
 * (设置→调适, 收藏/书签→驻足, 删除→释怀, 导入→引卷, 文件夹导入→拾整卷,
 *  笔记→觉悟, 禅模式→禅境, 搜索→寻)
 */
export const COPY = {
  appName: '禅阅读',
  appNameLatin: 'ZenReader',
  tagline: '阅·见本心',

  library: '书库',
  import: '引卷',
  importFolder: '拾整卷',
  settings: '调适',
  bookmark: '驻足',
  delete: '释怀',
  note: '觉悟',
  zenMode: '禅境',
  search: '寻',
  toc: '目录',
  notes: '觉悟笔记',

  emptyLibrary: '尚无书籍，静候墨香',
  emptyNotes: '尚无觉悟，静待花开',

  selectionHighlight: '驻足',
  selectionNote: '写下觉悟',
  notePlaceholder: '用你自己的话，写下此刻所悟…',
  save: '存',
  cancel: '罢',

  words: '字',
  minutes: '分',

  importDropHint: '引卷于此 —— 拖入 .md 文件',
  importFileAction: '引卷（选择文件）',
  importFolderAction: '拾整卷（选择文件夹）',
  importDone: '已引入',
  importSkipped: '已略过',
} as const

export type CopyKey = keyof typeof COPY
