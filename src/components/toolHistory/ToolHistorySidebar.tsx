import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../services/settings.js'
import {
  useToolHistory,
  initToolHistory,
  deleteToolHistory,
  selectToolHistory,
  type ToolHistoryEntry,
  type ToolHistoryKind,
} from '../../services/toolHistory.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconTrashOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import styles from './ToolHistorySidebar.module.css'

const messages = {
  'zh-CN': {
    searchTitle: '搜索历史',
    asrTitle: '转写历史',
    ttsTitle: '语音合成历史',
    loading: '正在加载历史记录...',
    loadError: '历史记录加载失败。',
    operationError: '操作失败，请重试。',
    retry: '重试',
    empty: '暂无历史记录',
    delete: '删除记录',
    deleteTitle: '删除这条历史记录？',
    deleteDescription: '删除后将无法恢复，确认删除吗？',
    cancel: '取消',
    unknownDate: '时间未知',
    stella: '海星',
    tide: '潮汐',
  },
  'en-US': {
    searchTitle: 'Search history',
    asrTitle: 'Transcription history',
    ttsTitle: 'Speech history',
    loading: 'Loading history...',
    loadError: 'Could not load history.',
    operationError: 'Action failed. Please try again.',
    retry: 'Retry',
    empty: 'No history yet',
    delete: 'Delete entry',
    deleteTitle: 'Delete this history entry?',
    deleteDescription: 'This entry will be permanently deleted and cannot be recovered.',
    cancel: 'Cancel',
    unknownDate: 'Unknown time',
    stella: 'Stella',
    tide: 'Tide',
  },
} as const

export const ToolHistorySidebar = ({
  kind,
  mobile = false,
  onSelect,
}: {
  kind: ToolHistoryKind
  mobile?: boolean
  onSelect?: () => void
}) => {
  const locale = useSettings((state) => state.locale)
  const text = messages[locale]
  const title =
    kind === 'search' ? text.searchTitle : kind === 'asr' ? text.asrTitle : text.ttsTitle
  const { entries, ready, error } = useToolHistory()
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [failure, setFailure] = useState(false)
  const [deleting, setDeleting] = useState<ToolHistoryEntry | null>(null)
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

  const cancelDeletion = () => {
    if (!pendingRef.current) {
      setDeleting(null)
      setFailure(false)
    }
  }

  return (
    <aside className={`${styles.sidebar} ${mobile ? styles.mobile : ''}`} aria-label={title}>
      {ready && !deleting && (error || failure) ? (
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
                    disabled={pending || deleting !== null}
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
                    disabled={pending || deleting !== null}
                    onClick={() => {
                      setFailure(false)
                      setDeleting(entry)
                    }}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {deleting ? (
        <Modal
          title={text.deleteTitle}
          onClose={cancelDeletion}
          footer={
            <>
              <Button variant="outlined" autoFocus disabled={pending} onClick={cancelDeletion}>
                {text.cancel}
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    const deleted = await deleteToolHistory(deleting.kind, deleting.id)
                    if (deleted) {
                      setDeleting(null)
                    }
                    return deleted
                  })
                }
              >
                {text.delete}
              </Button>
            </>
          }
        >
          {text.deleteDescription}
          {failure ? (
            <p className={styles.error} role="alert">
              {text.operationError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </aside>
  )
}
