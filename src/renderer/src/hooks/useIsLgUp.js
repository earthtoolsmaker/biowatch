import { useEffect, useState } from 'react'

const LG_QUERY = '(min-width: 1024px)'

/**
 * Reactive Tailwind `lg` flag (viewport >= 1024px) via matchMedia. Updates on
 * resize. Drives the Explore tab's view toggle — 'both' is only offered at lg
 * and up. Defaults to true before the effect runs (desktop-first Electron
 * window), which avoids a flash of the narrow layout on mount.
 */
export function useIsLgUp() {
  const [isLgUp, setIsLgUp] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(LG_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(LG_QUERY)
    const update = () => setIsLgUp(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return isLgUp
}
