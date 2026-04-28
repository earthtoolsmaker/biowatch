/**
 * Info-tab-related IPC handlers
 */

import { ipcMain } from 'electron'
import log from '../services/logger.js'
import { getRecentReleases } from '../services/changelog.js'
import { getStorageUsage } from '../services/storage-usage.js'
import { getLicenseText } from '../services/license.js'

export function registerInfoIPCHandlers() {
  ipcMain.handle('info:get-changelog', async (_, limit = 3) => {
    try {
      return getRecentReleases(limit)
    } catch (err) {
      log.error('info:get-changelog failed', err)
      return []
    }
  })

  ipcMain.handle('info:get-storage-usage', async () => {
    try {
      return await getStorageUsage()
    } catch (err) {
      log.error('info:get-storage-usage failed', err)
      return null
    }
  })

  ipcMain.handle('info:get-license-text', async () => {
    try {
      return getLicenseText()
    } catch (err) {
      log.error('info:get-license-text failed', err)
      return ''
    }
  })
}
