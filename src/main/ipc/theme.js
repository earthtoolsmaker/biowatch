import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import log from '../services/logger.js'
import { createPreferencesStore } from '../services/preferences.js'
import { createThemeService } from '../services/theme.js'

let themeService = null

function broadcast(event, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(event, payload)
    }
  }
}

export function initializeThemeService() {
  if (themeService) return themeService
  const store = createPreferencesStore(app.getPath('userData'))
  themeService = createThemeService({ nativeTheme, store, broadcast })
  themeService.init()
  log.info('theme service initialized', themeService.getState())
  return themeService
}

export function getThemeService() {
  if (!themeService) throw new Error('theme service not initialized')
  return themeService
}

export function registerThemeIPCHandlers() {
  ipcMain.handle('theme:get', () => getThemeService().getState())
  ipcMain.handle('theme:set', (_event, source) => {
    getThemeService().setSource(source)
    return getThemeService().getState()
  })
}
