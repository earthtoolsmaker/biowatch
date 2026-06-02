/**
 * Files-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from '../services/logger.js'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import { runInWorker } from '../services/sequences/runInWorker.js'
import { listStudies } from '../services/study.js'
import { resolveSourceDisplay } from '../../shared/sourceImporterResolver.js'

/**
 * Register all files-related IPC handlers
 */
export function registerFilesIPCHandlers() {
  ipcMain.handle('sources:get-data', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const sourcesData = await runInWorker({ type: 'sources-data', dbPath })
      // Augment each source row with a per-row importerName + displayLabel so the
      // Sources tab can render the right icon and title for merged sources. The
      // resolver is pure; we just provide the context it needs (current study and
      // the list of local studies for `merge:<uuid>` lookups).
      const studies = await listStudies()
      const currentStudy = (studies || []).find((s) => s.id === studyId)
      const studyImporterName = currentStudy?.importerName
      const augmented = (sourcesData || []).map((row) => {
        const display = resolveSourceDisplay({
          importFolder: row.importFolder,
          studyImporterName,
          sampleFilePath: row.sampleRemoteUrl || null,
          studies
        })
        return { ...row, importerName: display.importerName, displayLabel: display.displayLabel }
      })
      return { data: augmented }
    } catch (error) {
      log.error('Error getting sources data:', error)
      return { error: error.message }
    }
  })
}
