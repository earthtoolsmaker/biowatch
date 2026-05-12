import { app, dialog, ipcMain } from 'electron'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import { asc } from 'drizzle-orm'
import log from 'electron-log'

import {
  getDrizzleDb,
  getReadonlyDrizzleDb,
  deployments,
  closeStudyDatabase,
  getMetadata
} from '../database/index.js'
import { getStudyDatabasePath } from '../services/paths.js'
import { renderDeploymentsCsv } from '../services/export/deploymentsCsv.js'
import { parseDeploymentsCsv } from '../services/import/parsers/deploymentsCsv.js'
import { applyDeploymentsCsv } from '../services/import/applyDeploymentsCsv.js'

function slugifyStudyName(name) {
  if (!name) return 'study'
  return name
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function registerDeploymentsCsvIPCHandlers() {
  ipcMain.handle('deployments:export-csv', async (_event, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) return { error: 'Database not found for this study' }

      const db = await getReadonlyDrizzleDb(studyId, dbPath)
      const metadata = await getMetadata(db)
      const slug = slugifyStudyName(metadata?.name)
      const today = new Date().toISOString().slice(0, 10)
      const defaultName = `deployments-${slug}-${today}.csv`

      const rows = await db
        .select({
          deploymentID: deployments.deploymentID,
          locationID: deployments.locationID,
          locationName: deployments.locationName,
          latitude: deployments.latitude,
          longitude: deployments.longitude
        })
        .from(deployments)
        .orderBy(asc(deployments.deploymentID))

      await closeStudyDatabase(studyId, dbPath)

      const result = await dialog.showSaveDialog({
        title: 'Export deployments CSV',
        defaultPath: defaultName,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (result.canceled || !result.filePath) return { cancelled: true }

      const csv = renderDeploymentsCsv(rows)
      await fs.writeFile(result.filePath, csv, 'utf8')
      log.info(`Exported ${rows.length} deployments to ${result.filePath}`)
      return { success: true, filePath: result.filePath, rowCount: rows.length }
    } catch (error) {
      log.error('Error exporting deployments CSV:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:pick-csv-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import deployments CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
    return { filePath: result.filePaths[0] }
  })

  ipcMain.handle('deployments:parse-csv-for-import', async (_event, studyId, filePath) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) return { error: 'Database not found for this study' }

      const db = await getReadonlyDrizzleDb(studyId, dbPath)
      const dbRows = await db
        .select({
          deploymentID: deployments.deploymentID,
          locationID: deployments.locationID,
          locationName: deployments.locationName,
          latitude: deployments.latitude,
          longitude: deployments.longitude
        })
        .from(deployments)
      await closeStudyDatabase(studyId, dbPath)

      const result = await parseDeploymentsCsv(filePath, dbRows)
      if (result.error) return { error: result.error }
      return { data: result }
    } catch (error) {
      log.error('Error parsing deployments CSV:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:apply-csv-import', async (_event, studyId, applyPlan) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) return { error: 'Database not found for this study' }

      const db = await getDrizzleDb(studyId, dbPath)
      const summary = await applyDeploymentsCsv(db, applyPlan)
      await closeStudyDatabase(studyId, dbPath)

      log.info(
        `Applied deployments CSV: ${summary.deploymentsUpdated} updated, ${summary.locationsNamed} names`
      )
      return { success: true, summary }
    } catch (error) {
      log.error('Error applying deployments CSV:', error)
      return { error: error.message }
    }
  })
}
