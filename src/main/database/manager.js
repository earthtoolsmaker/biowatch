import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import log from '../services/logger.js'
import * as schema from './models.js'
import { registerCameraTimeFunctions } from '../services/cameraTime.js'
import { migrateStudyConnection } from './migrate-study.js'
import {
  assertStudyNotBlocked,
  databaseFailure,
  databaseNotReadyError,
  inspectDatabaseVersion,
  setStudyDatabaseStatus
} from './study-readiness.js'

/**
 * Database manager for individual study databases with Drizzle ORM
 */
export class StudyDatabaseManager {
  constructor(studyId, dbPath, options = {}) {
    this.studyId = studyId
    this.dbPath = dbPath
    this.readonly = options.readonly || false
    this.sqlite = null
    this.db = null
  }

  /**
   * Initialize the database connection and run migrations
   */
  async initialize() {
    try {
      assertStudyNotBlocked(this.dbPath)
      // Ensure directory exists
      const dbDir = dirname(this.dbPath)
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true })
      }

      // Create SQLite connection with appropriate mode
      if (this.readonly) {
        this.sqlite = new Database(this.dbPath, { readonly: true })
        const status = inspectDatabaseVersion(this.sqlite)
        if (status.status !== 'ready') throw databaseNotReadyError(status)
        registerCameraTimeFunctions(this.sqlite)
        log.info(`[DB] Initialized READONLY database for study ${this.studyId}: ${this.dbPath}`)

        // Skip migrations and foreign key setup for readonly connections
        this.db = drizzle(this.sqlite, { schema })
      } else {
        this.sqlite = new Database(this.dbPath)

        log.info(`[DB] Initialized READ-WRITE database for study ${this.studyId}: ${this.dbPath}`)

        // Run migrations FIRST on raw SQLite connection (before schema attachment)
        await this.runMigrations()

        // THEN create Drizzle instance with schema (after migrations are complete)
        this.db = drizzle(this.sqlite, { schema })
      }

      return this
    } catch (error) {
      this.sqlite?.close()
      this.sqlite = null
      setStudyDatabaseStatus(this.dbPath, databaseFailure(error))
      log.error(`[DB] Failed to initialize database for study ${this.studyId}:`, error)
      throw error
    }
  }

  /** Run pending migrations and require the expected database version. */
  async runMigrations() {
    const status = migrateStudyConnection(this.sqlite)
    setStudyDatabaseStatus(this.dbPath, status)
  }

  /**
   * Get the Drizzle database instance
   */
  getDb() {
    if (!this.db) {
      throw new Error(`Database not initialized for study ${this.studyId}`)
    }
    return this.db
  }

  /**
   * Get the raw SQLite instance (for complex queries if needed)
   */
  getSqlite() {
    if (!this.sqlite) {
      throw new Error(`Database not initialized for study ${this.studyId}`)
    }
    return this.sqlite
  }

  /**
   * Close the database connection
   */
  async close() {
    try {
      if (this.sqlite) {
        this.sqlite.close()
        log.info(`[DB] Closed database for study ${this.studyId}`)
      }
    } catch (error) {
      log.error(`[DB] Error closing database for study ${this.studyId}:`, error)
      throw error
    }
  }

  /**
   * Execute a transaction
   */
  async transaction(callback) {
    return this.sqlite.transaction(callback)()
  }

  /**
   * Set aggressive SQLite pragmas for bulk import operations.
   * Trades durability for speed - safe for re-importable data like LILA datasets.
   * MUST call resetImportMode() after import completes.
   * Note: We keep WAL mode's default locking to allow concurrent UI reads.
   */
  setImportMode() {
    if (this.readonly) {
      log.warn(`[DB] Cannot set import mode on readonly database for study ${this.studyId}`)
      return
    }
    log.info(`[DB] Enabling import mode for study ${this.studyId}`)
    this.sqlite.pragma('synchronous = OFF')
    this.sqlite.pragma('cache_size = -256000') // 256MB cache
    this.sqlite.pragma('temp_store = MEMORY')
    this.sqlite.pragma('mmap_size = 1073741824') // 1GB memory-mapped I/O
    // Note: NOT setting locking_mode = EXCLUSIVE as it blocks UI reads
  }

  /**
   * Reset SQLite pragmas to safe defaults after bulk import.
   */
  resetImportMode() {
    if (this.readonly) {
      return
    }
    log.info(`[DB] Resetting import mode for study ${this.studyId}`)
    this.sqlite.pragma('synchronous = NORMAL')
  }
}

// Cache for database connections
const dbConnections = new Map()

/**
 * Get or create a database manager for a study
 */
export async function getStudyDatabase(studyId, dbPath, options = {}) {
  assertStudyNotBlocked(dbPath)
  const readonly = options.readonly || false
  const cacheKey = `${studyId}:${dbPath}:${readonly ? 'readonly' : 'readwrite'}`

  if (!dbConnections.has(cacheKey)) {
    const manager = new StudyDatabaseManager(studyId, dbPath, options)
    await manager.initialize()
    dbConnections.set(cacheKey, manager)

    log.info(
      `[DB] Created new ${readonly ? 'READONLY' : 'READ-WRITE'} database connection for study ${studyId}`
    )
  }

  return dbConnections.get(cacheKey)
}

/**
 * Close and remove a study database connection
 */
export async function closeStudyDatabase(studyId, dbPath = null) {
  if (dbPath) {
    const cacheKey = `${studyId}:${dbPath}`
    const manager = dbConnections.get(cacheKey)
    if (manager) {
      await manager.close()
      dbConnections.delete(cacheKey)
      log.info(`[DB] Closed database connection for study ${studyId}`)
    }
  } else {
    // Close all connections for this study ID
    const keysToDelete = []
    for (const [key, manager] of dbConnections.entries()) {
      if (key.startsWith(`${studyId}:`)) {
        await manager.close()
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach((key) => dbConnections.delete(key))
    log.info(`[DB] Closed all database connections for study ${studyId}`)
  }
}

/**
 * Close all database connections (for app shutdown)
 */
export async function closeAllDatabases() {
  log.info('[DB] Closing all database connections')

  const closePromises = Array.from(dbConnections.values()).map((manager) => manager.close())
  await Promise.all(closePromises)

  dbConnections.clear()
  log.info('[DB] All database connections closed')
}

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
