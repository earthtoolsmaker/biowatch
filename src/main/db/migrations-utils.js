import { existsSync } from 'fs'
import { join } from 'path'

// Conditionally import electron modules for testing compatibility
let app, log

// Initialize fallback values immediately for test environment
app = {
  isPackaged: false,
  getPath: () => '/tmp'
}
log = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

async function initializeElectronModules() {
  if (app && log && app.getAppPath) return // Already initialized with real electron modules

  try {
    const electron = await import('electron')
    app = electron.app
    const electronLog = await import('electron-log')
    log = electronLog.default
  } catch {
    // Keep fallback values for testing environment - already set above
  }
}

/**
 * Determines if the application is running in development mode
 * @returns {Promise<boolean>} true if in development, false if in production
 */
export async function isDevelopment() {
  await initializeElectronModules()
  // Ensure app is defined with fallback
  if (!app) {
    app = { isPackaged: false, getPath: () => '/tmp' }
  }
  return !app.isPackaged
}

/**
 * Gets the correct migrations folder path for both development and production
 * @returns {Promise<string>} Path to migrations folder
 */
export async function getMigrationsPath() {
  await initializeElectronModules()
  // Ensure app is defined with fallback
  if (!app) {
    app = { isPackaged: false, getPath: () => '/tmp' }
  }
  if (!app.isPackaged) {
    // In development, use absolute path to source migrations
    const devPath = join(process.cwd(), 'src', 'main', 'db', 'migrations')
    log.info(`[DB] Using development migrations path: ${devPath}`)
    return devPath
  } else {
    // In production, use the migrations from extraResources
    const prodPath = join(process.resourcesPath, 'db', 'migrations')
    log.info(`[DB] Using production migrations path: ${prodPath}`)
    return prodPath
  }
}

/**
 * Validates that the migrations folder exists and contains migration files
 * @param {string} migrationsPath - Path to check
 * @returns {Promise<boolean>} true if valid migrations folder
 */
export async function validateMigrationsPath(migrationsPath) {
  await initializeElectronModules()
  try {
    if (!existsSync(migrationsPath)) {
      log.warn(`[DB] Migrations folder does not exist: ${migrationsPath}`)
      return false
    }

    // Check for meta folder which is required by Drizzle
    const metaPath = join(migrationsPath, 'meta')
    if (!existsSync(metaPath)) {
      log.warn(`[DB] Migrations meta folder does not exist: ${metaPath}`)
      return false
    }

    // Check for journal file
    const journalPath = join(metaPath, '_journal.json')
    if (!existsSync(journalPath)) {
      log.warn(`[DB] Migrations journal file does not exist: ${journalPath}`)
      return false
    }

    log.info(`[DB] Validated migrations folder: ${migrationsPath}`)
    return true
  } catch (error) {
    log.error(`[DB] Error validating migrations path: ${error.message}`)
    return false
  }
}

/**
 * Gets and validates the migrations path, with fallback behavior
 * @returns {Promise<string|null>} Valid migrations path or null if not found
 */
export async function getValidatedMigrationsPath() {
  await initializeElectronModules()
  // Ensure app is defined with fallback
  if (!app) {
    app = { isPackaged: false, getPath: () => '/tmp' }
  }
  const migrationsPath = await getMigrationsPath()

  if (await validateMigrationsPath(migrationsPath)) {
    return migrationsPath
  }

  // Fallback: try alternative paths
  if (app.isPackaged) {
    // Try alternative production path
    const altPath = join(process.resourcesPath, 'app.asar.unpacked', 'db', 'migrations')
    if (await validateMigrationsPath(altPath)) {
      log.info(`[DB] Using alternative production path: ${altPath}`)
      return altPath
    }
  }

  log.error('[DB] No valid migrations path found')
  return null
}
