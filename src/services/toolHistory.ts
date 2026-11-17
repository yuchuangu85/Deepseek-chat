import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { create } from 'zustand'
import { createId } from '../utils/id.js'

export type ToolHistoryKind = 'search' | 'asr' | 'tts'
export type ToolHistoryEntry =
  | { id: string; kind: 'search'; createdAt: number; query: string }
  | {
      id: string
      kind: 'asr'
      createdAt: number
      text: string
      fileName: string | null
      durationMs: number | null
    }
  | { id: string; kind: 'tts'; createdAt: number; text: string; voice: 'stella' | 'tide' }
export type NewToolHistoryEntry =
  | { kind: 'search'; query: string }
  | { kind: 'asr'; text: string; fileName: string | null; durationMs: number | null }
  | { kind: 'tts'; text: string; voice: 'stella' | 'tide' }

export const TOOL_HISTORY_FORMAT_VERSION = 1
export type ToolHistoryArchive = {
  tool_history_format_version: typeof TOOL_HISTORY_FORMAT_VERSION
  entries: ToolHistoryEntry[]
  enabled: Record<ToolHistoryKind, boolean>
}

declare const permitBrand: unique symbol
export type ToolHistoryPermit = { readonly [permitBrand]: never }
export type ToolHistoryPermitResult =
  | { status: 'ready'; permit: ToolHistoryPermit }
  | { status: 'disabled' }
  | { status: 'error' }

type StoredSetting = { kind: ToolHistoryKind; enabled: boolean; generation?: number }
interface HistoryDB extends DBSchema {
  entries: { key: string; value: ToolHistoryEntry }
  settings: { key: ToolHistoryKind; value: StoredSetting }
}

type HistoryState = {
  entries: ToolHistoryEntry[]
  enabled: Record<ToolHistoryKind, boolean>
  ready: boolean
  error: boolean
  selection: { entry: ToolHistoryEntry; sequence: number } | null
}

const kinds: ToolHistoryKind[] = ['search', 'asr', 'tts']
const defaults = (): Record<ToolHistoryKind, boolean> => ({ search: true, asr: true, tts: true })
export const useToolHistory = create<HistoryState>(() => ({
  entries: [],
  enabled: defaults(),
  ready: false,
  error: false,
  selection: null,
}))

const isKind = (value: unknown): value is ToolHistoryKind => kinds.some((kind) => kind === value)
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const validGeneration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const readSetting = (value: unknown): Required<StoredSetting> => {
  if (
    !object(value) ||
    !isKind(value.kind) ||
    typeof value.enabled !== 'boolean' ||
    !Object.hasOwn(value, 'kind') ||
    !Object.hasOwn(value, 'enabled')
  ) {
    throw new Error('Invalid stored history setting')
  }
  const keys = Object.keys(value)
  const hasGeneration = Object.hasOwn(value, 'generation')
  if (
    keys.length !== (hasGeneration ? 3 : 2) ||
    (hasGeneration && !validGeneration(value.generation))
  ) {
    throw new Error('Invalid stored history generation')
  }
  return {
    kind: value.kind,
    enabled: value.enabled,
    generation: hasGeneration ? (value.generation as number) : 0,
  }
}

const permitDataKey = Symbol.for('ds-chat.tool-history.permit')
const makePermit = (kind: ToolHistoryKind, generation: number): ToolHistoryPermit =>
  Object.freeze(
    Object.defineProperty(Object.create(null), permitDataKey, {
      value: Object.freeze({ kind, generation }),
      enumerable: false,
    })
  ) as ToolHistoryPermit

const matchesPermit = (permit: unknown, kind: ToolHistoryKind, generation: number): boolean => {
  if (!object(permit) || Object.keys(permit).length !== 0) {
    return false
  }
  const data = (permit as Record<PropertyKey, unknown>)[permitDataKey]
  return (
    object(data) &&
    Object.keys(data).length === 2 &&
    data.kind === kind &&
    validGeneration(data.generation) &&
    data.generation === generation
  )
}

const nextGeneration = (generation: number): number => {
  if (generation >= Number.MAX_SAFE_INTEGER) {
    throw new Error('History generation exhausted')
  }
  return generation + 1
}

// Always construct a fresh whitelist: callers may pass extra fields at runtime.
const cleanInput = (value: unknown): NewToolHistoryEntry => {
  if (!object(value)) {
    throw new Error('Invalid history entry')
  }
  if (value.kind === 'search' && typeof value.query === 'string') {
    return { kind: 'search', query: value.query }
  }
  if (
    value.kind === 'asr' &&
    typeof value.text === 'string' &&
    (value.fileName === null || typeof value.fileName === 'string') &&
    (value.durationMs === null ||
      (typeof value.durationMs === 'number' &&
        Number.isFinite(value.durationMs) &&
        value.durationMs >= 0))
  ) {
    return { kind: 'asr', text: value.text, fileName: value.fileName, durationMs: value.durationMs }
  }
  if (
    value.kind === 'tts' &&
    typeof value.text === 'string' &&
    (value.voice === 'stella' || value.voice === 'tide')
  ) {
    return { kind: 'tts', text: value.text, voice: value.voice }
  }
  throw new Error('Invalid history entry')
}

const readEntry = (value: unknown): ToolHistoryEntry => {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0
  ) {
    throw new Error('Invalid stored history entry')
  }
  const input = cleanInput(value)
  const expected = input.kind === 'asr' ? 6 : input.kind === 'tts' ? 5 : 4
  if (Object.keys(value).length !== expected) {
    throw new Error('Unexpected stored history fields')
  }
  return { ...input, id: value.id, createdAt: value.createdAt }
}

/** Parse the portable history payload and reject unknown fields or unsafe values. */
export const readToolHistoryArchive = (value: unknown): ToolHistoryArchive => {
  if (
    !object(value) ||
    value.tool_history_format_version !== TOOL_HISTORY_FORMAT_VERSION ||
    !Array.isArray(value.entries) ||
    !object(value.enabled) ||
    Object.keys(value).length !== 3
  ) {
    throw new Error('Invalid tool history archive')
  }
  const enabled = value.enabled
  if (
    !object(enabled) ||
    Object.keys(enabled).length !== kinds.length ||
    kinds.some((kind) => typeof enabled[kind] !== 'boolean')
  ) {
    throw new Error('Invalid tool history settings')
  }
  const entries = value.entries.map(readEntry)
  const ids = new Set(entries.map((entry) => entry.id))
  if (ids.size !== entries.length) {
    throw new Error('Duplicate tool history entry')
  }
  return {
    tool_history_format_version: TOOL_HISTORY_FORMAT_VERSION,
    entries,
    enabled: {
      search: enabled.search as boolean,
      asr: enabled.asr as boolean,
      tts: enabled.tts as boolean,
    },
  }
}

const openHistory = (): Promise<IDBPDatabase<HistoryDB>> =>
  new Promise((resolve, reject) => {
    let blocked = false
    openDB<HistoryDB>('chat-demo-tool-history', 1, {
      upgrade(db) {
        db.createObjectStore('entries', { keyPath: 'id' })
        db.createObjectStore('settings', { keyPath: 'kind' })
      },
      blocked() {
        blocked = true
        reject(new Error('Tool history database is blocked'))
      },
      blocking(_current, _next, event) {
        ;(event.target as IDBDatabase).close()
      },
    }).then((db) => {
      if (blocked) {
        db.close()
      } else {
        resolve(db)
      }
    }, reject)
  })

let queue: Promise<void> = Promise.resolve()
const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
  const result = queue.then(work)
  queue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

type Change =
  | { type: 'load' }
  | { type: 'export' }
  | { type: 'import'; archive: ToolHistoryArchive }
  | { type: 'capture'; kind: ToolHistoryKind }
  | { type: 'add'; input: NewToolHistoryEntry; permit: ToolHistoryPermit | undefined }
  | { type: 'enabled'; kind: ToolHistoryKind; enabled: boolean }
  | { type: 'delete'; kind: ToolHistoryKind; id: string }
  | { type: 'clear'; kind: ToolHistoryKind }

type RunResult =
  | { status: 'saved' }
  | { status: 'disabled' }
  | { status: 'error' }
  | { status: 'ready'; permit: ToolHistoryPermit }
  | { status: 'exported'; archive: ToolHistoryArchive }
  | { status: 'imported'; count: number }

const run = async (change: Change): Promise<RunResult> => {
  let db: IDBPDatabase<HistoryDB> | undefined
  try {
    db = await openHistory()
    // The shared scope makes settings checks and changes atomic across connections too.
    const tx = db.transaction(['entries', 'settings'], 'readwrite')
    const done = tx.done
    try {
      const [rawEntries, rawSettings] = await Promise.all([
        tx.objectStore('entries').getAll(),
        tx.objectStore('settings').getAll(),
      ])
      let entries = rawEntries.map(readEntry)
      const enabled = defaults()
      const generations: Record<ToolHistoryKind, number> = { search: 0, asr: 0, tts: 0 }
      for (const setting of rawSettings as unknown[]) {
        const parsed = readSetting(setting)
        enabled[parsed.kind] = parsed.enabled
        generations[parsed.kind] = parsed.generation
      }
      let result: RunResult = { status: 'saved' }
      if (change.type === 'export') {
        result = {
          status: 'exported',
          archive: {
            tool_history_format_version: TOOL_HISTORY_FORMAT_VERSION,
            entries: entries.slice(),
            enabled: { ...enabled },
          },
        }
      } else if (change.type === 'import') {
        await tx.objectStore('entries').clear()
        await Promise.all(
          kinds.map((kind) =>
            tx.objectStore('settings').put({
              kind,
              enabled: change.archive.enabled[kind],
              generation: nextGeneration(generations[kind]),
            })
          )
        )
        await Promise.all(change.archive.entries.map((entry) => tx.objectStore('entries').add(entry)))
        entries = change.archive.entries.slice()
        for (const kind of kinds) {
          enabled[kind] = change.archive.enabled[kind]
        }
        result = { status: 'imported', count: entries.length }
      } else if (change.type === 'add') {
        const input = cleanInput(change.input)
        if (
          !enabled[input.kind] ||
          !matchesPermit(change.permit, input.kind, generations[input.kind])
        ) {
          result = { status: 'disabled' }
        } else {
          const entry: ToolHistoryEntry = { ...input, id: createId(), createdAt: Date.now() }
          await tx.objectStore('entries').add(entry)
          entries.push(entry)
        }
      } else if (change.type === 'capture') {
        if (!isKind(change.kind)) {
          throw new Error('Invalid history kind')
        }
        result = enabled[change.kind]
          ? { status: 'ready', permit: makePermit(change.kind, generations[change.kind]) }
          : { status: 'disabled' }
      } else if (change.type === 'enabled') {
        if (!isKind(change.kind) || typeof change.enabled !== 'boolean') {
          throw new Error('Invalid setting')
        }
        const generation = change.enabled
          ? generations[change.kind]
          : nextGeneration(generations[change.kind])
        await tx
          .objectStore('settings')
          .put({ kind: change.kind, enabled: change.enabled, generation })
        enabled[change.kind] = change.enabled
      } else if (change.type === 'delete' || change.type === 'clear') {
        if (!isKind(change.kind) || (change.type === 'delete' && typeof change.id !== 'string')) {
          throw new Error('Invalid deletion')
        }
        if (change.type === 'clear') {
          const generation = nextGeneration(generations[change.kind])
          await tx
            .objectStore('settings')
            .put({ kind: change.kind, enabled: enabled[change.kind], generation })
        }
        const removed = entries.filter(
          (entry) =>
            entry.kind === change.kind && (change.type === 'clear' || entry.id === change.id)
        )
        await Promise.all(removed.map((entry) => tx.objectStore('entries').delete(entry.id)))
        const ids = new Set(removed.map((entry) => entry.id))
        entries = entries.filter((entry) => !ids.has(entry.id))
      }
      await done
      entries.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      useToolHistory.setState({ entries, enabled, ready: true, error: false })
      return result
    } catch (error) {
      try {
        tx.abort()
      } catch {
        /* Already aborted or completed. */
      }
      await done.catch(() => undefined)
      throw error
    }
  } catch {
    useToolHistory.setState({ error: true })
    return { status: 'error' }
  } finally {
    db?.close()
  }
}

export const initToolHistory = (): Promise<boolean> =>
  enqueue(async () => (await run({ type: 'load' })).status !== 'error')
export const exportToolHistory = (): Promise<ToolHistoryArchive> =>
  enqueue(async () => {
    const result = await run({ type: 'export' })
    if (result.status === 'exported') {
      return result.archive
    }
    throw new Error('Tool history export failed')
  })
export const importToolHistory = (value: unknown): Promise<number> =>
  enqueue(async () => {
    const result = await run({ type: 'import', archive: readToolHistoryArchive(value) })
    if (result.status === 'imported') {
      return result.count
    }
    throw new Error('Tool history import failed')
  })
export const captureToolHistoryPermit = (kind: ToolHistoryKind): Promise<ToolHistoryPermitResult> =>
  enqueue(async () => {
    const result = await run({ type: 'capture', kind })
    if (result.status === 'ready' || result.status === 'disabled') {
      return result
    }
    return { status: 'error' }
  })
// oxlint-disable typescript/unified-signatures
export function addToolHistory(
  input: NewToolHistoryEntry,
  permit: ToolHistoryPermit
): Promise<'saved' | 'disabled' | 'error'>
export function addToolHistory(input: NewToolHistoryEntry): Promise<'saved' | 'disabled' | 'error'>
export function addToolHistory(
  input: NewToolHistoryEntry,
  permit?: ToolHistoryPermit
): Promise<'saved' | 'disabled' | 'error'> {
  return enqueue(async () => {
    const result = await run({ type: 'add', input, permit })
    if (result.status === 'saved' || result.status === 'disabled' || result.status === 'error') {
      return result.status
    }
    return 'error'
  })
}
// oxlint-enable typescript/unified-signatures
export const setToolHistoryEnabled = (kind: ToolHistoryKind, enabled: boolean): Promise<boolean> =>
  enqueue(async () => (await run({ type: 'enabled', kind, enabled })).status !== 'error')
export const deleteToolHistory = (kind: ToolHistoryKind, id: string): Promise<boolean> =>
  enqueue(async () => (await run({ type: 'delete', kind, id })).status !== 'error')
export const clearToolHistory = (kind: ToolHistoryKind): Promise<boolean> =>
  enqueue(async () => (await run({ type: 'clear', kind })).status !== 'error')

let selectionSequence = 0
export const selectToolHistory = (entry: ToolHistoryEntry): void => {
  const clean = readEntry(entry)
  useToolHistory.setState({ selection: { entry: clean, sequence: ++selectionSequence } })
}
