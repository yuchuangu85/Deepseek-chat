import { useEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { Modal } from '../base/Modal.js'
import styles from './AsrLanguagesModal.module.css'

const LANGUAGES = [
  { code: 'zh', zh: '中文', en: 'Chinese' },
  { code: 'yue', zh: '粤语', en: 'Cantonese' },
  { code: 'en', zh: '英语', en: 'English' },
  { code: 'ja', zh: '日语', en: 'Japanese' },
  { code: 'ko', zh: '韩语', en: 'Korean' },
  { code: 'de', zh: '德语', en: 'German' },
  { code: 'fr', zh: '法语', en: 'French' },
  { code: 'es', zh: '西班牙语', en: 'Spanish' },
  { code: 'pt', zh: '葡萄牙语', en: 'Portuguese' },
  { code: 'it', zh: '意大利语', en: 'Italian' },
  { code: 'ru', zh: '俄语', en: 'Russian' },
  { code: 'ar', zh: '阿拉伯语', en: 'Arabic' },
  { code: 'hi', zh: '印地语', en: 'Hindi' },
  { code: 'id', zh: '印尼语', en: 'Indonesian' },
  { code: 'vi', zh: '越南语', en: 'Vietnamese' },
  { code: 'th', zh: '泰语', en: 'Thai' },
  { code: 'tr', zh: '土耳其语', en: 'Turkish' },
  { code: 'ms', zh: '马来语', en: 'Malay' },
  { code: 'fil', zh: '菲律宾语', en: 'Filipino' },
  { code: 'pl', zh: '波兰语', en: 'Polish' },
  { code: 'hu', zh: '匈牙利语', en: 'Hungarian' },
] as const

export const AsrLanguagesModal = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const contentRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    contentRef.current?.focus()
  }, [])

  return (
    <Modal
      title={t('toolAsrSupportedLanguages')}
      closable
      className={styles.dialog}
      mainClassName={styles.content}
      onClose={onClose}
    >
      <ul ref={contentRef} tabIndex={-1} className={styles.languages}>
        {LANGUAGES.map((language) => (
          <li key={language.code}>
            <span>{locale === 'zh-CN' ? language.zh : language.en}</span>
            <code>({language.code})</code>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
