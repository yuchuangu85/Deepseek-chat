import { useTranslate } from '../i18n/index.js'
import { IconButton } from '../components/base/IconButton.js'
import {
  IconMenuOutline20,
  IconPanelLeftOutline16,
  IconSettingsOutline16,
} from '../components/base/icons.js'
import { openSettings } from '../components/settings/settingsDialogState.js'
import { ToolNavigation } from '../components/tools/ToolNavigation.js'
import styles from './GlobalHeader.module.css'

export const GlobalHeader = ({
  mobile,
  canOpenHistory,
  canCloseHistory,
  onOpenHistory,
  onCloseHistory,
}: {
  mobile: boolean
  canOpenHistory: boolean
  canCloseHistory: boolean
  onOpenHistory: () => void
  onCloseHistory: () => void
}) => {
  const t = useTranslate()
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <div className={styles.brand}>{t('appName')}</div>
      </div>
      <div className={styles.navigation}>
        <ToolNavigation />
      </div>
      <div className={styles.right}>
        {canCloseHistory ? (
          <IconButton
            size={mobile ? 'xl' : 'm'}
            tone="primary"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            onClick={onCloseHistory}
          />
        ) : canOpenHistory ? (
          <IconButton
            size={mobile ? 'xl' : 'm'}
            tone="primary"
            icon={mobile ? <IconMenuOutline20 /> : <IconPanelLeftOutline16 />}
            tooltip={t('expandSiderbarButton')}
            onClick={onOpenHistory}
          />
        ) : null}
        <IconButton
          size={mobile ? 'xl' : 'm'}
          tone="primary"
          icon={<IconSettingsOutline16 />}
          tooltip={t('settings')}
          onClick={() => openSettings('general')}
        />
      </div>
    </header>
  )
}
