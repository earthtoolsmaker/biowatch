import { useEffect, useState, useCallback } from 'react'

function applyHtmlClass(resolved) {
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function useTheme() {
  const [state, setState] = useState(() => {
    const initial = window.api?.themeInitial
    return initial || { source: 'system', resolved: 'light' }
  })

  useEffect(() => {
    let cancelled = false
    window.api.getTheme().then((current) => {
      if (cancelled) return
      setState(current)
      applyHtmlClass(current.resolved)
    })
    const unsubscribe = window.api.onThemeChanged((payload) => {
      setState(payload)
      applyHtmlClass(payload.resolved)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const setSource = useCallback(async (source) => {
    const next = await window.api.setThemeSource(source)
    setState(next)
    applyHtmlClass(next.resolved)
  }, [])

  return { source: state.source, resolved: state.resolved, setSource }
}
