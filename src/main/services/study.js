/**
 * Study management service
 * Business logic for managing studies (list, update, etc.)
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import {
  getReadonlyDrizzleDb,
  getDrizzleDb,
  getMetadata,
  updateMetadata
} from '../database/index.js'

/**
 * Get the studies directory path
 * @returns {string} Path to the studies directory
 */
export function getStudiesPath() {
  return path.join(app.getPath('userData'), 'biowatch-data', 'studies')
}

/**
 * Get study metadata from the database
 * @param {string} studyId - Study ID
 * @returns {Promise<Object|null>} Study metadata or null
 */
export async function getStudyFromDb(studyId) {
  const studiesPath = getStudiesPath()
  const dbPath = path.join(studiesPath, studyId, 'study.db')
  if (!fs.existsSync(dbPath)) {
    return null
  }

  try {
    const db = await getReadonlyDrizzleDb(studyId, dbPath)
    const metadata = await getMetadata(db)
    return metadata
  } catch (error) {
    log.error(`Error reading metadata for study ${studyId}:`, error)
    return null
  }
}

/**
 * List all studies with their metadata
 * @returns {Promise<Array>} Array of study objects
 */
export async function listStudies() {
  const studiesPath = getStudiesPath()

  // Ensure studies directory exists
  if (!fs.existsSync(studiesPath)) {
    return []
  }

  // List directories in studiesPath
  const studyDirs = fs
    .readdirSync(studiesPath, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)

  // Read metadata from DB for each study directory
  const studies = await Promise.all(
    studyDirs.map(async (studyId) => {
      try {
        const study = await getStudyFromDb(studyId)
        if (!study) return null
        // Wrap metadata in expected structure for frontend
        return {
          id: studyId,
          name: study.name || study.title,
          importerName: study.importerName,
          createdAt: study.created,
          path: null,
          data: {
            id: study.id,
            name: study.name,
            title: study.title,
            description: study.description,
            created: study.created,
            importerName: study.importerName,
            contributors: study.contributors,
            updatedAt: study.updatedAt,
            temporal:
              study.startDate || study.endDate
                ? { start: study.startDate || null, end: study.endDate || null }
                : null
          }
        }
      } catch (error) {
        log.warn(`Failed to read metadata for study ${studyId}:`, error.message)
        return {
          id: studyId,
          error: 'Failed to load study data'
        }
      }
    })
  )

  return studies.filter((study) => study)
}

/**
 * Update study metadata
 * @param {string} id - Study ID
 * @param {Object} update - Update object with data to update
 * @returns {Promise<Object|null>} Updated metadata or null
 */
export async function updateStudy(id, update) {
  const studiesPath = getStudiesPath()
  const dbPath = path.join(studiesPath, id, 'study.db')

  log.info('Updating study', id, 'with update:', JSON.stringify(update, null, 2))

  if (!fs.existsSync(dbPath)) {
    log.error(`Can't update study with id ${id}: database not found`)
    return null
  }

  try {
    const db = await getDrizzleDb(id, dbPath)

    // Extract fields from nested data structure (frontend sends { data: {...} })
    const dbUpdate = {}
    if (update.data) {
      if (update.data.description !== undefined) dbUpdate.description = update.data.description
      if (update.data.contributors !== undefined) dbUpdate.contributors = update.data.contributors
      if (update.data.temporal?.start !== undefined) dbUpdate.startDate = update.data.temporal.start
      if (update.data.temporal?.end !== undefined) dbUpdate.endDate = update.data.temporal.end
    }
    // Also accept flat updates (e.g., name for title editing)
    if (update.name !== undefined) dbUpdate.name = update.name

    const updated = await updateMetadata(db, id, dbUpdate)
    log.info(`Updated study ${id}`)
    return updated
  } catch (error) {
    log.error(`Error updating study ${id}:`, error)
    return null
  }
}
