/**
 * Species-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getSpeciesDistribution,
  getBlankMediaCount,
  getDistinctSpecies,
  getBestImagePerSpecies,
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia
} from '../database/index.js'

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

      const blankCount = await getBlankMediaCount(dbPath)
      return { data: blankCount }
    } catch (error) {
      log.error('Error getting blank media count:', error)
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

  // Get best image per species for hover tooltips
  ipcMain.handle('species:get-best-images', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const bestImages = await getBestImagePerSpecies(dbPath)
      return { data: bestImages }
    } catch (error) {
      log.error('Error getting best images per species:', error)
      return { error: error.message }
    }
  })

  // Get species distribution grouped by media for sequence-aware counting
  ipcMain.handle('species:get-distribution-by-media', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const distribution = await getSpeciesDistributionByMedia(dbPath)
      return { data: distribution }
    } catch (error) {
      log.error('Error getting species distribution by media:', error)
      return { error: error.message }
    }
  })

  // Get species timeseries by media for sequence-aware counting
  ipcMain.handle('species:get-timeseries-by-media', async (_, studyId, species) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const timeseries = await getSpeciesTimeseriesByMedia(dbPath, species)
      return { data: timeseries }
    } catch (error) {
      log.error('Error getting species timeseries by media:', error)
      return { error: error.message }
    }
  })
}
