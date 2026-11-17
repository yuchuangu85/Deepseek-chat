import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { setSiderCollapsed, useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import {
  closeMobileSider,
  openMobileSider,
  useMobileSider,
} from '../components/sider/mobileSiderState.js'
import { Sider } from '../components/sider/Sider.js'
import { ToolHistorySidebar } from '../components/toolHistory/ToolHistorySidebar.js'
import { initToolHistory, type ToolHistoryKind } from '../services/toolHistory.js'
import { GlobalHeader } from './GlobalHeader.js'
import { useRoute } from './router.js'
import { ToolsPage } from '../components/tools/Tools.js'
import { SearchTool } from '../components/searchTool/SearchTool.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const route = useRoute()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const mobileSiderOpen = useMobileSider((state) => state.open)
  const toolHistoryKind: ToolHistoryKind | null =
    route === 'search' || route === 'asr' || route === 'tts' ? route : null
  const hasHistory = route === 'chat' || toolHistoryKind !== null
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const [toolCollapsed, setToolCollapsed] = useState<Record<ToolHistoryKind, boolean>>({
    search: false,
    asr: false,
    tts: false,
  })
  const historyCollapsed =
    route === 'chat' ? siderCollapsed : toolHistoryKind !== null && toolCollapsed[toolHistoryKind]
  const historyOpen = hasHistory && (isMobile ? mobileSiderOpen : !historyCollapsed)
  const setHistoryCollapsed = (collapsed: boolean) => {
    if (route === 'chat') {
      setSiderCollapsed(collapsed)
    } else if (toolHistoryKind) {
      setToolCollapsed((current) => ({ ...current, [toolHistoryKind]: collapsed }))
    }
  }
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile, route])

  useEffect(() => {
    void initChat()
    void initToolHistory()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        <GlobalHeader
          mobile={isMobile}
          canOpenHistory={hasHistory && (isMobile ? !mobileSiderOpen : historyCollapsed)}
          canCloseHistory={historyOpen}
          onOpenHistory={() => (isMobile ? openMobileSider() : setHistoryCollapsed(false))}
          onCloseHistory={() => (isMobile ? closeMobileSider() : setHistoryCollapsed(true))}
        />
        <div className={styles.workspace}>
          {isMobile && mobileSiderOpen && hasHistory ? (
            <>
              <div className={styles.drawerMask} onClick={closeMobileSider} />
              <div className={styles.drawer}>
                {route === 'chat' ? (
                  <Sider mobile />
                ) : toolHistoryKind ? (
                  <ToolHistorySidebar
                    key={toolHistoryKind}
                    kind={toolHistoryKind}
                    mobile
                    onSelect={closeMobileSider}
                  />
                ) : null}
              </div>
            </>
          ) : !isMobile && !historyCollapsed ? (
            route === 'chat' ? (
              <Sider />
            ) : toolHistoryKind ? (
              <ToolHistorySidebar
                key={toolHistoryKind}
                kind={toolHistoryKind}
              />
            ) : null
          ) : null}
          <main className={styles.main}>
            {saveError ? (
              <div className={styles.saveError} role="alert">
                <span>{t('sessionSaveFailed')}</span>
                <Button
                  variant="outlined"
                  size="s"
                  disabled={importingHistory}
                  onClick={retrySaveSessions}
                >
                  {t('retry')}
                </Button>
              </div>
            ) : null}
            <div className={styles.content}>
              {route !== 'chat' ? (
                <>
                  {route === 'search' ? (
                    <SearchTool />
                  ) : (
                    <ToolsPage
                      tool={route}
                      ready={ready}
                      initError={initError}
                      onRetry={() => void initChat()}
                    />
                  )}
                </>
              ) : (
                <>
                  {!ready || (activeId !== null && !session) ? (
                    <div className={styles.loadingView}>
                      <div className={styles.loadingState} role="status" aria-live="polite">
                        <span>
                          {(!ready ? initError : sessionLoadError)
                            ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                            : t('sessionLoading')}
                        </span>
                        {(!ready ? initError : sessionLoadError) ? (
                          <Button
                            variant="outlined"
                            size="m"
                            onClick={() => {
                              if (!ready) {
                                void initChat()
                              } else if (activeId !== null) {
                                selectSession(activeId)
                              }
                            }}
                          >
                            {t('retry')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : session ? (
                    <SessionView session={session} streaming={streaming} />
                  ) : (
                    <Welcome />
                  )}
                </>
              )}
            </div>
          </main>
          {route === 'chat' ? <SearchPanel /> : null}
        </div>
      </div>
      <SettingsDialog />
      <Toast />
    </>
  )
}
