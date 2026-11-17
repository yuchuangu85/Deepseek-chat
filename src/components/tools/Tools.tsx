import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { navigate } from '../../app/router.js'
import { useIsMobile } from '../../app/viewport.js'
import { MobileHeader } from '../session/MobileHeader.js'
import { ToolNavigation } from './ToolNavigation.js'
import { Button } from '../base/Button.js'
import { IconLinkOutline14, IconPaperclipOutline16, IconPlayMediaOutline16 } from '../base/icons.js'
import {
  describeReadAloudError,
  toggleReadAloud,
  stopReadAloud,
  useReadAloud,
} from '../../services/speech/readAloud.js'
import { showToast } from '../base/toastState.js'
import { ReadingBars } from '../messages/ReadingBars.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { addDraftFiles, clearDraft, getDraft, setDraftText } from '../../services/chat/drafts.js'
import { sendMessage } from '../../services/chat/store.js'
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
  const isMobile = useIsMobile()
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
      {isMobile ? <MobileHeader /> : null}
      {!isMobile ? (
        <header className={styles.header}>
          <ToolNavigation />
        </header>
      ) : null}
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
    clearDraft(null)
    setDraftText(null, `${t('toolFetchPrompt')}\n${value}`)
    if (sendMessage(null)) {
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
  const [file, setFile] = useState<File | null>(null)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const accept = async (selected: File) => {
    if (!ensureApiKey()) {
      return
    }
    const previousIds = new Set(getDraft(null).attachments.map((attachment) => attachment.id))
    clearDraft(null)
    setFile(selected)
    const error = addDraftFiles(null, [selected], useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
      setFile(null)
      return
    }
    const attachment = getDraft(null).attachments.find((item) => !previousIds.has(item.id))
    setUploadId(attachment?.id ?? null)
  }
  const submit = () => {
    if (!file || !uploadId || busy) {
      return
    }
    const task = useUploads.getState().tasks[uploadId]
    if (task?.status !== 'done') {
      return
    }
    setDraftText(null, t('toolOcrPrompt'))
    setBusy(true)
    if (sendMessage(null)) {
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
            void accept(selected)
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
  const status = useReadAloud((state) => (state.messageId === messageId ? state.status : 'idle'))
  useEffect(() => () => stopReadAloud(), [])
  const play = () => {
    if (!text.trim()) {
      return
    }
    toggleReadAloud(messageId, text.trim(), (error) => showToast(describeReadAloudError(error)))
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
        onChange={(event) => setText(event.target.value)}
        rows={7}
      />
      <Button onClick={play} disabled={!text.trim()}>
        {status === 'idle' ? <IconPlayMediaOutline16 /> : <ReadingBars mode={status} />}
        {status === 'idle' ? t('ttsPlay') : t('ttsStop')}
      </Button>
    </section>
  )
}
