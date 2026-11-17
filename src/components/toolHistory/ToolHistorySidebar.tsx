import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../services/settings.js'
import {
  useToolHistory,
  initToolHistory,
  setToolHistoryEnabled,
  deleteToolHistory,
  clearToolHistory,
  selectToolHistory,
  type ToolHistoryKind,
} from '../../services/toolHistory.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconCloseOutline16, IconTrashOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import styles from './ToolHistorySidebar.module.css'

const messages = {
  'zh-CN': {
    searchTitle: '搜索历史',
    asrTitle: '转写历史',
    ttsTitle: '语音合成历史',
    close: '关闭历史侧边栏',
    enabled: '记录历史',
    disabledHint: '已关闭记录，现有历史仍会保留。',
    loading: '正在加载历史记录...',
    loadError: '历史记录加载失败。',
    operationError: '操作失败，请重试。',
    retry: '重试',
    empty: '暂无历史记录',
    delete: '删除记录',
    clear: '清空',
    clearTitle: '清空历史记录？',
    clearDescription: '仅清空当前工具的历史记录，此操作无法撤销。',
    cancel: '取消',
    confirm: '清空记录',
    unknownDate: '时间未知',
    stella: '海星',
    tide: '潮汐',
  },
  'en-US': {
    searchTitle: 'Search history',
    asrTitle: 'Transcription history',
    ttsTitle: 'Speech history',
    close: 'Close history sidebar',
    enabled: 'Save history',
    disabledHint: 'Recording is off. Existing history is kept.',
    loading: 'Loading history...',
    loadError: 'Could not load history.',
    operationError: 'Action failed. Please try again.',
    retry: 'Retry',
    empty: 'No history yet',
    delete: 'Delete entry',
    clear: 'Clear',
    clearTitle: 'Clear history?',
    clearDescription: 'Only this tool’s history will be cleared. This cannot be undone.',
    cancel: 'Cancel',
    confirm: 'Clear history',
    unknownDate: 'Unknown time',
    stella: 'Stella',
    tide: 'Tide',
  },
} as const

export const ToolHistorySidebar = ({
  kind,
  mobile = false,
  onClose,
  onSelect,
}: {
  kind: ToolHistoryKind
  mobile?: boolean
  onClose?: () => void
  onSelect?: () => void
}) => {
  const locale = useSettings((state) => state.locale)
  const text = messages[locale]
  const title =
    kind === 'search' ? text.searchTitle : kind === 'asr' ? text.asrTitle : text.ttsTitle
  const { entries, enabled, ready, error } = useToolHistory()
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [failure, setFailure] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const list = entries
    .filter((entry) => entry.kind === kind)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)

  const initialize = async () => {
    if (pendingRef.current) {
      return
    }
    pendingRef.current = true
    setPending(true)
    setFailure(false)
    try {
      if (!(await initToolHistory())) {
        setFailure(true)
      }
    } catch {
      setFailure(true)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  useEffect(() => {
    void initialize()
  }, [])

  const run = async (action: () => Promise<boolean>) => {
    if (pendingRef.current) {
      return
    }
    pendingRef.current = true
    setPending(true)
    setFailure(false)
    try {
      if (!(await action())) {
        setFailure(true)
      }
    } catch {
      setFailure(true)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <aside className={`${styles.sidebar} ${mobile ? styles.mobile : ''}`} aria-label={title}>
      <header className={styles.header}>
        <h2>{title}</h2>
        {onClose ? (
          <IconButton icon={<IconCloseOutline16 />} tooltip={text.close} onClick={onClose} />
        ) : null}
      </header>
      <div className={styles.setting}>
        <label className={styles.switchLabel}>
          <span>{text.enabled}</span>
          <input
            type="checkbox"
            role="switch"
            checked={enabled[kind]}
            disabled={!ready || pending}
            onChange={(event) =>
              void run(() => setToolHistoryEnabled(kind, event.currentTarget.checked))
            }
          />
        </label>
        {!enabled[kind] ? <p className={styles.hint}>{text.disabledHint}</p> : null}
      </div>
      {ready && (error || failure) && !confirming ? (
        <div className={styles.error} role="alert">
          <span>{text.operationError}</span>
          {error ? (
            <Button
              size="s"
              variant="outlined"
              disabled={pending}
              onClick={() => void initialize()}
            >
              {text.retry}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className={styles.listWrap}>
        {!ready ? (
          <div className={styles.state} role={error || failure ? 'alert' : 'status'}>
            <span>{error || failure ? text.loadError : text.loading}</span>
            {error || failure ? (
              <Button
                size="s"
                variant="outlined"
                disabled={pending}
                onClick={() => void initialize()}
              >
                {text.retry}
              </Button>
            ) : null}
          </div>
        ) : list.length === 0 ? (
          <div className={styles.state}>{text.empty}</div>
        ) : (
          <ul className={styles.list}>
            {list.map((entry) => {
              const content = entry.kind === 'search' ? entry.query : entry.text
              const date = new Date(entry.createdAt)
              const dateLabel = Number.isNaN(date.getTime())
                ? text.unknownDate
                : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
              const detail =
                entry.kind === 'asr'
                  ? [
                      entry.fileName,
                      entry.durationMs === null
                        ? null
                        : `${Math.floor(entry.durationMs / 60000)}:${String(Math.floor((entry.durationMs % 60000) / 1000)).padStart(2, '0')}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : entry.kind === 'tts'
                    ? text[entry.voice]
                    : ''
              return (
                <li key={entry.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.entry}
                    disabled={pending}
                    onClick={() => {
                      try {
                        selectToolHistory(entry)
                        onSelect?.()
                      } catch {
                        setFailure(true)
                      }
                    }}
                  >
                    <span className={styles.entryText}>{content}</span>
                    <span className={styles.metadata}>
                      {detail ? `${dateLabel} · ${detail}` : dateLabel}
                    </span>
                  </button>
                  <IconButton
                    className={styles.delete}
                    icon={<IconTrashOutline16 />}
                    tooltip={text.delete}
                    aria-label={`${text.delete}: ${content}`}
                    disabled={pending}
                    onClick={() => void run(() => deleteToolHistory(kind, entry.id))}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className={styles.footer}>
        <Button
          size="s"
          variant="dangerOutlined"
          disabled={!ready || pending || !list.length}
          onClick={() => {
            setFailure(false)
            setConfirming(true)
          }}
        >
          {text.clear}
        </Button>
      </div>
      {confirming ? (
        <Modal
          title={text.clearTitle}
          onClose={() => {
            if (!pendingRef.current) {
              setConfirming(false)
              setFailure(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={pending}
                onClick={() => {
                  setConfirming(false)
                  setFailure(false)
                }}
              >
                {text.cancel}
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    const success = await clearToolHistory(kind)
                    if (success) {
                      setConfirming(false)
                    }
                    return success
                  })
                }
              >
                {text.confirm}
              </Button>
            </>
          }
        >
          <p>{text.clearDescription}</p>
          {failure ? (
            <p className={styles.errorText} role="alert">
              {text.operationError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </aside>
  )
}
