import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../services/settings.js'
import { SearchApiError, searchWeb, type SearchResult } from '../../services/api/search.js'
import {
  addToolHistory,
  captureToolHistoryPermit,
  useToolHistory,
} from '../../services/toolHistory.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { IconCloseFill14, IconCopyOutline16, IconSearchOutline16 } from '../base/icons.js'
import styles from './SearchTool.module.css'

const messages = {
  'zh-CN': {
    title: '用 DeepSeek 搜索网页',
    subtitle: '从开放网络中发现信息和来源。',
    placeholder: '搜索网页...',
    submit: '搜索',
    clear: '清除搜索',
    empty: '搜索任何内容',
    hint: '输入问题，或试试下面的搜索。',
    results: '搜索结果',
    count: '条结果',
    loading: '正在搜索...',
    noResults: '没有找到相关结果',
    noResultsHint: '尝试减少关键词，或放宽站点、语言和日期条件。',
    failed: '搜索失败',
    retry: '重试',
    network: '无法连接搜索服务，请检查网络或服务端跨域配置。',
    timeout: '搜索超时，请重试。',
    missingKey: '请先在设置中添加 API Key。',
    invalidKey: 'API Key 无效，请在设置中更新。',
    balance: '账户余额不足。',
    limited: '请求过于频繁，请稍后重试。',
    more: '更多',
    less: '收起',
    summary: '摘要',
    copy: '复制链接',
    copied: '已复制',
    copyFailed: '复制失败',
    trusted: '可信来源',
    highTrust: '高可信来源',
    relevant: '高度相关',
    previous: '上一页',
    next: '下一页',
    page: '页',
    syntax: '搜索语法',
    close: '关闭',
    help: '组合关键词与以下操作符缩小搜索范围。',
    site: '限定站点',
    excludeSite: '排除站点',
    exclude: '排除词语',
    exact: '精确短语',
    excludePhrase: '排除精确短语',
    language: '限定语言',
    after: '指定日期之后',
    before: '指定日期之前',
    suggestions: [
      'site:deepseek.com API 文档',
      '开源大语言模型',
      'lang:en AI agent benchmarks',
      'after:2025 人工智能',
    ],
  },
  'en-US': {
    title: 'Search the web with DeepSeek',
    subtitle: 'Discover information and sources from the open web.',
    placeholder: 'Search the web...',
    submit: 'Search',
    clear: 'Clear search',
    empty: 'Search anything',
    hint: 'Ask a question, or start with one of these.',
    results: 'Results',
    count: 'results',
    loading: 'Searching...',
    noResults: 'No results found',
    noResultsHint: 'Try fewer words, or loosen the site, language, or date filters.',
    failed: 'Search failed',
    retry: 'Try again',
    network: 'Could not reach the search service. Check your connection or server CORS settings.',
    timeout: 'Search timed out. Please try again.',
    missingKey: 'Add an API key in Settings to search.',
    invalidKey: 'The API key is invalid. Update it in Settings.',
    balance: 'The account has insufficient balance.',
    limited: 'Too many requests. Please try again later.',
    more: 'More',
    less: 'Less',
    summary: 'Summary',
    copy: 'Copy link',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    trusted: 'Trusted source',
    highTrust: 'Highly trusted',
    relevant: 'Highly relevant',
    previous: 'Previous page',
    next: 'Next page',
    page: 'Page',
    syntax: 'Search syntax',
    close: 'Close',
    help: 'Combine keywords with these operators to narrow results.',
    site: 'Limit to a site',
    excludeSite: 'Exclude a site',
    exclude: 'Exclude a term',
    exact: 'Exact phrase',
    excludePhrase: 'Exclude an exact phrase',
    language: 'Limit by language',
    after: 'After a date',
    before: 'Before a date',
    suggestions: [
      'site:deepseek.com API docs',
      'open source LLM',
      'lang:en AI agent benchmarks',
      'after:2025 artificial intelligence',
    ],
  },
} as const

const PAGE_SIZE = 10
type Status = 'idle' | 'loading' | 'success' | 'error'

const formatDate = (date: string | null, locale: string) => {
  if (!date) {
    return ''
  }
  const value = new Date(date)
  return Number.isNaN(value.getTime())
    ? ''
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(value)
}

const Result = ({ result, index }: { result: SearchResult; index: number }) => {
  const locale = useSettings((state) => state.locale)
  const m = messages[locale]
  const [expanded, setExpanded] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copyState === 'idle') {
      return
    }
    const timer = window.setTimeout(() => setCopyState('idle'), 1600)
    return () => window.clearTimeout(timer)
  }, [copyState])
  const host = new URL(result.url).hostname
  const source = result.siteName || host
  const date = formatDate(result.date, locale)
  const summaryId = `search-summary-${index}`
  return (
    <li className={styles.result}>
      <div className={styles.source}>
        <span className={styles.monogram}>{Array.from(source)[0]?.toUpperCase()}</span>
        <strong>{source}</strong>
        {result.siteName && host !== result.siteName ? <span>{host}</span> : null}
      </div>
      <h3 className={styles.resultTitle}>
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          {result.title}
        </a>
      </h3>
      {result.snippet ? <p className={styles.snippet}>{result.snippet}</p> : null}
      {result.summary && result.summary !== result.snippet ? (
        <>
          <button
            type="button"
            className={styles.more}
            aria-expanded={expanded}
            aria-controls={summaryId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? m.less : m.more} <span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button>
          <p className={styles.summary} id={summaryId} hidden={!expanded}>
            <strong>{m.summary}</strong> {result.summary}
          </p>
        </>
      ) : null}
      <div className={styles.meta}>
        {date ? <time dateTime={result.date ?? undefined}>{date}</time> : null}
        {result.authority >= 3 ? (
          <span className={styles.badge}>{result.authority >= 4 ? m.highTrust : m.trusted}</span>
        ) : null}
        {result.rerankScore >= 1.5 ? (
          <span className={styles.badge} title={String(result.rerankScore)}>
            {m.relevant}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.copy}
          title={m.copy}
          aria-label={
            copyState === 'idle' ? m.copy : copyState === 'copied' ? m.copied : m.copyFailed
          }
          onClick={() => {
            void copyText(result.url).then((ok) => setCopyState(ok ? 'copied' : 'failed'))
          }}
        >
          <IconCopyOutline16 />
          {copyState !== 'idle' ? (
            <span role="status">{copyState === 'copied' ? m.copied : m.copyFailed}</span>
          ) : null}
        </button>
      </div>
    </li>
  )
}

export const SearchTool = () => {
  const locale = useSettings((state) => state.locale)
  const apiKey = useSettings((state) => state.apiKey)
  const m = messages[locale]
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const resultsRef = useRef<HTMLElement>(null)
  const [help, setHelp] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const requestId = useRef(0)
  const selectedHistory = useToolHistory((state) => state.selection)
  const handledSelection = useRef(selectedHistory?.sequence ?? 0)
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))

  useEffect(
    () => () => {
      requestId.current += 1
      controllerRef.current?.abort()
    },
    []
  )
  useEffect(() => {
    if (!selectedHistory || selectedHistory.sequence === handledSelection.current) {
      return
    }
    handledSelection.current = selectedHistory.sequence
    if (selectedHistory.entry.kind !== 'search') {
      return
    }
    requestId.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setInput(selectedHistory.entry.query)
    setQuery('')
    setResults([])
    setPage(1)
    setStatus('idle')
    setError('')
    inputRef.current?.focus({ preventScroll: true })
  }, [selectedHistory])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') ||
        (event.key === '/' &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !target?.closest('input, textarea, select, [contenteditable="true"]'))
      ) {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      } else if (event.key === 'Escape') {
        setHelp(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const runSearch = async (raw: string) => {
    const value = Array.from(raw.trim()).slice(0, 128).join('')
    if (!value) {
      inputRef.current?.focus()
      return
    }
    if (!ensureApiKey()) {
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const id = ++requestId.current
    const historyPermit = await captureToolHistoryPermit('search')
    if (controller.signal.aborted || id !== requestId.current) {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
      return
    }
    let timedOut = false
    const timer = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 20000)
    const started = performance.now()
    setInput(value)
    setQuery(value)
    setResults([])
    setPage(1)
    setStatus('loading')
    setError('')
    try {
      const found = await searchWeb(useSettings.getState().apiKey ?? '', value, controller.signal)
      if (id !== requestId.current) {
        return
      }
      setResults(found)
      setElapsed(Math.round(performance.now() - started))
      setStatus('success')
      if (historyPermit.status === 'error') {
        showToast({ key: 'toolHistorySaveFailed' })
      } else if (historyPermit.status === 'ready') {
        void addToolHistory({ kind: 'search', query: value }, historyPermit.permit).then(
          (saved) => {
            if (saved === 'error') {
              showToast({ key: 'toolHistorySaveFailed' })
            }
          }
        )
      }
    } catch (cause) {
      if (id !== requestId.current || (controller.signal.aborted && !timedOut)) {
        return
      }
      const failure = cause instanceof SearchApiError ? cause : null
      const message = timedOut
        ? m.timeout
        : failure?.status === 401
          ? m.invalidKey
          : failure?.status === 402
            ? m.balance
            : failure?.status === 429
              ? m.limited
              : failure?.code === 'network_error'
                ? m.network
                : failure?.message || m.failed
      setError(message)
      setStatus('error')
    } finally {
      window.clearTimeout(timer)
      if (id === requestId.current) {
        controllerRef.current = null
      }
    }
  }

  const goToPage = (next: number) => {
    setPage(next)
    resultsRef.current?.focus({ preventScroll: true })
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const operators = [
    ['site:', m.site],
    ['-site:', m.excludeSite],
    ['-', m.exclude],
    ['""', m.exact],
    ['-""', m.excludePhrase],
    ['lang:', m.language],
    ['after:', m.after],
    ['before:', m.before],
  ] as const
  const insertOperator = (operator: string) => {
    const element = inputRef.current
    const start = element?.selectionStart ?? input.length
    const end = element?.selectionEnd ?? start
    const prefix = input.slice(0, start)
    const inserted = `${prefix && !/\s$/.test(prefix) ? ' ' : ''}${operator}`
    setInput((prefix + inserted + input.slice(end)).slice(0, 128))
    requestAnimationFrame(() => {
      element?.focus()
      const caret = start + inserted.length - (operator === '""' || operator === '-""' ? 1 : 0)
      element?.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={`${styles.hero} ${status !== 'idle' ? styles.compact : ''}`}>
          <h1>{m.title}</h1>
          <p>{m.subtitle}</p>
          <form
            className={styles.form}
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              void runSearch(input)
            }}
          >
            <span className={styles.searchIcon}>
              <IconSearchOutline16 />
            </span>
            <input
              ref={inputRef}
              type="search"
              value={input}
              maxLength={128}
              placeholder={m.placeholder}
              aria-label={m.placeholder}
              onChange={(event) => setInput(event.target.value)}
            />
            {input ? (
              <button
                type="button"
                className={styles.clear}
                title={m.clear}
                aria-label={m.clear}
                onClick={() => {
                  setInput('')
                  inputRef.current?.focus()
                }}
              >
                <IconCloseFill14 />
              </button>
            ) : null}
            <button type="submit" className={styles.submit} disabled={status === 'loading'}>
              {m.submit}
            </button>
          </form>
          <div className={styles.helper}>
            <div className={styles.operators}>
              {operators.map(([operator, label]) => (
                <button
                  key={operator}
                  type="button"
                  title={label}
                  onClick={() => insertOperator(operator)}
                >
                  <code>{operator}</code>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.helpButton}
              aria-expanded={help}
              aria-controls="search-syntax"
              onClick={() => setHelp(!help)}
            >
              {m.syntax}
            </button>
            {help ? (
              <div className={styles.help} id="search-syntax" role="dialog" aria-label={m.syntax}>
                <div className={styles.helpHeading}>
                  <strong>{m.syntax}</strong>
                  <button
                    type="button"
                    title={m.close}
                    aria-label={m.close}
                    onClick={() => setHelp(false)}
                  >
                    <IconCloseFill14 />
                  </button>
                </div>
                <p>{m.help}</p>
                {operators.map(([operator, label]) => (
                  <div className={styles.helpRow} key={operator}>
                    <code>{operator}</code>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {!apiKey ? (
            <p className={styles.notice}>
              <button type="button" onClick={ensureApiKey}>
                {m.missingKey}
              </button>
            </p>
          ) : null}
        </section>
        <section
          ref={resultsRef}
          tabIndex={-1}
          className={styles.results}
          aria-live="polite"
          aria-busy={status === 'loading'}
        >
          {status === 'idle' ? (
            <div className={styles.state}>
              <span className={styles.stateIcon}>
                <IconSearchOutline16 />
              </span>
              <h2>{m.empty}</h2>
              <p>{m.hint}</p>
              <div className={styles.suggestions}>
                {m.suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => void runSearch(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {status === 'loading' ? (
            <div className={styles.state} role="status">
              {m.loading}
            </div>
          ) : null}
          {status === 'error' ? (
            <div className={styles.state} role="alert">
              <h2>{m.failed}</h2>
              <p>{error}</p>
              <button className={styles.retry} type="button" onClick={() => void runSearch(query)}>
                {m.retry}
              </button>
            </div>
          ) : null}
          {status === 'success' && results.length === 0 ? (
            <div className={styles.state}>
              <h2>{m.noResults}</h2>
              <p>{m.noResultsHint}</p>
            </div>
          ) : null}
          {status === 'success' && results.length > 0 ? (
            <>
              <div className={styles.resultsHead}>
                <h2>{m.results}</h2>
                <span>
                  {results.length} {m.count} · {query}
                </span>
                <span>{elapsed} ms</span>
              </div>
              <ol className={styles.resultList}>
                {results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((result, index) => (
                  <Result
                    key={`${result.url}-${(page - 1) * PAGE_SIZE + index}`}
                    result={result}
                    index={(page - 1) * PAGE_SIZE + index}
                  />
                ))}
              </ol>
              {pages > 1 ? (
                <nav className={styles.pagination} aria-label={m.results}>
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => goToPage(page - 1)}
                    aria-label={m.previous}
                  >
                    ‹
                  </button>
                  {Array.from({ length: pages }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-current={page === index + 1 ? 'page' : undefined}
                      onClick={() => goToPage(index + 1)}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={page === pages}
                    onClick={() => goToPage(page + 1)}
                    aria-label={m.next}
                  >
                    ›
                  </button>
                  <span>
                    {m.page} {page} / {pages}
                  </span>
                </nav>
              ) : null}
            </>
          ) : null}
        </section>
      </main>
    </div>
  )
}
