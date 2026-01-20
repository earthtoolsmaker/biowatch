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
  getDeployments,
  getDeploymentsActivity
} from '../database/index.js'

/**
 * Register all deployments-related IPC handlers
 */
export function registerDeploymentsIPCHandlers() {
  ipcMain.handle('deployments:get', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const result = await getDeployments(dbPath)
      return { data: result }
    } catch (error) {
      log.error('Error getting deployments:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:get-activity', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const activity = await getDeploymentsActivity(dbPath)
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
