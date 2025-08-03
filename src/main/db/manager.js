import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import log from 'electron-log'
import * as schema from './schema.js'

/**
 * Database manager for individual study databases with Drizzle ORM
 */
export class StudyDatabaseManager {
  constructor(studyId, dbPath) {
    this.studyId = studyId
    this.dbPath = dbPath
    this.sqlite = null
    this.db = null
  }

  /**
   * Initialize the database connection and run migrations
   */
  async initialize() {
    try {
      // Ensure directory exists
      const dbDir = dirname(this.dbPath)
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true })
      }

      // Create SQLite connection
      this.sqlite = new Database(this.dbPath)
      
      // Enable foreign keys
      this.sqlite.pragma('foreign_keys = ON')
      
      // Create Drizzle instance
      this.db = drizzle(this.sqlite, { schema })

      log.info(`[DB] Initialized database for study ${this.studyId}: ${this.dbPath}`)

      // Run migrations
      await this.runMigrations()

      return this
    } catch (error) {
      log.error(`[DB] Failed to initialize database for study ${this.studyId}:`, error)
      throw error
    }
  }

  /**
   * Run pending migrations for this study database
   */
  async runMigrations() {
    try {
      log.info(`[DB] Checking migrations for study ${this.studyId}`)
      
      // Check if migrations folder exists
      const migrationsPath = new URL('../../db/migrations', import.meta.url).pathname
      
      if (existsSync(migrationsPath)) {
        log.info(`[DB] Running migrations from ${migrationsPath}`)
        await migrate(this.db, { migrationsFolder: migrationsPath })
        log.info(`[DB] Migrations completed for study ${this.studyId}`)
      } else {
        log.info(`[DB] No migrations folder found, creating initial schema for study ${this.studyId}`)
        // For initial setup, we'll rely on Drizzle to create tables from schema
        // This happens automatically when we first query
      }
    } catch (error) {
      log.error(`[DB] Migration failed for study ${this.studyId}:`, error)
      throw error
    }
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
}

// Cache for database connections
const dbConnections = new Map()

/**
 * Get or create a database manager for a study
 */
export async function getStudyDatabase(studyId, dbPath) {
  const cacheKey = `${studyId}:${dbPath}`
  
  if (!dbConnections.has(cacheKey)) {
    const manager = new StudyDatabaseManager(studyId, dbPath)
    await manager.initialize()
    dbConnections.set(cacheKey, manager)
    
    log.info(`[DB] Created new database connection for study ${studyId}`)
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
    keysToDelete.forEach(key => dbConnections.delete(key))
    log.info(`[DB] Closed all database connections for study ${studyId}`)
  }
}

/**
 * Close all database connections (for app shutdown)
 */
export async function closeAllDatabases() {
  log.info('[DB] Closing all database connections')
  
  const closePromises = Array.from(dbConnections.values()).map(manager => manager.close())
  await Promise.all(closePromises)
  
  dbConnections.clear()
  log.info('[DB] All database connections closed')
}