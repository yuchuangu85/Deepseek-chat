import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const stub = `
  export const API_ORIGIN = 'https://asr.test'
  export class ApiError extends Error {
    constructor(kind, message) { super(message); this.kind = kind }
  }
  export const request = (...args) => globalThis.__asrTestRequest(...args)
`
const stubUrl = `data:text/javascript;base64,${Buffer.from(stub).toString('base64')}`
const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await mkdtemp(path.join(tmpdir(), 'ds-chat-asr-test-'))
let compiled
let compiledSettings
let compiledExport
try {
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--noCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--outDir',
      temp,
      'src/services/api/speech.ts',
      'src/services/asrSettings.ts',
      'src/services/speech/transcriptExport.ts',
    ],
    { cwd: root }
  )
  compiled = await readFile(path.join(temp, 'services/api/speech.js'), 'utf8')
  compiledSettings = await readFile(path.join(temp, 'services/asrSettings.js'), 'utf8')
  compiledExport = await readFile(path.join(temp, 'services/speech/transcriptExport.js'), 'utf8')
} finally {
  await rm(temp, { recursive: true, force: true })
}
assert.ok(compiled.includes("from './client.js'"))
const code = compiled.replace("from './client.js'", `from '${stubUrl}'`)
const { createTranscriptExport } = await import(
  `data:text/javascript;base64,${Buffer.from(compiledExport).toString('base64')}`
)
const { transcribe, transcribeWithDetails } = await import(
  `data:text/javascript,${encodeURIComponent(code)}`
)

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let settingsModuleId = 0
const loadSettings = async (storage) => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  assert.ok(compiledSettings.includes("from 'zustand'"))
  const settingsCode = compiledSettings.replace(
    "from 'zustand'",
    `from ${JSON.stringify(import.meta.resolve('zustand'))}`
  )
  const source = `data:text/javascript;base64,${Buffer.from(settingsCode).toString('base64')}#${settingsModuleId++}`
  return import(source)
}

after(() => {
  if (storageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
  } else {
    delete globalThis.localStorage
  }
  delete globalThis.__asrTestRequest
})

test('TXT and Markdown exports preserve Unicode and line endings', async () => {
  const text = 'Hello\r\n中文 "quoted"\n# heading\n'
  for (const [format, type] of [
    ['txt', 'text/plain;charset=utf-8'],
    ['md', 'text/markdown;charset=utf-8'],
  ]) {
    const exported = createTranscriptExport(text, '访谈.ogg', format)
    assert.equal(exported.name, `访谈-transcript.${format}`)
    assert.equal(exported.blob.type, type)
    assert.equal(await exported.blob.text(), text)
  }
})

test('JSON export contains only the original transcript text', async () => {
  const text = '中文\n"quoted"'
  const exported = createTranscriptExport(text, 'audio.wav', 'json')
  assert.equal(exported.name, 'audio-transcript.json')
  assert.equal(exported.blob.type, 'application/json;charset=utf-8')
  assert.deepEqual(JSON.parse(await exported.blob.text()), { text })
})

test('export filenames are bounded and do not contain unsafe path characters', () => {
  const exported = createTranscriptExport('text', `../../${'长'.repeat(100)}?.wav`, 'txt')
  assert.ok(!/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(exported.name))
  assert.ok(!exported.name.startsWith('.'))
  assert.ok(Array.from(exported.name).length <= 95)
  assert.ok(Buffer.byteLength(exported.name, 'utf8') <= 180)
  const emoji = createTranscriptExport('text', `${'😀'.repeat(100)}.ogg`, 'json')
  assert.ok(Buffer.byteLength(emoji.name, 'utf8') <= 180)
  assert.ok(!createTranscriptExport('text', 'bad\u0085name.wav', 'txt').name.includes('\u0085'))
  assert.equal(createTranscriptExport('text', '.wav', 'txt').name, 'asr-transcript.txt')
})

test('recording sends a WAV filename, bearer token, and abort signal', async () => {
  const signal = new AbortController().signal
  globalThis.__asrTestRequest = async (url, init) => {
    assert.equal(url, 'https://asr.test/v1/tools/asr')
    assert.equal(init.method, 'POST')
    assert.deepEqual(init.headers, { Authorization: 'Bearer test-key' })
    assert.equal(init.signal, signal)
    assert.deepEqual(Array.from(init.body.keys()), ['file'])
    assert.equal(init.body.get('file').name, 'recording.wav')
    assert.equal(init.body.get('file').type, 'audio/wav')
    return new Response(JSON.stringify({ text: 'recognized', duration_ms: 1000 }))
  }
  assert.equal(
    await transcribe('test-key', new Blob(['wav'], { type: 'audio/wav' }), signal),
    'recognized'
  )
})

test('an uploaded Ogg file keeps its original filename and bytes', async () => {
  globalThis.__asrTestRequest = async (_url, init) => {
    const file = init.body.get('file')
    assert.equal(file.name, 'sample.ogg')
    assert.equal(file.type, 'audio/ogg')
    assert.equal(await file.text(), 'ogg-data')
    return new Response(JSON.stringify({ text: 'ogg transcript', duration_ms: 1200 }))
  }
  assert.equal(
    await transcribe('key', new File(['ogg-data'], 'sample.ogg', { type: 'audio/ogg' })),
    'ogg transcript'
  )
})

test('empty recognition text is returned without inventing content', async () => {
  globalThis.__asrTestRequest = async () =>
    new Response(JSON.stringify({ text: '', duration_ms: 0 }))
  assert.equal(await transcribe('key', new Blob(['wav'])), '')
})

test('detailed responses expose the returned request ID and duration', async () => {
  globalThis.__asrTestRequest = async () =>
    new Response(JSON.stringify({ text: 'result', request_id: 'req-123', duration_ms: 3200 }))
  assert.deepEqual(await transcribeWithDetails('key', new Blob(['wav'])), {
    text: 'result',
    requestId: 'req-123',
    durationMs: 3200,
  })
})

test('missing or invalid details remain unavailable without changing the transcript', async () => {
  for (const [request_id, duration_ms] of [
    [null, null],
    ['', -1],
    [123, '3200'],
    [' ', 1.5],
  ]) {
    globalThis.__asrTestRequest = async () =>
      new Response(JSON.stringify({ text: 'result', request_id, duration_ms }))
    assert.deepEqual(await transcribeWithDetails('key', new Blob(['wav'])), {
      text: 'result',
      requestId: null,
      durationMs: null,
    })
  }
  globalThis.__asrTestRequest = async () =>
    new Response(JSON.stringify({ text: '', duration_ms: 0 }))
  assert.equal((await transcribeWithDetails('key', new Blob(['wav']))).durationMs, 0)
})

test('invalid response payloads are rejected as protocol errors', async () => {
  for (const body of ['not json', '{"duration_ms":100}', '{"text":123}']) {
    globalThis.__asrTestRequest = async () => new Response(body)
    await assert.rejects(transcribe('key', new Blob(['wav'])), (error) => error.kind === 'protocol')
  }
})

test('aborted requests propagate cancellation', async () => {
  globalThis.__asrTestRequest = async (_url, init) => {
    assert.equal(init.signal.aborted, true)
    throw new DOMException('Aborted', 'AbortError')
  }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(transcribe('key', new Blob(['wav']), controller.signal), {
    name: 'AbortError',
  })
})

test('ASR settings are persisted and restored', async () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const first = await loadSettings(storage)
  assert.deepEqual(first.useAsrSettings.getState(), {
    fileFilter: 'all',
    showDuration: true,
    showRequestId: true,
  })
  first.updateAsrSettings({ fileFilter: 'ogg', showDuration: false })
  assert.deepEqual(JSON.parse(values.get('chat-demo:asr-settings')), {
    fileFilter: 'ogg',
    showDuration: false,
    showRequestId: true,
  })
  const restored = await loadSettings(storage)
  assert.deepEqual(restored.useAsrSettings.getState(), {
    fileFilter: 'ogg',
    showDuration: false,
    showRequestId: true,
  })
})

test('invalid ASR settings use safe defaults', async () => {
  const settings = await loadSettings({
    getItem: () =>
      JSON.stringify({ fileFilter: 'bad', showDuration: 'false', showRequestId: false }),
    setItem: () => {},
  })
  assert.deepEqual(settings.useAsrSettings.getState(), {
    fileFilter: 'all',
    showDuration: true,
    showRequestId: false,
  })
  const malformed = await loadSettings({ getItem: () => '{', setItem: () => {} })
  assert.deepEqual(malformed.useAsrSettings.getState(), {
    fileFilter: 'all',
    showDuration: true,
    showRequestId: true,
  })
})

test('unavailable ASR settings storage keeps changes in memory', async () => {
  const unavailable = () => {
    throw new Error('storage blocked')
  }
  const settings = await loadSettings({ getItem: unavailable, setItem: unavailable })
  settings.updateAsrSettings({ fileFilter: 'wav', showRequestId: false })
  assert.deepEqual(settings.useAsrSettings.getState(), {
    fileFilter: 'wav',
    showDuration: true,
    showRequestId: false,
  })
})
