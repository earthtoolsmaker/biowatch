/**
 * Dialog-related IPC handlers
 */

import { dialog, ipcMain } from 'electron'

/**
 * Register all dialog-related IPC handlers
 */
export function registerDialogIPCHandlers() {
  ipcMain.handle('dialog:select-image', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0]
      // Convert Windows backslashes to forward slashes for URLs
      const urlPath = filePath.replace(/\\/g, '/')
      return {
        path: filePath,
        url: `local-file://get?path=${urlPath}`
      }
    }
    return null
  })
}
