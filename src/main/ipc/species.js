/**
 * Species-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from '../services/logger.js'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getSpeciesDistribution,
  getVehicleMediaCount,
  getDistinctSpecies,
  getLowConfidenceCount
} from '../database/index.js'
import { runInWorker } from '../services/sequences/runInWorker.js'

/**
 * Register all species-related IPC handlers
 */
export function registerSpeciesIPCHandlers() {
  ipcMain.handle('species:get-distribution', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      log.info('Dd path for study:', dbPath)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const distribution = await getSpeciesDistribution(dbPath)
      return { data: distribution }
    } catch (error) {
      log.error('Error getting species distribution:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('species:get-blank-count', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      // Off the main thread — the notExists scan is ~465ms on the largest
      // GMU8-pattern study even with the covering index.
      const blankCount = await runInWorker({ type: 'blank-count', dbPath })
      return { data: blankCount }
    } catch (error) {
      log.error('Error getting blank media count:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('species:get-vehicle-count', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const vehicleCount = await getVehicleMediaCount(dbPath)
      return { data: vehicleCount }
    } catch (error) {
      log.error('Error getting vehicle media count:', error)
      return { error: error.message }
    }
  })

  // Count of media whose only/any machine classification is below the
  // confidence threshold — drives the Media tab's "Low confidence" quick view.
  ipcMain.handle('species:get-low-confidence-count', async (_, studyId, threshold) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const lowConfidenceCount = await getLowConfidenceCount(dbPath, threshold)
      return { data: lowConfidenceCount }
    } catch (error) {
      log.error('Error getting low confidence media count:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('species:get-distinct', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const species = await getDistinctSpecies(dbPath)
      return { data: species }
    } catch (error) {
      log.error('Error getting distinct species:', error)
      return { error: error.message }
    }
  })

  // Get best image per species for hover tooltips. Dispatched to the
  // sequences worker because the multi-CTE scoring scan, and even the
  // no-bbox short-circuit probe, are O(observations) and block the main
  // event loop for ~1-2s on large studies — which (since IPC replies are
  // delivered on main) makes sibling queries like the Overview KPI band
  // appear frozen even though their own work has already finished.
  ipcMain.handle('species:get-best-images', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const bestImages = await runInWorker({ type: 'best-images-per-species', dbPath })
      return { data: bestImages }
    } catch (error) {
      log.error('Error getting best images per species:', error)
      return { error: error.message }
    }
  })
}
