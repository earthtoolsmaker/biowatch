/**
 * Observations-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  updateObservationClassification,
  updateObservationBbox,
  deleteObservation,
  createObservation
} from '../database/index.js'

/**
 * Register all observations-related IPC handlers
 */
export function registerObservationsIPCHandlers() {
  // Update observation classification (species) - CamTrap DP compliant
  ipcMain.handle(
    'observations:update-classification',
    async (_, studyId, observationID, updates) => {
      try {
        const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
        if (!dbPath || !existsSync(dbPath)) {
          log.warn(`Database not found for study ID: ${studyId}`)
          return { error: 'Database not found for this study' }
        }

        const updatedObservation = await updateObservationClassification(
          dbPath,
          observationID,
          updates
        )
        return { data: updatedObservation }
      } catch (error) {
        log.error('Error updating observation classification:', error)
        return { error: error.message }
      }
    }
  )

  // Update observation bounding box coordinates
  ipcMain.handle('observations:update-bbox', async (_, studyId, observationID, bboxUpdates) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const updatedObservation = await updateObservationBbox(dbPath, observationID, bboxUpdates)
      return { data: updatedObservation }
    } catch (error) {
      log.error('Error updating observation bbox:', error)
      return { error: error.message }
    }
  })

  // Delete observation
  ipcMain.handle('observations:delete', async (_, studyId, observationID) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const result = await deleteObservation(dbPath, observationID)
      return { data: result }
    } catch (error) {
      log.error('Error deleting observation:', error)
      return { error: error.message }
    }
  })

  // Create new observation with bbox
  ipcMain.handle('observations:create', async (_, studyId, observationData) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const newObservation = await createObservation(dbPath, observationData)
      return { data: newObservation }
    } catch (error) {
      log.error('Error creating observation:', error)
      return { error: error.message }
    }
  })
}
