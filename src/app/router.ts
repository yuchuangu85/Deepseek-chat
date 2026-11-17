import { useEffect, useState } from 'react'

export type AppRoute = 'chat' | 'search' | 'fetch' | 'ocr' | 'tts'

const ROUTES = new Set<AppRoute>(['chat', 'search', 'fetch', 'ocr', 'tts'])

export const getRoute = (hash = window.location.hash): AppRoute => {
  const path = hash.replace(/^#\/?/, '').split('?')[0]
  return ROUTES.has(path as AppRoute) ? (path as AppRoute) : 'chat'
}

export const navigate = (route: AppRoute) => {
  const hash = route === 'chat' ? '' : `#/${route}`
  if (window.location.hash !== hash) {
    window.location.hash = hash
  } else {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}

export const useRoute = () => {
  const [route, setRoute] = useState<AppRoute>(() => getRoute())
  useEffect(() => {
    const update = () => setRoute(getRoute())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
