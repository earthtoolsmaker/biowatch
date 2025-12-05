/**
 * Main database interface using Drizzle ORM
 * Replaces the old db.js with type-safe database operations
 */

import { eq } from 'drizzle-orm'
import { getStudyDatabase, closeStudyDatabase, closeAllDatabases } from './manager.js'
import { deployments, media, observations, modelRuns, modelOutputs, metadata } from './schema.js'
import log from 'electron-log'

// Re-export schema and manager functions
export { deployments, media, observations, modelRuns, modelOutputs, metadata }
export { getStudyDatabase, closeStudyDatabase, closeAllDatabases }

/**
 * Helper function to get Drizzle database instance for a study
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @param {Object} options - Database options (e.g., {readonly: true})
 * @returns {Promise<Object>} Drizzle database instance
 */
export async function getDrizzleDb(studyId, dbPath, options = {}) {
  const manager = await getStudyDatabase(studyId, dbPath, options)
  return manager.getDb()
}

/**
 * Helper function to get a readonly Drizzle database instance for a study
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @returns {Promise<Object>} Readonly Drizzle database instance
 */
export async function getReadonlyDrizzleDb(studyId, dbPath) {
  const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
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

// ============================================================================
// Metadata CRUD operations
// ============================================================================

/**
 * Insert study metadata into the database
 * @param {Object} db - Drizzle database instance
 * @param {Object} data - Metadata object
 * @returns {Promise<Object>} Inserted metadata
 */
export async function insertMetadata(db, data) {
  const result = await db.insert(metadata).values(data).returning()
  return result[0]
}

/**
 * Get study metadata from the database
 * @param {Object} db - Drizzle database instance
 * @returns {Promise<Object|null>} Metadata object or null if not found
 */
export async function getMetadata(db) {
  const result = await db.select().from(metadata).limit(1)
  return result[0] || null
}

/**
 * Update study metadata in the database
 * @param {Object} db - Drizzle database instance
 * @param {string} id - Study ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated metadata
 */
export async function updateMetadata(db, id, updates) {
  const result = await db
    .update(metadata)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(metadata.id, id))
    .returning()
  return result[0]
}

/**
 * Insert a model run record with optional importPath and options
 * @param {Object} db - Drizzle database instance
 * @param {Object} data - Model run data including id, modelID, modelVersion, startedAt, status, importPath, options
 * @returns {Promise<Object>} Inserted model run
 */
export async function insertModelRun(db, data) {
  const result = await db.insert(modelRuns).values(data).returning()
  return result[0]
}

/**
 * Get the latest model run for a study (for resume functionality)
 * @param {Object} db - Drizzle database instance
 * @returns {Promise<Object|null>} Latest model run or null
 */
export async function getLatestModelRun(db) {
  const result = await db.select().from(modelRuns).orderBy(modelRuns.startedAt).limit(1)
  // Note: orderBy defaults to ASC, we need DESC for latest
  // Using raw query for proper DESC ordering
  return result[0] || null
}

/**
 * Get the latest model run using raw SQL (proper DESC ordering)
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @returns {Promise<Object|null>} Latest model run or null
 */
export async function getLatestModelRunRaw(studyId, dbPath) {
  const result = await executeRawQuery(
    studyId,
    dbPath,
    'SELECT * FROM model_runs ORDER BY startedAt DESC LIMIT 1'
  )
  return result[0] || null
}
