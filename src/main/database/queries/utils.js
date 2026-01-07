/**
 * Database query utilities
 * Helper functions used across multiple query modules
 */

import { getDrizzleDb, getStudyDatabase, observations } from '../index.js'
import { sql } from 'drizzle-orm'
// Note: observations import kept for checkStudyHasEventIDs
import log from 'electron-log'

/**
 * Detect timestamp format characteristics and format a DateTime to match the original format
 * This preserves the original format (with/without milliseconds, timezone, seconds)
 * @param {DateTime} newDateTime - Luxon DateTime object with the new time
 * @param {string} originalString - Original timestamp string to match format from
 * @returns {string} - Formatted timestamp string matching original format
 */
export function formatToMatchOriginal(newDateTime, originalString) {
  if (!originalString || !newDateTime || !newDateTime.isValid) {
    return newDateTime?.toISO() || null
  }

  // Detect format characteristics from original string
  const hasMilliseconds = /\.\d{3}/.test(originalString)
  const hasTimezone = /Z|[+-]\d{2}:\d{2}$/.test(originalString)
  const hasSeconds = /T\d{2}:\d{2}:\d{2}/.test(originalString)

  // Build Luxon toISO options to match original format
  const options = {
    suppressMilliseconds: !hasMilliseconds,
    suppressSeconds: !hasSeconds,
    includeOffset: hasTimezone
  }

  let result = newDateTime.toISO(options)

  // If original had no timezone indicator, remove it
  if (!hasTimezone && result) {
    result = result.replace(/Z|[+-]\d{2}:\d{2}$/, '')
  }

  return result
}

/**
 * Extract study ID from database path
 * Uses cross-platform path splitting (handles both / and \) to correctly
 * extract the studyId on Windows, macOS, and Linux
 * @param {string} dbPath - Path to the SQLite database
 * @returns {string} - Study ID or 'unknown' if extraction fails
 */
export function getStudyIdFromPath(dbPath) {
  const pathParts = dbPath.split(/[/\\]/)
  return pathParts[pathParts.length - 2] || 'unknown'
}

/**
 * Check if a study has observations with non-null eventIDs (imported from CamtrapDP)
 * Used to determine default sequence grouping behavior in the UI
 */
export async function checkStudyHasEventIDs(dbPath) {
  const startTime = Date.now()
  log.info(`Checking if study has eventIDs: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    const result = await db
      .select({ eventID: observations.eventID })
      .from(observations)
      .where(sql`${observations.eventID} IS NOT NULL AND ${observations.eventID} != ''`)
      .limit(1)

    const hasEventIDs = result.length > 0
    const elapsedTime = Date.now() - startTime
    log.info(`Study has eventIDs: ${hasEventIDs} (checked in ${elapsedTime}ms)`)
    return hasEventIDs
  } catch (error) {
    log.error(`Error checking study eventIDs: ${error.message}`)
    throw error
  }
}

/**
 * Create and initialize a new database for an image directory
 * @param {string} dbPath - Path for the new SQLite database
 * @returns {Promise<Object>} - Database manager instance
 */
export async function createImageDirectoryDatabase(dbPath) {
  log.info(`Creating new database at: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    // Use the Drizzle database manager which will create the database and run migrations
    const manager = await getStudyDatabase(studyId, dbPath)

    log.info(`Successfully created database for study ${studyId} at: ${dbPath}`)
    return manager
  } catch (error) {
    log.error(`Error creating database: ${error.message}`)
    throw error
  }
}
