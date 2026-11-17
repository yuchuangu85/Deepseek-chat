import { useTranslate } from '../../i18n/index.js'
import { navigate, useRoute } from '../../app/router.js'
import { newChat, useChatStore } from '../../services/chat/store.js'
import styles from './ToolNavigation.module.css'

export const ToolNavigation = () => {
  const t = useTranslate()
  const route = useRoute()
  const activeId = useChatStore((state) => state.activeId)
  const importingHistory = useChatStore((state) => state.importingHistory)
  return (
    <nav className={styles.navigation} aria-label={t('toolLabel')}>
      <button
        type="button"
        aria-current={route === 'chat' && activeId === null ? 'page' : undefined}
        disabled={importingHistory}
        onClick={() => {
          newChat()
          navigate('chat')
        }}
      >
        Home
      </button>
      {(['search', 'fetch', 'ocr', 'asr', 'tts'] as const).map((tool) => (
        <button
          key={tool}
          type="button"
          aria-current={route === tool ? 'page' : undefined}
          onClick={() => navigate(tool)}
        >
          {tool === 'search'
            ? 'Search'
            : t(
                `tool${tool[0].toUpperCase()}${tool.slice(1)}Title` as
                  | 'toolFetchTitle'
                  | 'toolOcrTitle'
                  | 'toolAsrTitle'
                  | 'toolTtsTitle'
              )}
        </button>
      ))}
    </nav>
  )
}
