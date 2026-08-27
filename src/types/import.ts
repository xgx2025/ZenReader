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
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: { fileName: string; reason: string }[]
}
