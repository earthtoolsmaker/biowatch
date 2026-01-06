/**
 * Shell-related IPC handlers
 */

import { ipcMain, shell } from 'electron'
import log from 'electron-log'

/**
 * Register all shell-related IPC handlers
 */
export function registerShellIPCHandlers() {
  ipcMain.handle('shell:open-path', async (_, path) => {
    try {
      await shell.openPath(path)
      log.info(`Opened path: ${path}`)
      return { success: true }
    } catch (error) {
      log.error('Error opening path:', error)
      return { error: error.message }
    }
  })
}
