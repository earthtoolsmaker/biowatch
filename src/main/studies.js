import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import { getReadonlyDrizzleDb, getDrizzleDb, getMetadata, updateMetadata } from './db/index.js'

const studiesPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies')

/**
 * Get study metadata from the database
 * @param {string} studyId - Study ID
 * @returns {Promise<Object|null>} Study metadata or null
 */
async function getStudyFromDb(studyId) {
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

app.whenReady().then(() => {
  ipcMain.handle('studies:list', async () => {
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
              ...study,
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
  })

  ipcMain.handle('studies:update', async (event, id, update) => {
    log.info('Updating study', id, 'with update:', update)

    const dbPath = path.join(studiesPath, id, 'study.db')
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
        if (update.data.temporal?.start !== undefined)
          dbUpdate.startDate = update.data.temporal.start
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
  })
})

export default {}
