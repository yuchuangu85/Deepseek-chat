import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const jsx = require('react/jsx-runtime')
const directory = dirname(fileURLToPath(import.meta.url))
const temp = mkdtempSync(join(directory, '.test-'))
let compiled
try {
  execFileSync(process.execPath, [
    join(dirname(require.resolve('typescript/package.json')), 'bin/tsc'),
    '--ignoreConfig',
    '--noCheck',
    '--noResolve',
    '--target',
    'ES2022',
    '--module',
    'commonjs',
    '--jsx',
    'react-jsx',
    '--outDir',
    temp,
    join(directory, 'ToolHistorySidebar.tsx'),
  ])
  compiled = readFileSync(join(temp, 'ToolHistorySidebar.js'), 'utf8')
} finally {
  rmSync(temp, { recursive: true, force: true })
}

function fixture() {
  const state = {
    entries: [
      { id: 'old', kind: 'search', query: 'old query', createdAt: 1 },
      { id: 'speech', kind: 'tts', text: 'speech text', voice: 'tide', createdAt: 4 },
      { id: 'new', kind: 'search', query: 'new query', createdAt: 3 },
    ],
    enabled: { search: true, asr: true, tts: true },
    ready: true,
    error: false,
    selection: null,
  }
  const calls = []
  let result = true
  let slots = []
  let cursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = initial
      }
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value
        },
      ]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = { current: initial }
      }
      return slots[index]
    },
    useEffect() {},
  }
  const service = {
    useToolHistory: () => state,
    initToolHistory: async () => result,
    setToolHistoryEnabled: async (...args) => {
      calls.push(['enabled', ...args])
      return result
    },
    deleteToolHistory: async (...args) => {
      calls.push(['delete', ...args])
      return result
    },
    clearToolHistory: async (...args) => {
      calls.push(['clear', ...args])
      return result
    },
    selectToolHistory: (entry) => calls.push(['select', entry.id]),
  }
  const exports = {}
  const modules = {
    react: react,
    'react/jsx-runtime': jsx,
    '../../services/settings.js': { useSettings: (selector) => selector({ locale: 'en-US' }) },
    '../../services/toolHistory.js': service,
    '../base/Button.js': { Button: 'Button' },
    '../base/IconButton.js': { IconButton: 'IconButton' },
    '../base/icons.js': {
      IconPanelLeftOutline16: 'PanelLeftIcon',
      IconTrashOutline16: 'TrashIcon',
      IconSettingsOutline16: 'SettingsIcon',
    },
    '../../i18n/index.js': { useTranslate: () => (key) => key },
    '../settings/settingsDialogState.js': { openSettings: () => {} },
    '../base/Modal.js': { Modal: 'Modal' },
    './ToolHistorySidebar.module.css': { default: {} },
  }
  vm.runInNewContext(
    compiled,
    { exports, require: (id) => modules[id] },
    { filename: 'ToolHistorySidebar.js' }
  )
  return {
    calls,
    state,
    setResult: (value) => {
      result = value
    },
    render: (props = {}) => {
      cursor = 0
      return exports.ToolHistorySidebar({ kind: 'search', ...props })
    },
  }
}

function elements(node, predicate) {
  if (!node || typeof node !== 'object') {
    return []
  }
  const children = node.props?.children
  return [
    ...(predicate(node) ? [node] : []),
    ...(Array.isArray(children)
      ? children.flatMap((child) => elements(child, predicate))
      : elements(children, predicate)),
    ...elements(node.props?.footer, predicate),
  ]
}

const byType = (tree, type) => elements(tree, (node) => node.type === type)
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('filters and sorts history, selecting invokes selection callback', () => {
  const f = fixture()
  let closed = 0
  const tree = f.render({
    onSelect: () => {
      closed += 1
    },
  })
  const rows = byType(tree, 'li')
  assert.deepEqual(
    rows.map((row) => row.key),
    ['new', 'old']
  )
  byType(rows[0], 'button')[0].props.onClick()
  assert.deepEqual(f.calls, [['select', 'new']])
  assert.equal(closed, 1)
})

test('sidebar does not expose history settings and delete passes the current kind', async () => {
  const f = fixture()
  let tree = f.render()
  assert.equal(byType(tree, 'input').length, 0)
  const deleteButton = elements(
    tree,
    (node) => node.type === 'IconButton' && node.props['aria-label']?.startsWith('Delete entry')
  )[0]
  deleteButton.props.onClick()
  await flush()
  assert.deepEqual(f.calls, [['delete', 'search', 'new']])
})

test('sidebar does not expose a clear action', () => {
  const f = fixture()
  const tree = f.render()
  assert.equal(byType(tree, 'Button').some((button) => button.props.children === 'Clear'), false)
  assert.equal(byType(tree, 'Modal').length, 0)
})

test('loading and service errors offer a retry', () => {
  const f = fixture()
  f.state.ready = false
  assert.equal(elements(f.render(), (node) => node.props?.role === 'status').length, 1)
  f.state.error = true
  const tree = f.render()
  assert.equal(elements(tree, (node) => node.props?.role === 'alert').length, 1)
  assert.ok(byType(tree, 'Button').some((button) => button.props.children === 'Retry'))
})
