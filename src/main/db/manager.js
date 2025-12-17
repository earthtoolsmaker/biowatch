import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import log from 'electron-log'
import * as schema from './schema.js'
import { getValidatedMigrationsPath } from './migrations-utils.js'

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
      // Ensure directory exists
      const dbDir = dirname(this.dbPath)
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true })
      }

      // Create SQLite connection with appropriate mode
      if (this.readonly) {
        this.sqlite = new Database(this.dbPath, { readonly: true })
        log.info(`[DB] Initialized READONLY database for study ${this.studyId}: ${this.dbPath}`)

        // Skip migrations and foreign key setup for readonly connections
        this.db = drizzle(this.sqlite, { schema })
      } else {
        this.sqlite = new Database(this.dbPath)

        // Enable foreign keys
        this.sqlite.pragma('foreign_keys = ON')

        // Enable WAL journal mode for better write performance
        this.sqlite.pragma('journal_mode = WAL')

        log.info(`[DB] Initialized READ-WRITE database for study ${this.studyId}: ${this.dbPath}`)

        // Run migrations FIRST on raw SQLite connection (before schema attachment)
        await this.runMigrations()

        // THEN create Drizzle instance with schema (after migrations are complete)
        this.db = drizzle(this.sqlite, { schema })
      }

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

      // Check if migration tracking table exists
      await this.checkMigrationState()

      // Get validated migrations path with explicit logger injection
      const migrationsPath = getValidatedMigrationsPath(undefined, log)

      if (migrationsPath) {
        log.info(`[DB] Running migrations from ${migrationsPath}`)

        try {
          // Create a temporary Drizzle instance WITHOUT schema for migrations only
          const migrationDb = drizzle(this.sqlite)
          await migrate(migrationDb, { migrationsFolder: migrationsPath })
          log.info(`[DB] Migrations completed for study ${this.studyId}`)

          // Verify migration state after successful migration
          await this.checkMigrationState()
        } catch (migrationError) {
          // If migration fails due to tables already existing, check if this is expected
          if (
            migrationError.message.includes('already exists') ||
            migrationError.message.includes('CREATE TABLE')
          ) {
            log.warn(`[DB] Migration attempted to create existing tables for study ${this.studyId}`)
            await this.validateExistingSchema()
          } else {
            throw migrationError
          }
        }
      } else {
        log.warn(`[DB] No valid migrations folder found for study ${this.studyId}`)
        log.info(`[DB] Database will be created with current schema on first use`)
        // Note: Drizzle will create tables from schema when first accessed
        // This is a fallback behavior if migrations are not available
      }
    } catch (error) {
      log.error(`[DB] Migration failed for study ${this.studyId}:`, error)
      throw error
    }
  }

  /**
   * Check the current migration state of the database
   */
  async checkMigrationState() {
    try {
      // Check if Drizzle migration tracking table exists
      const tables = this.sqlite
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='__drizzle_migrations'
      `
        )
        .all()

      if (tables.length > 0) {
        log.info(`[DB] Migration tracking table exists for study ${this.studyId}`)

        // Get applied migrations
        const appliedMigrations = this.sqlite
          .prepare(
            `
          SELECT * FROM __drizzle_migrations ORDER BY id
        `
          )
          .all()

        log.info(`[DB] Applied migrations for study ${this.studyId}:`, appliedMigrations)
      } else {
        log.info(`[DB] No migration tracking table found for study ${this.studyId}`)
      }

      // Check if main tables exist
      const mainTables = this.sqlite
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN ('deployments', 'media', 'observations')
      `
        )
        .all()

      log.info(
        `[DB] Existing main tables for study ${this.studyId}:`,
        mainTables.map((t) => t.name)
      )
    } catch (error) {
      log.error(`[DB] Error checking migration state for study ${this.studyId}:`, error)
    }
  }

  /**
   * Validate that existing schema matches expected schema
   */
  async validateExistingSchema() {
    try {
      log.info(`[DB] Validating existing schema for study ${this.studyId}`)

      // Check if all required tables exist
      const requiredTables = ['deployments', 'media', 'observations']
      const existingTables = this.sqlite
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN (${requiredTables.map(() => '?').join(', ')})
      `
        )
        .all(...requiredTables)

      if (existingTables.length === requiredTables.length) {
        log.info(
          `[DB] All required tables exist for study ${this.studyId}, schema validation passed`
        )
      } else {
        const missing = requiredTables.filter(
          (table) => !existingTables.some((existing) => existing.name === table)
        )
        log.warn(`[DB] Missing tables for study ${this.studyId}:`, missing)
      }
    } catch (error) {
      log.error(`[DB] Error validating schema for study ${this.studyId}:`, error)
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
        // Checkpoint WAL to release file locks (required for Windows)
        if (!this.readonly) {
          this.sqlite.pragma('wal_checkpoint(TRUNCATE)')
        }
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
