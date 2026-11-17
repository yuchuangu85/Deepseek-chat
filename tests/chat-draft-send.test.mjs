import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await mkdtemp(path.join(tmpdir(), 'ds-chat-draft-test-'))
execFileSync(process.execPath, [
  path.join(root, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noCheck',
  '--target', 'ESNext', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  '--outDir', temp, 'src/services/chat/store.ts',
], { cwd: root })
await symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'))
const storePath = path.join(temp, 'services/chat/store.js')
const code = (await readFile(storePath, 'utf8'))
  .replace("from '../api/client.js'", "from './test-client.js'")
  .replace("from './db.js'", "from './test-db.js'")
await writeFile(storePath, code)
await writeFile(path.join(temp, 'services/chat/test-client.js'), `
  export { ApiError } from '../api/client.js'
  export const streamMessage = (...args) => globalThis.__draftTest.stream(...args)
`)
await writeFile(path.join(temp, 'services/chat/test-db.js'), `
  export const saveSession = (...args) => globalThis.__draftTest.save(...args)
  export const reportStorageError = () => () => {}
`)
const load = (file) => import(pathToFileURL(path.join(temp, file)).href)
globalThis.__API_ORIGIN__ = 'https://api.test'
const store = await load('services/chat/store.js')
const drafts = await load('services/chat/drafts.js')
const { useUploads } = await load('services/attachments.js')
globalThis.document = { visibilityState: 'hidden' }
globalThis.cancelAnimationFrame = () => {}
const originalRevoke = URL.revokeObjectURL
let revoked
URL.revokeObjectURL = (url) => revoked.push(url)
const tick = () => new Promise((resolve) => setImmediate(resolve))
const finish = async () => {
  for (let i = 0; i < 8; i++) {
    await tick()
  }
}
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const attachment = (id) => ({
  id, file: new File([id], `${id}.png`, { type: 'image/png' }),
  isImage: true, previewUrl: `blob:${id}`,
})
const put = (key, text, files = []) => {
  drafts.useDrafts.setState((state) => ({
    drafts: new Map(state.drafts).set(key, { text, attachments: files }),
  }))
}

beforeEach(() => {
  store.useChatStore.setState({
    ready: true, importingHistory: false, sessions: [], sessionCache: {},
    sessionSaveErrors: {}, activeId: null, streaming: {},
  })
  drafts.useDrafts.setState({ drafts: new Map() })
  useUploads.setState({ tasks: {} })
  revoked = []
  globalThis.__draftTest = { save: async () => {}, stream: async function* () {} }
})

after(async () => {
  URL.revokeObjectURL = originalRevoke
  delete globalThis.__draftTest
  delete globalThis.__API_ORIGIN__
  delete globalThis.document
  delete globalThis.cancelAnimationFrame
  await rm(temp, { recursive: true, force: true })
})

test('isolated text and uploaded file are sent and persisted without touching the new-chat draft', async () => {
  const original = attachment('original')
  const tool = attachment('tool')
  put(null, 'my unsent draft', [original])
  put('tool-key', '  inspect this  ', [tool])
  useUploads.setState({ tasks: {
    original: { status: 'uploading' }, tool: { status: 'done', serverId: 'remote-tool' },
  } })
  const saves = []
  let request
  globalThis.__draftTest.save = async (...args) => { saves.push(args) }
  globalThis.__draftTest.stream = async function* (_key, body) { request = body; yield* [] }
  const originalDraft = drafts.getDraft(null)
  assert.equal(store.sendNewMessageFromDraft('tool-key'), true)
  assert.equal(store.sendNewMessageFromDraft('tool-key'), false)
  await finish()
  assert.equal(drafts.getDraft(null), originalDraft)
  assert.equal(useUploads.getState().tasks.original.status, 'uploading')
  assert.deepEqual(revoked, ['blob:tool'])
  assert.equal(drafts.useDrafts.getState().drafts.has('tool-key'), false)
  const session = store.useChatStore.getState().sessionCache[store.useChatStore.getState().activeId]
  assert.equal(session.messages[0].content, 'inspect this')
  assert.equal(session.messages[0].files[0].serverId, 'remote-tool')
  assert.ok(saves.some(([, files]) => files?.some((file) => file.blob === tool.file)))
  assert.ok(JSON.stringify(request.messages).includes('remote-tool'))
})

test('unready, importing, empty, uploading and failed uploads leave drafts untouched', () => {
  const file = attachment('tool')
  put(null, 'original', [attachment('original')])
  put('tool-key', 'text', [file])
  const draft = drafts.getDraft('tool-key')
  store.useChatStore.setState({ ready: false })
  assert.equal(store.sendNewMessageFromDraft('tool-key'), false)
  store.useChatStore.setState({ ready: true, importingHistory: true })
  assert.equal(store.sendNewMessageFromDraft('tool-key'), false)
  store.useChatStore.setState({ importingHistory: false })
  for (const task of [undefined, { status: 'uploading' }, { status: 'error' }, { status: 'done', serverId: '' }]) {
    useUploads.setState({ tasks: task ? { tool: task } : {} })
    assert.equal(store.sendNewMessageFromDraft('tool-key'), false)
  }
  assert.equal(store.sendNewMessageFromDraft('empty'), false)
  assert.equal(store.sendNewMessageFromDraft(null), false)
  assert.equal(drafts.getDraft('tool-key'), draft)
  assert.equal(drafts.getDraft(null).text, 'original')
  assert.deepEqual(revoked, [])
  assert.equal(store.useChatStore.getState().sessions.length, 0)
})

test('save and request failures retain the isolated draft and original draft', async () => {
  for (const failure of ['save', 'request']) {
    const key = `failure-${failure}`
    put(null, 'original')
    put(key, 'tool request')
    const draft = drafts.getDraft(key)
    globalThis.__draftTest.save = async () => {
      if (failure === 'save') {
        throw new Error('disk')
      }
    }
    globalThis.__draftTest.stream = async function* () {
      if (failure === 'request') {
        throw new Error('network')
      }
      yield* []
    }
    assert.equal(store.sendNewMessageFromDraft(key), true)
    await finish()
    assert.equal(drafts.getDraft(key), draft)
    assert.equal(drafts.getDraft(null).text, 'original')
  }
})

test('file-only drafts submit, but a failed final save retains the draft and attachment', async () => {
  const file = attachment('file-only')
  put('file-only-key', '', [file])
  useUploads.setState({ tasks: { 'file-only': { status: 'done', serverId: 'file-id' } } })
  let saves = 0
  globalThis.__draftTest.save = async () => {
    saves++
    if (saves >= 3) {
      throw new Error('final save failed')
    }
  }
  const draft = drafts.getDraft('file-only-key')
  assert.equal(store.sendNewMessageFromDraft('file-only-key'), true)
  await finish()
  assert.ok(saves >= 3)
  assert.equal(drafts.getDraft('file-only-key'), draft)
  assert.deepEqual(revoked, [])
})

test('stopping the reply retains the isolated draft', async () => {
  put('stopped-key', 'do not lose')
  globalThis.__draftTest.stream = async function* (_key, _body, signal) {
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    yield* []
    throw new DOMException('Aborted', 'AbortError')
  }
  assert.equal(store.sendNewMessageFromDraft('stopped-key'), true)
  await finish()
  store.stopReply(store.useChatStore.getState().activeId)
  await finish()
  assert.equal(drafts.getDraft('stopped-key').text, 'do not lose')
})

test('edits made while a request is running are never cleared on completion', async () => {
  const gate = deferred()
  put('tool-edit', 'before')
  globalThis.__draftTest.stream = async function* () { await gate.promise; yield* [] }
  assert.equal(store.sendNewMessageFromDraft('tool-edit'), true)
  await finish()
  drafts.setDraftText('tool-edit', 'after')
  gate.resolve()
  await finish()
  assert.equal(drafts.getDraft('tool-edit').text, 'after')
})

test('existing sendMessage still consumes the target session or null draft immediately', async () => {
  put(null, 'normal new chat')
  assert.equal(store.sendMessage(null), true)
  assert.equal(drafts.getDraft(null).text, '')
  const id = store.useChatStore.getState().activeId
  await finish()
  put(id, 'follow up')
  assert.equal(store.sendMessage(id), true)
  assert.equal(drafts.getDraft(id).text, '')
  await finish()
  assert.equal(store.useChatStore.getState().sessionCache[id].messages.filter((m) => m.role === 'user').length, 2)
})
