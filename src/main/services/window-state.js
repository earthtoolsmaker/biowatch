import log from './logger.js'

/** Persist normal bounds separately so maximized/full-screen windows can be restored. */
export function createWindowStateService({ store, screen }) {
  function restore() {
    const saved = store.read()?.window
    const bounds = saved?.bounds
    const validBounds =
      bounds &&
      ['x', 'y', 'width', 'height'].every((key) => Number.isInteger(bounds[key])) &&
      bounds.width > 0 &&
      bounds.height > 0
    const { workArea } = validBounds
      ? screen.getDisplayMatching(bounds)
      : screen.getPrimaryDisplay()
    const width = Math.min(validBounds ? bounds.width : 1300, workArea.width)
    const height = Math.min(validBounds ? bounds.height : 800, workArea.height)

    return {
      bounds: {
        width,
        height,
        x: validBounds
          ? Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width))
          : workArea.x + Math.floor((workArea.width - width) / 2),
        y: validBounds
          ? Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height))
          : workArea.y + Math.floor((workArea.height - height) / 2)
      },
      maximized: saved?.maximized === true,
      fullScreen: saved?.fullScreen === true
    }
  }

  function save(window) {
    if (window.isDestroyed()) return
    try {
      const prefs = store.read()
      store.write({
        ...prefs,
        window: {
          bounds: window.getNormalBounds(),
          maximized: window.isMaximized(),
          fullScreen: window.isFullScreen()
        }
      })
    } catch (error) {
      log.warn('Could not save window state', error)
    }
  }

  return { restore, save }
}
