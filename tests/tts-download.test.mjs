import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const stub = `
  export const API_ORIGIN = 'https://tts.test'
  export class ApiError extends Error {
    constructor(kind, message) {
      super(typeof message === 'string' ? message : message.key)
      this.kind = kind
      this.localMessage = typeof message === 'object' ? message : undefined
    }
  }
  export const request = (...args) => globalThis.__ttsTestRequest(...args)
`
const stubUrl = `data:text/javascript;base64,${Buffer.from(stub).toString('base64')}`
const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await mkdtemp(path.join(tmpdir(), 'ds-chat-tts-test-'))
let compiled
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
      'src/services/speech/ttsDownload.ts',
    ],
    { cwd: root }
  )
  compiled = await readFile(path.join(temp, 'services/speech/ttsDownload.js'), 'utf8')
} finally {
  await rm(temp, { recursive: true, force: true })
}
assert.ok(compiled.includes("from '../api/client.js'"))
const code = compiled.replace("from '../api/client.js'", `from '${stubUrl}'`)
const { synthesizeWavDownload } = await import(`data:text/javascript,${encodeURIComponent(code)}`)

after(() => {
  delete globalThis.__ttsTestRequest
})

const makeWav = (samples = new Uint8Array([1, 2, 3, 4])) => {
  const bytes = new Uint8Array(44 + samples.length)
  const view = new DataView(bytes.buffer)
  const write = (offset, text) => {
    for (const [i, ch] of Array.from(text).entries()) bytes[offset + i] = ch.charCodeAt(0)
  }
  write(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 24000, true)
  view.setUint32(28, 48000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.length, true)
  bytes.set(samples, 44)
  return bytes
}

const wavResponse = (body, extra = {}) =>
  new Response(body, { headers: { 'Content-Type': 'audio/wav', ...extra } })
const signal = () => new AbortController().signal
const rejectsWith = (key) => (error) => error.kind === 'protocol' && error.localMessage?.key === key

test('requests WAV with the selected voice and preserves split response bytes', async () => {
  const bytes = makeWav()
  const controller = new AbortController()
  globalThis.__ttsTestRequest = async (url, init) => {
    assert.equal(url, 'https://tts.test/v1/tools/tts')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.Authorization, 'Bearer test-key')
    assert.equal(init.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(init.body), {
      text: 'Hello',
      voice_id: 'tide',
      format: 'wav',
      filter_markdown: true,
    })
    assert.equal(init.signal, controller.signal)
    return wavResponse(
      new ReadableStream({
        start(stream) {
          stream.enqueue(bytes.slice(0, 3))
          stream.enqueue(bytes.slice(3, 31))
          stream.enqueue(bytes.slice(31))
          stream.close()
        },
      })
    )
  }
  const blob = await synthesizeWavDownload('test-key', 'Hello', 'tide', controller.signal)
  assert.equal(blob.type, 'audio/wav')
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes)
})

test('rejects wrong MIME types, empty bodies, invalid WAV headers, and truncated data', async () => {
  const broken = makeWav()
  new DataView(broken.buffer).setUint32(40, 100, true)
  const truncatedRiff = makeWav()
  new DataView(truncatedRiff.buffer).setUint32(4, 100, true)
  const invalid = makeWav()
  invalid[0] = 0
  const oddPcm = makeWav(new Uint8Array([1, 2, 3]))
  const unknownOddPcm = makeWav(new Uint8Array([1, 2, 3]))
  new DataView(unknownOddPcm.buffer).setUint32(4, 0xffffffff, true)
  new DataView(unknownOddPcm.buffer).setUint32(40, 0xffffffff, true)
  const invalidAlignment = makeWav()
  new DataView(invalidAlignment.buffer).setUint16(32, 0, true)
  const responses = [
    new Response(makeWav(), { headers: { 'Content-Type': 'application/json' } }),
    wavResponse(new Uint8Array()),
    wavResponse(invalid),
    wavResponse(broken),
    wavResponse(truncatedRiff),
    wavResponse(makeWav(new Uint8Array())),
    wavResponse(oddPcm),
    wavResponse(unknownOddPcm),
    wavResponse(invalidAlignment),
  ]
  for (const response of responses) {
    globalThis.__ttsTestRequest = async () => response
    await assert.rejects(
      synthesizeWavDownload('key', 'text', 'stella', signal()),
      rejectsWith('toolTtsDownloadInvalid')
    )
  }
})

test('accepts WAV streaming-size markers without rewriting the file', async () => {
  for (const marker of [0xffffffff, 0x7fffffff]) {
    const bytes = makeWav()
    const view = new DataView(bytes.buffer)
    view.setUint32(4, marker, true)
    view.setUint32(40, marker, true)
    globalThis.__ttsTestRequest = async () => wavResponse(bytes)
    const blob = await synthesizeWavDownload('key', 'text', 'stella', signal())
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes)
  }
})

test('accepts valid WAV files with an odd-sized padded metadata chunk', async () => {
  const original = makeWav()
  const bytes = new Uint8Array(original.length + 10)
  bytes.set(original.slice(0, 12), 0)
  bytes.set([74, 85, 78, 75, 1, 0, 0, 0, 7, 0], 12)
  bytes.set(original.slice(12), 22)
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true)
  globalThis.__ttsTestRequest = async () => wavResponse(bytes)
  const blob = await synthesizeWavDownload('key', 'text', 'stella', signal())
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes)
})

test('an already aborted request cancels a late response', async () => {
  let cancelled = false
  const stream = new ReadableStream({
    cancel() {
      cancelled = true
    },
  })
  globalThis.__ttsTestRequest = async () => wavResponse(stream)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(synthesizeWavDownload('key', 'text', 'stella', controller.signal), {
    name: 'AbortError',
  })
  assert.equal(cancelled, true)
})

test('rejects oversized responses before reading them and cancels their stream', async () => {
  let cancelled = false
  const stream = new ReadableStream({
    cancel() {
      cancelled = true
    },
  })
  globalThis.__ttsTestRequest = async () =>
    wavResponse(stream, { 'Content-Length': String(128 * 1024 * 1024 + 1) })
  await assert.rejects(
    synthesizeWavDownload('key', 'text', 'stella', signal()),
    rejectsWith('toolTtsDownloadTooLarge')
  )
  assert.equal(cancelled, true)
})

test('aborted downloads cancel the active reader and do not return audio', async () => {
  let cancelled = false
  const controller = new AbortController()
  const stream = new ReadableStream({
    start(source) {
      source.enqueue(makeWav().slice(0, 12))
    },
    cancel() {
      cancelled = true
    },
  })
  globalThis.__ttsTestRequest = async () => wavResponse(stream)
  const pending = synthesizeWavDownload('key', 'text', 'stella', controller.signal)
  await new Promise((resolve) => setTimeout(resolve, 0))
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, true)
})

test('network stream failures propagate without producing a file', async () => {
  const stream = new ReadableStream({
    start(source) {
      source.enqueue(makeWav().slice(0, 20))
      setTimeout(() => source.error(new Error('connection lost')), 0)
    },
  })
  globalThis.__ttsTestRequest = async () => wavResponse(stream)
  await assert.rejects(synthesizeWavDownload('key', 'text', 'stella', signal()), /connection lost/)
})
