const VALID_SOURCES = new Set(['system', 'light', 'dark'])

export function createThemeService({ nativeTheme, store, broadcast }) {
  function getStoredSource() {
    const prefs = store.read()
    const src = prefs?.theme?.source
    return VALID_SOURCES.has(src) ? src : 'system'
  }

  function persistSource(source) {
    const prefs = store.read()
    store.write({ ...prefs, theme: { ...(prefs.theme || {}), source } })
  }

  function getResolved() {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  function getState() {
    return { source: nativeTheme.themeSource, resolved: getResolved() }
  }

  function init() {
    const source = getStoredSource()
    nativeTheme.themeSource = source

    nativeTheme.on('updated', () => {
      broadcast('theme:changed', getState())
    })
  }

  function setSource(source) {
    if (!VALID_SOURCES.has(source)) {
      throw new Error(`invalid theme source: ${source}`)
    }
    nativeTheme.themeSource = source
    persistSource(source)
    broadcast('theme:changed', getState())
  }

  return { init, getState, getResolved, setSource }
}
