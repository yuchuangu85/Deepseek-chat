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
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionItem } from ${JSON.stringify(path.join(root, 'src/components/sider/SessionItem.tsx'))}
import styles from ${JSON.stringify(path.join(root, 'src/components/sider/SessionItem.module.css'))}
window.__menuCalls = []
const check = (condition, message) => { if (!condition) throw new Error(message) }
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const waitFor = async (read, message) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 16))
  }
  throw new Error(message)
}
const menuItem = label => [...document.querySelectorAll('[role="menuitem"]')]
  .find(element => element.textContent === label)
const openMenu = async () => {
  const trigger = await waitFor(() => document.querySelector('button[aria-label="More"]'), 'trigger missing')
  const action = trigger.closest('.' + styles.action)
  // Simulate row hover, then remove it while the portal remains open.
  action.style.display = 'flex'
  action.style.visibility = 'visible'
  trigger.click()
  await waitFor(() => document.querySelector('[role="menu"]'), 'menu missing')
  await settle()
  const before = document.querySelector('[role="menu"]').getBoundingClientRect()
  action.style.removeProperty('display')
  action.style.removeProperty('visibility')
  await settle()
  const after = document.querySelector('[role="menu"]').getBoundingClientRect()
  check(Math.abs(after.left - before.left) < 0.5 && Math.abs(after.top - before.top) < 0.5,
    'menu moved after leaving row: ' + JSON.stringify({ before: { left: before.left, top: before.top }, after: { left: after.left, top: after.top } }))
  check(trigger.getBoundingClientRect().width > 0, 'open trigger collapsed')
  check(getComputedStyle(trigger).visibility === 'visible', 'open trigger is hidden')
  check(trigger.getAttribute('aria-expanded') === 'true', 'open state is not exposed')
  check(trigger.getAttribute('aria-haspopup') === 'menu', 'menu relationship is not exposed')
}
const main = async () => {
  createRoot(document.querySelector('#root')).render(createElement(SessionItem, {
    session: { id: 'fixture', title: 'Chat title', createdAt: 1, updatedAt: 1 },
    active: false,
    onDelete: () => window.__menuCalls.push(['delete', 'fixture']),
  }))
  await openMenu()
  menuItem('Rename').click()
  const input = await waitFor(() => document.querySelector('input'), 'rename editor missing')
  input.value = 'Renamed chat'
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  check(JSON.stringify(window.__menuCalls) === JSON.stringify([['rename', 'fixture', 'Renamed chat']]), 'rename callback or propagation changed')
  await openMenu()
  menuItem('Delete').click()
  await settle()
  check(JSON.stringify(window.__menuCalls) === JSON.stringify([['rename', 'fixture', 'Renamed chat'], ['delete', 'fixture']]), 'delete callback or propagation changed')
  check(!document.querySelector('[role="menu"]'), 'selection did not close menu')
  await openMenu()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  check(!document.querySelector('[role="menu"]'), 'Escape did not close menu')
  await openMenu()
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await settle()
  check(!document.querySelector('[role="menu"]'), 'outside pointer did not close menu')
}
main().then(() => 'SESSION_MENU_PASS', error => 'SESSION_MENU_FAIL: ' + (error.stack || error))
  .then(result => fetch('/result', { method: 'POST', body: result }))
`

test(
  'session menu remains anchored after leaving an inactive row and preserves actions',
  { timeout: 60000 },
  async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'ds-chat-session-menu-'))
    let browser
    let server
    try {
      const entry = path.join(temp, 'entry.mjs')
      const stub = path.join(temp, 'stub.mjs')
      await writeFile(entry, browserTest)
      await writeFile(
        stub,
        `
export const renameSession = (...args) => window.__menuCalls.push(['rename', ...args])
export const selectSession = (...args) => window.__menuCalls.push(['select', ...args])
export const useTranslate = () => key => ({ more: 'More', sessionItemMenuRenameOption: 'Rename', delete: 'Delete' })[key] || key
`
      )
      const compiler = rspack({
        mode: 'development',
        devtool: false,
        entry,
        output: { path: temp, filename: 'bundle.js', cssFilename: 'style.css' },
        resolve: {
          modules: [path.join(root, 'node_modules'), 'node_modules'],
          extensions: ['.tsx', '.ts', '.js'],
          extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
          alias: { '../../services/chat/store.js$': stub, '../../i18n/index.js$': stub },
        },
        module: {
          parser: { 'css/module': { namedExports: false } },
          rules: [
            { test: /\.module\.css$/, type: 'css/module', use: ['builtin:lightningcss-loader'] },
            {
              test: /\.tsx?$/,
              loader: 'builtin:swc-loader',
              options: {
                jsc: {
                  parser: { syntax: 'typescript', tsx: true },
                  transform: { react: { runtime: 'automatic' } },
                },
              },
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
      const css = await readFile(path.join(temp, 'style.css'))
      let report
      const result = new Promise((resolve) => {
        report = resolve
      })
      server = createServer((request, response) => {
        if (request.url === '/result') {
          let body = ''
          request
            .setEncoding('utf8')
            .on('data', (chunk) => {
              body += chunk
            })
            .on('end', () => {
              response.end('ok')
              report(body)
            })
        } else if (request.url === '/bundle.js') {
          response.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle)
        } else if (request.url === '/style.css') {
          response.writeHead(200, { 'content-type': 'text/css' }).end(css)
        } else {
          response
            .writeHead(200, { 'content-type': 'text/html' })
            .end(
              '<!doctype html><style>:root{--ds-control-height-xs:28px}#root{width:240px;margin:100px 20px}</style><link rel="stylesheet" href="/style.css"><div id="root"></div><script defer src="/bundle.js"></script>'
            )
        }
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      browser = spawn(
        chrome,
        [
          '--headless',
          '--no-sandbox',
          '--disable-gpu',
          '--disable-background-networking',
          '--window-size=1440,900',
          `--user-data-dir=${path.join(temp, 'profile')}`,
          `http://127.0.0.1:${server.address().port}/`,
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
        assert.equal(await Promise.race([result, browserError, timeout]), 'SESSION_MENU_PASS')
      } finally {
        clearTimeout(timer)
      }
    } finally {
      if (browser && browser.exitCode === null) {
        browser.kill()
        await new Promise((resolve) => browser.once('exit', resolve))
      }
      if (server) {
        await new Promise((resolve) => server.close(resolve))
      }
      await rm(temp, { recursive: true, force: true })
    }
  }
)
