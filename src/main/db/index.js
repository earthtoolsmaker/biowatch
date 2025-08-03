/**
 * Main database interface using Drizzle ORM
 * Replaces the old db.js with type-safe database operations
 */

import { getStudyDatabase, closeStudyDatabase, closeAllDatabases } from './manager.js'
import { deployments, media, observations } from './schema.js'
import { eq, and, desc, asc, count, sql } from 'drizzle-orm'
import log from 'electron-log'

// Re-export schema and manager functions
export { deployments, media, observations }
export { getStudyDatabase, closeStudyDatabase, closeAllDatabases }

/**
 * Legacy function compatibility - setup database (now handled by migrations)
 * @param {Object} db - Database instance (ignored in Drizzle version)
 * @deprecated Use getStudyDatabase instead
 */
export function setupDatabase(db) {
  log.warn('[DB] setupDatabase is deprecated - schema is now managed by Drizzle migrations')
  // No-op - schema is managed by Drizzle migrations
}

/**
 * Legacy function compatibility - open database
 * @param {string} dbPath - Path to database file
 * @returns {Promise<Object>} Database manager instance
 * @deprecated Use getStudyDatabase instead
 */
export async function openDatabase(dbPath) {
  log.warn('[DB] openDatabase is deprecated - use getStudyDatabase instead')
  
  // Extract study ID from path for compatibility
  // Path format: .../studies/{studyId}/study.db
  const pathParts = dbPath.split('/')
  const studyId = pathParts[pathParts.length - 2] || 'unknown'
  
  const manager = await getStudyDatabase(studyId, dbPath)
  
  // Return an object that mimics the old sqlite3 interface
  return {
    manager,
    db: manager.getDb(),
    sqlite: manager.getSqlite(),
    // Legacy methods for compatibility
    serialize: (callback) => callback(),
    run: (sql, params, callback) => {
      try {
        const result = manager.getSqlite().prepare(sql).run(params)
        if (callback) callback(null, result)
        return result
      } catch (error) {
        if (callback) callback(error)
        throw error
      }
    },
    all: (sql, params, callback) => {
      try {
        const result = manager.getSqlite().prepare(sql).all(params)
        if (callback) callback(null, result)
        return result
      } catch (error) {
        if (callback) callback(error)
        throw error
      }
    },
    get: (sql, params, callback) => {
      try {
        const result = manager.getSqlite().prepare(sql).get(params)
        if (callback) callback(null, result)
        return result
      } catch (error) {
        if (callback) callback(error)
        throw error
      }
    }
  }
}

/**
 * Legacy function compatibility - close database
 * @param {Object} db - Database instance
 * @returns {Promise<void>}
 * @deprecated Use closeStudyDatabase instead
 */
export async function closeDatabase(db) {
  log.warn('[DB] closeDatabase is deprecated - use closeStudyDatabase instead')
  
  if (db && db.manager) {
    await db.manager.close()
  }
}

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