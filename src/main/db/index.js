/**
 * Main database interface using Drizzle ORM
 * Replaces the old db.js with type-safe database operations
 */

import { getStudyDatabase, closeStudyDatabase, closeAllDatabases } from './manager.js'
import { deployments, media, observations } from './schema.js'
import log from 'electron-log'

// Re-export schema and manager functions
export { deployments, media, observations }
export { getStudyDatabase, closeStudyDatabase, closeAllDatabases }

/**
 * Helper function to get Drizzle database instance for a study
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @returns {Promise<Object>} Drizzle database instance
 */
export async function getDrizzleDb(studyId, dbPath) {
  const manager = await getStudyDatabase(studyId, dbPath)
  return manager.getDb()
}

/**
 * Helper function to execute raw SQL queries when needed
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
export async function executeRawQuery(studyId, dbPath, query, params = []) {
  const manager = await getStudyDatabase(studyId, dbPath)
  const sqlite = manager.getSqlite()

  try {
    const statement = sqlite.prepare(query)
    return statement.all(params)
  } catch (error) {
    log.error(`[DB] Raw query failed for study ${studyId}:`, error)
    throw error
  }
}
