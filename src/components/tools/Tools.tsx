import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setTtsVoice, useSettings } from '../../services/settings.js'
import {
  addToolHistory,
  captureToolHistoryPermit,
  useToolHistory,
} from '../../services/toolHistory.js'
import type { TtsVoice } from '../../services/api/speech.js'
import { navigate } from '../../app/router.js'
import { Button } from '../base/Button.js'
import {
  IconDownloadOutline16,
  IconLinkOutline14,
  IconPaperclipOutline16,
  IconPlayMediaOutline16,
} from '../base/icons.js'
import {
  describeReadAloudError,
  toggleReadAloud,
  stopReadAloud,
  useReadAloud,
} from '../../services/speech/readAloud.js'
import { synthesizeWavDownload } from '../../services/speech/ttsDownload.js'
import { showToast } from '../base/toastState.js'
import { ReadingBars } from '../messages/ReadingBars.js'
import { ACCEPT, useUploads, validateFiles } from '../../services/attachments.js'
import { addDraftFiles, clearDraft, setDraftText, useDrafts } from '../../services/chat/drafts.js'
import { sendNewMessageFromDraft } from '../../services/chat/store.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { AsrTool } from './AsrTool.js'
import styles from './Tools.module.css'

export const ToolsPage = ({
  tool,
  ready,
  initError,
  onRetry,
}: {
  tool: 'fetch' | 'ocr' | 'asr' | 'tts'
  ready: boolean
  initError: boolean
  onRetry: () => void
}) => {
  const t = useTranslate()
  const titles = {
    fetch: t('toolFetchTitle'),
    ocr: t('toolOcrTitle'),
    asr: t('toolAsrTitle'),
    tts: t('toolTtsTitle'),
  }
  const descriptions = {
    fetch: t('toolFetchDescription'),
    ocr: t('toolOcrDescription'),
    asr: t('toolAsrDescription'),
    tts: t('toolTtsDescription'),
  }
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{titles[tool]}</h1>
      <p className={styles.description}>{descriptions[tool]}</p>
      {tool === 'asr' ? (
        <AsrTool />
      ) : !ready ? (
        <section className={styles.panel} role="status" aria-live="polite">
          <p className={initError ? styles.error : styles.status}>
            {initError ? t('toolInitFailed') : t('toolInitializing')}
          </p>
          {initError ? (
            <Button variant="outlined" onClick={onRetry}>
              {t('retry')}
            </Button>
          ) : null}
        </section>
      ) : tool === 'fetch' ? (
        <FetchTool />
      ) : tool === 'ocr' ? (
        <OcrTool />
      ) : (
        <TtsTool />
      )}
    </div>
  )
}

const FETCH_DRAFT_KEY = 'tool:fetch'
const OCR_DRAFT_KEY = 'tool:ocr'

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const FetchTool = () => {
  const t = useTranslate()
  const [url, setUrl] = useState('')
  const value = url.trim()
  const invalidUrl = value.length > 0 && !isHttpUrl(value)
  const submit = () => {
    if (!value || invalidUrl) {
      return
    }
    if (!ensureApiKey()) {
      return
    }
    setDraftText(FETCH_DRAFT_KEY, `${t('toolFetchPrompt')}\n${value}`)
    if (sendNewMessageFromDraft(FETCH_DRAFT_KEY)) {
      navigate('chat')
    }
  }
  return (
    <section className={styles.panel}>
      <label className={styles.label} htmlFor="fetch-url">
        {t('toolFetchUrlLabel')}
      </label>
      <div className={styles.inputRow}>
        <IconLinkOutline14 />
        <input
          id="fetch-url"
          type="text"
          inputMode="url"
          value={url}
          placeholder={t('toolFetchUrlPlaceholder')}
          aria-invalid={invalidUrl}
          aria-describedby={invalidUrl ? 'fetch-url-error' : undefined}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
        />
      </div>
      {invalidUrl ? (
        <p id="fetch-url-error" className={styles.error} role="alert">
          {t('toolFetchInvalidUrl')}
        </p>
      ) : null}
      <p className={styles.note}>{t('toolFetchNote')}</p>
      <Button onClick={submit} disabled={!value || invalidUrl}>
        {t('toolFetchSubmit')}
      </Button>
    </section>
  )
}

const OcrTool = () => {
  const t = useTranslate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachment = useDrafts((state) => state.drafts.get(OCR_DRAFT_KEY)?.attachments[0])
  const file = attachment?.file ?? null
  const uploadId = attachment?.id ?? null
  const [busy, setBusy] = useState(false)
  const accept = (selected: File) => {
    if (!ensureApiKey()) {
      return
    }
    const validationError = validateFiles([selected], 0)
    if (validationError) {
      showToast(validationError)
      return
    }
    clearDraft(OCR_DRAFT_KEY)
    const error = addDraftFiles(OCR_DRAFT_KEY, [selected], useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const submit = () => {
    if (!file || !uploadId || busy) {
      return
    }
    const task = useUploads.getState().tasks[uploadId]
    if (task?.status !== 'done') {
      return
    }
    setDraftText(OCR_DRAFT_KEY, t('toolOcrPrompt'))
    setBusy(true)
    if (sendNewMessageFromDraft(OCR_DRAFT_KEY)) {
      navigate('chat')
    } else {
      setBusy(false)
    }
  }
  const task = useUploads((state) => (uploadId ? state.tasks[uploadId] : undefined))
  return (
    <section className={styles.panel}>
      <p className={styles.note}>{t('toolOcrNote')}</p>
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept={ACCEPT}
        onChange={(event) => {
          const selected = event.target.files?.[0]
          event.target.value = ''
          if (selected) {
            accept(selected)
          }
        }}
      />
      <button type="button" className={styles.upload} onClick={() => fileInputRef.current?.click()}>
        <IconPaperclipOutline16 />
        <span>{file ? file.name : t('toolOcrChooseFile')}</span>
      </button>
      {task?.status === 'uploading' ? (
        <p className={styles.status}>{t('uploadFileStatusUploading')}</p>
      ) : null}
      {task?.status === 'error' ? (
        <p className={styles.error}>{t(task.error.key, task.error.params)}</p>
      ) : null}
      <Button
        className={styles.ocrSubmit}
        onClick={submit}
        disabled={!file || task?.status !== 'done' || busy}
      >
        {t('toolOcrSubmit')}
      </Button>
    </section>
  )
}

const TtsTool = () => {
  const t = useTranslate()
  const [text, setText] = useState('')
  const [messageId] = useState(() => `tts-tool-${Date.now()}`)
  const [downloading, setDownloading] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const selectedHistory = useToolHistory((state) => state.selection)
  const handledSelection = useRef(selectedHistory?.sequence ?? 0)
  const downloadRef = useRef<AbortController | null>(null)
  const audioCacheRef = useRef<{ text: string; voice: TtsVoice; blob: Blob } | null>(null)
  const operationRef = useRef(0)
  const status = useReadAloud((state) => (state.messageId === messageId ? state.status : 'idle'))
  useEffect(() => {
    const unsubscribe = useSettings.subscribe((next, previous) => {
      if (next.ttsVoice !== previous.ttsVoice) {
        audioCacheRef.current = null
        setAudioReady(false)
        if (downloadRef.current) {
          operationRef.current += 1
          downloadRef.current.abort()
          downloadRef.current = null
          setDownloading(false)
        }
      }
    })
    return () => {
      unsubscribe()
      operationRef.current += 1
      downloadRef.current?.abort()
      audioCacheRef.current = null
      stopReadAloud()
    }
  }, [])

  const cancelDownload = () => {
    operationRef.current += 1
    downloadRef.current?.abort()
    downloadRef.current = null
    setDownloading(false)
  }

  const play = () => {
    if (downloadRef.current) {
      return
    }
    const playing = useReadAloud.getState().messageId === messageId
    if (!playing && (!text.trim() || !ensureApiKey())) {
      return
    }
    const value = text.trim()
    const voice = useSettings.getState().ttsVoice
    const historyPermitPromise = captureToolHistoryPermit('tts')
    toggleReadAloud(
      messageId,
      value,
      (error) => showToast(describeReadAloudError(error)),
      () => {
        void historyPermitPromise.then((permit) => {
          if (permit.status === 'error') {
            showToast({ key: 'toolHistorySaveFailed' })
          } else if (permit.status === 'ready') {
            return addToolHistory({ kind: 'tts', text: value, voice }, permit.permit).then(
              (saved) => {
                if (saved === 'error') {
                  showToast({ key: 'toolHistorySaveFailed' })
                }
              }
            )
          }
          return undefined
        })
      }
    )
  }

  useEffect(() => {
    if (!selectedHistory || selectedHistory.sequence === handledSelection.current) {
      return
    }
    handledSelection.current = selectedHistory.sequence
    if (selectedHistory.entry.kind !== 'tts') {
      return
    }
    operationRef.current += 1
    downloadRef.current?.abort()
    downloadRef.current = null
    audioCacheRef.current = null
    setDownloading(false)
    setAudioReady(false)
    if (useReadAloud.getState().messageId === messageId) {
      stopReadAloud()
    }
    setText(selectedHistory.entry.text)
    setTtsVoice(selectedHistory.entry.voice)
  }, [selectedHistory, messageId])

  const saveWav = (blob: Blob) => {
    let objectUrl: string | undefined
    try {
      objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'deepseek-tts.wav'
      document.body.appendChild(link)
      try {
        link.click()
      } finally {
        link.remove()
      }
      const url = objectUrl
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
      showToast({ key: 'toolTtsDownloadFailed' })
    }
  }

  const download = async () => {
    if (downloadRef.current) {
      cancelDownload()
      return
    }
    const value = text.trim()
    if (!value || useReadAloud.getState().messageId === messageId) {
      return
    }
    const { apiKey, ttsVoice } = useSettings.getState()
    const cached = audioCacheRef.current
    if (cached && cached.text === value && cached.voice === ttsVoice) {
      saveWav(cached.blob)
      return
    }
    if (!ensureApiKey()) {
      cancelDownload()
      return
    }
    const controller = new AbortController()
    const operation = ++operationRef.current
    downloadRef.current = controller
    setDownloading(true)
    try {
      const blob = await synthesizeWavDownload(apiKey ?? '', value, ttsVoice, controller.signal)
      const historyPermit = await captureToolHistoryPermit('tts')
      if (controller.signal.aborted || operation !== operationRef.current) {
        cancelDownload()
      }
      if (controller.signal.aborted || operation !== operationRef.current) {
        return
      }
      audioCacheRef.current = { text: value, voice: ttsVoice, blob }
      setAudioReady(true)
      if (historyPermit.status === 'error') {
        showToast({ key: 'toolHistorySaveFailed' })
      } else if (historyPermit.status === 'ready') {
        void addToolHistory(
          { kind: 'tts', text: value, voice: ttsVoice },
          historyPermit.permit
        ).then((saved) => {
          if (saved === 'error') {
            showToast({ key: 'toolHistorySaveFailed' })
          }
        })
      }
      saveWav(blob)
    } catch (error) {
      if (!controller.signal.aborted && operation === operationRef.current) {
        showToast(describeReadAloudError(error))
      }
    } finally {
      if (operation === operationRef.current) {
        downloadRef.current = null
        setDownloading(false)
      }
    }
  }

  return (
    <section className={styles.panel}>
      <label className={styles.label} htmlFor="tts-text">
        {t('toolTtsTextLabel')}
      </label>
      <textarea
        id="tts-text"
        className={styles.textarea}
        value={text}
        placeholder={t('toolTtsPlaceholder')}
        onChange={(event) => {
          if (downloadRef.current) {
            cancelDownload()
          }
          audioCacheRef.current = null
          setAudioReady(false)
          setText(event.target.value)
        }}
        rows={7}
      />
      <div className={styles.ttsActions}>
        <Button
          className={styles.ttsPlayButton}
          onClick={play}
          disabled={downloading || (status === 'idle' && !text.trim())}
        >
          {status === 'idle' ? <IconPlayMediaOutline16 /> : <ReadingBars mode={status} />}
          {status === 'idle' ? t('ttsPlay') : t('ttsStop')}
        </Button>
        <Button
          variant="outlined"
          className={styles.ttsDownloadButton}
          onClick={() => void download()}
          disabled={status !== 'idle' || (!downloading && !text.trim())}
        >
          {downloading ? null : <IconDownloadOutline16 />}
          {t(downloading ? 'toolTtsCancelDownload' : 'toolTtsDownload')}
        </Button>
      </div>
      {downloading ? (
        <p className={styles.status} role="status">
          {t('toolTtsDownloading')}
        </p>
      ) : null}
      {audioReady && !downloading ? (
        <p className={styles.status} role="status">
          {t('toolTtsDownloadReady')}
        </p>
      ) : null}
      <p className={styles.ttsDownloadNote}>{t('toolTtsDownloadNote')}</p>
    </section>
  )
}
