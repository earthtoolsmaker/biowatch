/**
 * Deployments-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { eq } from 'drizzle-orm'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getDrizzleDb,
  deployments,
  closeStudyDatabase,
  getDeploymentLocations,
  getAllDeployments
} from '../database/index.js'
import { runInWorker } from '../services/sequences/runInWorker.js'

/**
 * Register all deployments-related IPC handlers
 */
export function registerDeploymentsIPCHandlers() {
  // One row per unique (lat, lng) — for read-only overview maps that want
  // "one marker per physical camera-trap location." Drag-editable maps should
  // use deployments:get-all instead so co-located deployments get their own
  // markers.
  ipcMain.handle('deployments:get-locations', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const result = await getDeploymentLocations(dbPath)
      return { data: result }
    } catch (error) {
      log.error('Error getting deployment locations:', error)
      return { error: error.message }
    }
  })

  // All deployments with coords and identifying fields, no dedup. Used by the
  // Deployments tab map so co-located deployments each get their own marker
  // and MarkerClusterGroup can correctly count them.
  ipcMain.handle('deployments:get-all', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const result = await getAllDeployments(dbPath)
      return { data: result }
    } catch (error) {
      log.error('Error getting all deployments:', error)
      return { error: error.message }
    }
  })

  // Per-deployment period-bucket aggregation for the Deployments tab. Runs in
  // the sequences worker so the SUM(CASE) × 20 scan over observations doesn't
  // block the renderer UI on large studies.
  ipcMain.handle('deployments:get-activity', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const activity = await runInWorker({ type: 'deployments-activity', dbPath })
      return { data: activity }
    } catch (error) {
      log.error('Error getting deployments activity:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:set-latitude', async (_, studyId, deploymentID, latitude) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const db = await getDrizzleDb(studyId, dbPath)

      await db
        .update(deployments)
        .set({ latitude: parseFloat(latitude) })
        .where(eq(deployments.deploymentID, deploymentID))

      await closeStudyDatabase(studyId, dbPath)
      log.info(`Updated latitude for deployment ${deploymentID} to ${latitude}`)
      return { success: true }
    } catch (error) {
      log.error('Error updating deployment latitude:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:set-longitude', async (_, studyId, deploymentID, longitude) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const db = await getDrizzleDb(studyId, dbPath)

      await db
        .update(deployments)
        .set({ longitude: parseFloat(longitude) })
        .where(eq(deployments.deploymentID, deploymentID))

      await closeStudyDatabase(studyId, dbPath)
      log.info(`Updated longitude for deployment ${deploymentID} to ${longitude}`)
      return { success: true }
    } catch (error) {
      log.error('Error updating deployment longitude:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:set-location-name', async (_, studyId, locationID, locationName) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const db = await getDrizzleDb(studyId, dbPath)

      // Update ALL deployments with this locationID (handles grouped deployments)
      await db
        .update(deployments)
        .set({ locationName: locationName.trim() })
        .where(eq(deployments.locationID, locationID))

      await closeStudyDatabase(studyId, dbPath)
      log.info(`Updated locationName for locationID ${locationID} to "${locationName}"`)
      return { success: true }
    } catch (error) {
      log.error('Error updating deployment location name:', error)
      return { error: error.message }
    }
  })
}
