import { useEffect, useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { transcribeWithDetails, type TranscriptionResult } from '../../services/api/speech.js'
import {
  updateAsrSettings,
  useAsrSettings,
  type AsrFileFilter,
} from '../../services/asrSettings.js'
import {
  addToolHistory,
  captureToolHistoryPermit,
  useToolHistory,
} from '../../services/toolHistory.js'
import { classifyApiError } from '../../services/api/errors.js'
import { useSettings } from '../../services/settings.js'
import {
  createTranscriptExport,
  type TranscriptFormat,
} from '../../services/speech/transcriptExport.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16, IconPaperclipOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { AsrLanguagesModal } from './AsrLanguagesModal.js'
import styles from './Tools.module.css'

const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const AUDIO_FILTERS: Record<AsrFileFilter, string> = {
  all: '.wav,.wave,.ogg,.oga,.opus,audio/wav,audio/x-wav,audio/ogg,audio/opus',
  wav: '.wav,.wave,audio/wav,audio/x-wav',
  ogg: '.ogg,.oga,.opus,audio/ogg,audio/opus',
}

const describeError = (error: unknown): TranslationKey => {
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return 'apiKeyInvalidRetry'
    case 'insufficientBalance':
      return 'insufficientBalance'
    case 'tooLarge':
      return 'toolAsrTooLarge'
    case 'rateLimited':
      return 'rateLimited'
    case 'network':
      return 'commonNetworkErrorToast'
    case 'serverBusy':
      return 'completionServerBusyToast'
    default:
      return 'toolAsrFailed'
  }
}

export const AsrTool = () => {
  const t = useTranslate()
  const fileFilter = useAsrSettings((state) => state.fileFilter)
  const showDuration = useAsrSettings((state) => state.showDuration)
  const showRequestId = useAsrSettings((state) => state.showRequestId)
  const inputRef = useRef<HTMLInputElement>(null)
  const languagesButtonRef = useRef<HTMLButtonElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const operationRef = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [languagesOpen, setLanguagesOpen] = useState(false)
  const [downloadFormat, setDownloadFormat] = useState<TranscriptFormat>('txt')
  const [resultSourceName, setResultSourceName] = useState<string | null>(null)
  const selectedHistory = useToolHistory((state) => state.selection)
  const handledSelection = useRef(selectedHistory?.sequence ?? 0)

  const cancel = () => {
    operationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setLoading(false)
  }

  useEffect(
    () => () => {
      operationRef.current += 1
      controllerRef.current?.abort()
    },
    []
  )
  useEffect(() => {
    if (!selectedHistory || selectedHistory.sequence === handledSelection.current) {
      return
    }
    handledSelection.current = selectedHistory.sequence
    if (selectedHistory.entry.kind !== 'asr') {
      return
    }
    operationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setLoading(false)
    setError(null)
    setFile(null)
    setResultSourceName(selectedHistory.entry.fileName)
    setResult({
      text: selectedHistory.entry.text,
      durationMs: selectedHistory.entry.durationMs,
      requestId: null,
    })
  }, [selectedHistory])

  const selectFile = (selected: File) => {
    cancel()
    setResult(null)
    setResultSourceName(null)
    setFile(null)
    if (selected.size === 0) {
      setError('toolAsrEmptyFile')
    } else if (selected.size > MAX_AUDIO_BYTES) {
      setError('toolAsrTooLarge')
    } else {
      setFile(selected)
      setError(null)
    }
  }

  const submit = async () => {
    if (!file || controllerRef.current || !ensureApiKey()) {
      return
    }
    const controller = new AbortController()
    const operation = ++operationRef.current
    controllerRef.current = controller
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const historyPermit = await captureToolHistoryPermit('asr')
      const response = await transcribeWithDetails(
        useSettings.getState().apiKey ?? '',
        file,
        controller.signal
      )
      if (!controller.signal.aborted && operation === operationRef.current) {
        setResult(response)
        setResultSourceName(file.name)
        if (response.text.trim()) {
          if (historyPermit.status === 'error') {
            showToast({ key: 'toolHistorySaveFailed' })
          } else if (historyPermit.status === 'ready') {
            void addToolHistory(
              {
                kind: 'asr',
                text: response.text,
                fileName: file.name,
                durationMs: response.durationMs,
              },
              historyPermit.permit
            ).then((saved) => {
              if (saved === 'error') {
                showToast({ key: 'toolHistorySaveFailed' })
              }
            })
          }
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && operation === operationRef.current) {
        setError(describeError(cause))
      }
    } finally {
      if (operation === operationRef.current) {
        controllerRef.current = null
        setLoading(false)
      }
    }
  }

  const downloadTranscript = () => {
    if (!result || !result.text.trim()) {
      return
    }
    let objectUrl: string | undefined
    try {
      const { blob, name } = createTranscriptExport(
        result.text,
        resultSourceName ?? 'asr',
        downloadFormat
      )
      objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = name
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
      showToast({ key: 'toolAsrDownloadFailed' })
    }
  }

  return (
    <section className={styles.panel}>
      <p className={styles.note}>{t('toolAsrNote')}</p>
      <fieldset className={styles.asrSettings}>
        <legend>{t('toolAsrSettings')}</legend>
        <div className={styles.asrSettingRow}>
          <label htmlFor="asr-file-filter">{t('toolAsrFileFilter')}</label>
          <select
            id="asr-file-filter"
            value={fileFilter}
            onChange={(event) =>
              updateAsrSettings({ fileFilter: event.target.value as AsrFileFilter })
            }
          >
            <option value="all">{t('toolAsrAllFormats')}</option>
            <option value="wav">WAV</option>
            <option value="ogg">Ogg Opus</option>
          </select>
        </div>
        <div className={styles.asrSettingRow}>
          <span>{t('toolAsrLanguage')}</span>
          <div className={styles.asrLanguageValue}>
            <span>{t('toolAsrAutomatic')}</span>
            <button
              ref={languagesButtonRef}
              type="button"
              className={styles.asrLanguagesButton}
              aria-haspopup="dialog"
              aria-expanded={languagesOpen}
              onClick={() => setLanguagesOpen(true)}
            >
              {t('toolAsrSupportedLanguages')}
            </button>
          </div>
        </div>
        <div className={styles.asrSettingRow}>
          <span>{t('toolAsrSampleRates')}</span>
          <span>8, 16, 22.05, 24, 32, 44.1, 48 kHz</span>
        </div>
        <div className={styles.asrSettingOptions}>
          <span>{t('toolAsrResultDetails')}</span>
          <label>
            <input
              type="checkbox"
              checked={showDuration}
              onChange={(event) => updateAsrSettings({ showDuration: event.target.checked })}
            />
            {t('toolAsrShowDuration')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={showRequestId}
              onChange={(event) => updateAsrSettings({ showRequestId: event.target.checked })}
            />
            {t('toolAsrShowRequestId')}
          </label>
        </div>
      </fieldset>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept={AUDIO_FILTERS[fileFilter]}
        onChange={(event) => {
          const selected = event.target.files?.[0]
          event.target.value = ''
          if (selected) {
            selectFile(selected)
          }
        }}
      />
      <button
        type="button"
        className={`${styles.upload} ${styles.asrUpload}`}
        onClick={() => inputRef.current?.click()}
      >
        <IconPaperclipOutline16 />
        <span className={styles.audioFileName}>{file ? file.name : t('toolAsrChooseFile')}</span>
      </button>
      {error ? (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.status} role="status">
          {t('toolAsrLoading')}
        </p>
      ) : null}
      <div className={styles.asrActions}>
        <Button
          variant={loading ? 'outlined' : 'primary'}
          disabled={!file && !loading}
          onClick={() => (loading ? cancel() : void submit())}
        >
          {t(loading ? 'toolAsrCancel' : 'toolAsrSubmit')}
        </Button>
      </div>
      {result !== null ? (
        <div className={styles.asrResult}>
          {result.text.trim() ? (
            <>
              <label className={styles.label} htmlFor="asr-result">
                {t('toolAsrResult')}
              </label>
              <textarea
                id="asr-result"
                className={styles.textarea}
                value={result.text}
                readOnly
                rows={7}
              />
              <div className={styles.asrResultActions}>
                <Button
                  variant="outlined"
                  onClick={() => {
                    void copyText(result.text).then((ok) =>
                      showToast({ key: ok ? 'copied' : 'copyFailed' })
                    )
                  }}
                >
                  {t('copy')}
                </Button>
                <div className={styles.asrDownload}>
                  <select
                    aria-label={t('toolAsrDownloadFormat')}
                    value={downloadFormat}
                    onChange={(event) => setDownloadFormat(event.target.value as TranscriptFormat)}
                  >
                    <option value="txt">TXT (.txt)</option>
                    <option value="md">Markdown (.md)</option>
                    <option value="json">JSON (.json)</option>
                  </select>
                  <Button
                    variant="outlined"
                    className={styles.asrDownloadButton}
                    onClick={downloadTranscript}
                  >
                    <IconDownloadOutline16 />
                    {t('exportAllDownload')}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className={styles.status} role="status">
              {t('toolAsrNoSpeech')}
            </p>
          )}
          {showDuration || showRequestId ? (
            <dl className={styles.asrMetadata}>
              {showDuration ? (
                <div>
                  <dt>{t('toolAsrDuration')}</dt>
                  <dd>
                    {result.durationMs === null
                      ? t('toolAsrUnavailable')
                      : `${result.durationMs} ms`}
                  </dd>
                </div>
              ) : null}
              {showRequestId ? (
                <div>
                  <dt>{t('toolAsrRequestId')}</dt>
                  <dd>{result.requestId ?? t('toolAsrUnavailable')}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}
      {languagesOpen ? (
        <AsrLanguagesModal
          onClose={() => {
            setLanguagesOpen(false)
            requestAnimationFrame(() => languagesButtonRef.current?.focus())
          }}
        />
      ) : null}
    </section>
  )
}
