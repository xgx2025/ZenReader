export type ImportStatus =
  | 'pending'
  | 'reading'
  | 'parsing'
  | 'saving'
  | 'done'
  | 'skipped'
  | 'error'

export interface ImportItem {
  fileName: string
  folderPath: string
  status: ImportStatus
  error?: string
  /** 非错误的说明（如同名略过），展示在状态位。 */
  reason?: string
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: { fileName: string; reason: string }[]
}
