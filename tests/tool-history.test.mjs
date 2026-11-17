import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'

const root = fileURLToPath(new URL('..', import.meta.url))
const chrome =
  process.env.CHROME_BIN ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'chromium')

const browserTest = `
import * as history from ${JSON.stringify(path.join(root, 'src/services/toolHistory.ts'))}
import * as other from ${JSON.stringify(path.join(root, 'src/services/toolHistory.ts') + '?other')}
const { initToolHistory, addToolHistory, setToolHistoryEnabled, deleteToolHistory,
  captureToolHistoryPermit, clearToolHistory, selectToolHistory, useToolHistory } = history
const state = () => useToolHistory.getState()
const check = (condition, message) => { if (!condition) throw new Error(message) }
const equal = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected),
  message + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected))
const capture = async (kind, source = history) => {
  const result = await source.captureToolHistoryPermit(kind)
  check(result.status === 'ready', kind + ' permit: ' + result.status)
  return result.permit
}
const open = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('chat-demo-tool-history', 1)
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
const readStore = async (store, key) => {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly')
      const request = tx.objectStore(store).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
const mutate = async (store, action) => {
  const db = await open()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      action(tx.objectStore(store))
      tx.oncomplete = resolve
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}
const main = async () => {
  check(await initToolHistory(), 'initialization')
  check(await initToolHistory(), 'idempotent initialization')
  equal(state().enabled, { search: true, asr: true, tts: true }, 'default enabled')
  equal(state().entries, [], 'initial entries')
  check(state().ready && !state().error, 'initial status')
  const initialSearchPermit = await capture('search')
  const initialAsrPermit = await capture('asr')
  const initialTtsPermit = await capture('tts')
  equal(await addToolHistory({ kind: 'search', query: 'query', audio: new Blob(['x']), apiKey: 'secret', requestId: 'request', content: 'page' }, initialSearchPermit), 'saved', 'search add')
  equal(await addToolHistory({ kind: 'asr', text: 'transcript', fileName: null, durationMs: null }, initialAsrPermit), 'saved', 'asr add')
  equal(await addToolHistory({ kind: 'tts', text: 'speech', voice: 'tide' }, initialTtsPermit), 'saved', 'tts add')
  let search = state().entries.find((entry) => entry.kind === 'search')
  equal(Object.keys(search).sort(), ['createdAt', 'id', 'kind', 'query'], 'whitelisted fields')
  selectToolHistory(search)
  const firstSequence = state().selection.sequence
  selectToolHistory(search)
  check(state().selection.sequence === firstSequence + 1, 'repeat selection sequence')
  check(await initToolHistory(), 'reload')
  check(state().entries.length === 3, 'entries persisted')
  check(await setToolHistoryEnabled('search', false), 'disable')
  equal(await addToolHistory({ kind: 'search', query: 'disabled' }, initialSearchPermit), 'disabled', 'disabled result')
  check(state().entries.length === 3, 'disable preserves entries')
  check(await initToolHistory() && !state().enabled.search, 'setting persisted')
  equal(await history.captureToolHistoryPermit('search'), { status: 'disabled' }, 'disabled permit setting=' + JSON.stringify(await readStore('settings', 'search')))
  check(await setToolHistoryEnabled('search', true), 're-enable')
  equal(await addToolHistory({ kind: 'search', query: 'old after re-enable' }, initialSearchPermit), 'disabled', 'old permit remains closed')
  const newSearchPermit = await capture('search')
  equal(await addToolHistory({ kind: 'search', query: 'new after re-enable' }, newSearchPermit), 'saved', 'new permit after re-enable')
  check(await deleteToolHistory('asr', search.id), 'wrong kind deletion')
  check(state().entries.some((entry) => entry.id === search.id), 'wrong kind retains entry')
  check(await deleteToolHistory('search', search.id), 'delete')
  check(!state().entries.some((entry) => entry.id === search.id), 'deleted')
  check(await clearToolHistory('asr'), 'clear asr')
  equal(state().entries.map((entry) => entry.kind), ['search', 'tts'], 'clear only matching kind')
  const beforeClearPermit = await capture('search')
  check(await clearToolHistory('search'), 'clear search')
  equal(await addToolHistory({ kind: 'search', query: 'old after clear' }, beforeClearPermit), 'disabled', 'clear invalidates permit')
  const afterClearPermit = await capture('search')
  equal(await addToolHistory({ kind: 'search', query: 'after clear' }, afterClearPermit), 'saved', 'new permit after clear')
  check(await setToolHistoryEnabled('search', false), 'disable before concurrent ordering')
  equal(await history.captureToolHistoryPermit('search'), { status: 'disabled' }, 'disabled after clear')
  check(await setToolHistoryEnabled('search', true), 're-enable before concurrent ordering')
  const concurrentPermit = await capture('search')
  const results = await Promise.all([
    addToolHistory({ kind: 'search', query: 'before clear' }, concurrentPermit),
    clearToolHistory('search'),
    addToolHistory({ kind: 'search', query: 'after clear' }, concurrentPermit),
    setToolHistoryEnabled('search', false),
    addToolHistory({ kind: 'search', query: 'after disable' }, concurrentPermit),
  ])
  equal(results, ['saved', true, 'disabled', true, 'disabled'], 'concurrent call ordering')
  equal(state().entries.filter((entry) => entry.kind === 'search').map((entry) => entry.query), [], 'no resurrection')
  check(await initToolHistory(), 'reload after concurrent changes')
  equal(state().entries.filter((entry) => entry.kind === 'search').map((entry) => entry.query), [], 'persisted ordering')
  check(await setToolHistoryEnabled('search', true), 're-enable after concurrent clear')
  const postConcurrentPermit = await capture('search')
  equal(await addToolHistory({ kind: 'search', query: 'post concurrent' }, postConcurrentPermit), 'saved', 'new permit after concurrent clear')
  check(await other.initToolHistory(), 'second instance initialized')
  const clearedAcrossInstancesPermit = await capture('tts', other)
  check(await other.clearToolHistory('tts'), 'cross-instance clear')
  equal(await addToolHistory({ kind: 'tts', text: 'old across instances', voice: 'stella' }, clearedAcrossInstancesPermit), 'disabled', 'cross-instance old permit')
  check(await setToolHistoryEnabled('tts', true), 're-enable after cross-instance clear')
  const competingPermit = await capture('tts', other)
  const [disableResult, competingAdd] = await Promise.all([
    other.setToolHistoryEnabled('tts', false),
    addToolHistory({ kind: 'tts', text: 'competing', voice: 'stella' }, competingPermit),
  ])
  check(disableResult && ['saved', 'disabled'].includes(competingAdd), 'cross-instance race resolves')
  check(await initToolHistory(), 'reload cross-instance race')
  check(!state().enabled.tts, 'cross-instance setting persisted')
  const competing = state().entries.filter((entry) => entry.kind === 'tts' && entry.text === 'competing')
  check(competing.length === (competingAdd === 'saved' ? 1 : 0), 'cross-instance add matches committed order')
  check(await setToolHistoryEnabled('tts', true), 'restore tts setting')
  const ttsPermit = await capture('tts')
  equal(await addToolHistory({ kind: 'tts', text: 'baseline tts', voice: 'stella' }, ttsPermit), 'saved', 'baseline tts')
  const ttsFailurePermit = await capture('tts')
  const before = JSON.stringify({ entries: state().entries, enabled: state().enabled })
  const originalOpen = indexedDB.open
  indexedDB.open = () => { throw new Error('open failed') }
  check(!(await initToolHistory()), 'open failure reported')
  equal(await addToolHistory({ kind: 'tts', text: 'fail', voice: 'stella' }, ttsFailurePermit), 'error', 'add fails closed')
  check(!(await setToolHistoryEnabled('tts', false)), 'setting failure reported')
  check(!(await deleteToolHistory('tts', state().entries[0].id)), 'delete failure reported')
  check(!(await clearToolHistory('tts')), 'clear failure reported')
  check(state().error && JSON.stringify({ entries: state().entries, enabled: state().enabled }) === before, 'failed operations preserve confirmed state')
  indexedDB.open = originalOpen
  check(await initToolHistory() && !state().error, 'retry after open failure')
  const originalAdd = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function (...args) {
    const request = originalAdd.apply(this, args)
    this.transaction.abort()
    return request
  }
  equal(await addToolHistory({ kind: 'tts', text: 'aborted', voice: 'stella' }, ttsFailurePermit), 'error', 'aborted transaction')
  IDBObjectStore.prototype.add = originalAdd
  check(JSON.stringify({ entries: state().entries, enabled: state().enabled }) === before, 'abort preserves state')
  check(await initToolHistory(), 'retry after abort')
  const originalPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args)
    this.transaction.abort()
    return request
  }
  check(!(await setToolHistoryEnabled('tts', false)), 'aborted setting transaction')
  IDBObjectStore.prototype.put = originalPut
  check(JSON.stringify({ entries: state().entries, enabled: state().enabled }) === before, 'setting abort preserves state')
  const originalDelete = IDBObjectStore.prototype.delete
  IDBObjectStore.prototype.delete = function (...args) {
    const request = originalDelete.apply(this, args)
    this.transaction.abort()
    return request
  }
  const tts = state().entries.find((entry) => entry.kind === 'tts')
  check(!(await deleteToolHistory('tts', tts.id)), 'aborted delete transaction')
  check(!(await clearToolHistory('tts')), 'aborted clear transaction')
  IDBObjectStore.prototype.delete = originalDelete
  check(JSON.stringify({ entries: state().entries, enabled: state().enabled }) === before, 'deletion abort preserves state')
  check(await initToolHistory(), 'retry after transaction aborts')
  check(JSON.stringify({ entries: state().entries, enabled: state().enabled }) === before, 'aborted changes absent from storage')
  await mutate('entries', (store) => store.put({ id: 'corrupt', kind: 'search', createdAt: 1, query: 'bad', apiKey: 'secret' }))
  check(!(await initToolHistory()), 'corrupt data rejected')
  equal(await addToolHistory({ kind: 'tts', text: 'no', voice: 'stella' }, ttsFailurePermit), 'error', 'corruption fails closed')
  check(JSON.stringify({ entries: state().entries, enabled: state().enabled }) === before, 'corruption preserves state')
  await mutate('entries', (store) => store.delete('corrupt'))
  check(await initToolHistory(), 'retry after corruption repaired')
  await mutate('settings', (store) => store.put({ kind: 'tts', enabled: 'yes' }))
  check(!(await initToolHistory()), 'corrupt setting rejected')
  await mutate('settings', (store) => store.delete('tts'))
  check(await initToolHistory(), 'retry after setting repaired')
  await mutate('settings', (store) => store.put({ kind: 'asr', enabled: true }))
  check(await initToolHistory(), 'legacy setting restored')
  const legacyAsrPermit = await capture('asr')
  equal(await addToolHistory({ kind: 'asr', text: 'legacy setting', fileName: null, durationMs: null }, legacyAsrPermit), 'saved', 'legacy setting accepted')
  equal(await addToolHistory({ kind: 'asr', text: 'invalid', fileName: null, durationMs: -1 }, legacyAsrPermit), 'error', 'invalid input rejected')
  check(await initToolHistory(), 'retry after invalid input')
}
main().then(() => 'TOOL_HISTORY_PASS', (error) => 'TOOL_HISTORY_FAIL: ' + (error.stack || error))
  .then((result) => fetch('/result', { method: 'POST', body: result }))
`

test('tool history persists and fails closed in real IndexedDB', { timeout: 60000 }, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'ds-chat-tool-history-'))
  let server
  let browser
  try {
    const entry = path.join(temp, 'entry.mjs')
    await writeFile(entry, browserTest)
    const compiler = rspack({
      mode: 'development',
      devtool: false,
      entry,
      output: { path: temp, filename: 'bundle.js' },
      resolve: { extensions: ['.ts', '.js'], extensionAlias: { '.js': ['.ts', '.js'] } },
      module: {
        rules: [
          {
            test: /\.ts$/,
            loader: 'builtin:swc-loader',
            options: { jsc: { parser: { syntax: 'typescript' } } },
          },
        ],
      },
    })
    const stats = await new Promise((resolve, reject) =>
      compiler.run((error, result) => (error ? reject(error) : resolve(result)))
    )
    await new Promise((resolve, reject) =>
      compiler.close((error) => (error ? reject(error) : resolve()))
    )
    assert.equal(stats.hasErrors(), false, stats.toString({ errors: true }))
    const bundle = await readFile(path.join(temp, 'bundle.js'))
    let report
    const result = new Promise((resolve) => {
      report = resolve
    })
    server = createServer((request, response) => {
      if (request.url === '/result' && request.method === 'POST') {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk) => {
          body += chunk
        })
        request.on('end', () => {
          response.end('ok')
          report(body)
        })
        return
      }
      if (request.url === '/bundle.js') {
        response.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle)
      } else {
        response
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<!doctype html><body>WAITING<script src="/bundle.js"></script></body>')
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/`
    browser = spawn(
      chrome,
      [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-background-networking',
        `--user-data-dir=${path.join(temp, 'profile')}`,
        url,
      ],
      { stdio: 'ignore' }
    )
    const browserError = new Promise((_, reject) => {
      browser.on('error', reject)
      browser.on('exit', (code) => reject(new Error(`Chrome exited before reporting: ${code}`)))
    })
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Browser test timed out')), 30000)
    })
    try {
      assert.equal(await Promise.race([result, browserError, timeout]), 'TOOL_HISTORY_PASS')
    } finally {
      clearTimeout(timer)
    }
  } finally {
    if (browser && browser.exitCode === null) {
      browser.kill()
      await new Promise((resolve) => browser.once('exit', resolve))
    }
    if (server) await new Promise((resolve) => server.close(resolve))
    await rm(temp, { recursive: true, force: true })
  }
})
