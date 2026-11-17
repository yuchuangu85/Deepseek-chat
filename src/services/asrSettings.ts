import { create } from 'zustand'

export type AsrFileFilter = 'all' | 'wav' | 'ogg'

type AsrSettings = {
  fileFilter: AsrFileFilter
  showDuration: boolean
  showRequestId: boolean
}

const STORAGE_KEY = 'chat-demo:asr-settings'
const defaults: AsrSettings = { fileFilter: 'all', showDuration: true, showRequestId: true }

const loadSettings = (): AsrSettings => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      const value = raw as Record<string, unknown>
      return {
        fileFilter:
          value.fileFilter === 'wav' || value.fileFilter === 'ogg' ? value.fileFilter : 'all',
        showDuration: typeof value.showDuration === 'boolean' ? value.showDuration : true,
        showRequestId: typeof value.showRequestId === 'boolean' ? value.showRequestId : true,
      }
    }
  } catch {
    // Unavailable or invalid storage falls back to defaults.
  }
  return defaults
}

export const useAsrSettings = create<AsrSettings>(() => loadSettings())

export const updateAsrSettings = (patch: Partial<AsrSettings>) => {
  useAsrSettings.setState(patch)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(useAsrSettings.getState()))
  } catch {
    // The current settings remain available in memory.
  }
}
