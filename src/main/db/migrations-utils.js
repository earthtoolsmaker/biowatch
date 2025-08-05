import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Gets the migrations folder path for a specific environment
 * @param {string} environment - 'development', 'test', or 'production'
 * @returns {string} Path to migrations folder
 */
export function getMigrationsPath(environment) {
  switch (environment) {
    case 'development':
    case 'test':
      // In development and test, use source migrations
      return join(process.cwd(), 'src', 'main', 'db', 'migrations')

    case 'production':
      // In production, try extraResources first
      return join(process.resourcesPath, 'db', 'migrations')

    default:
      throw new Error(
        `Unknown environment: ${environment}. Expected 'development', 'test', or 'production'`
      )
  }
}

/**
 * Gets alternative production paths to try as fallbacks
 * @returns {string[]} Array of alternative production paths
 */
function getProductionFallbackPaths() {
  return [join(process.resourcesPath, 'app.asar.unpacked', 'db', 'migrations')]
}

/**
 * Validates that a migrations folder exists and contains required structure
 * @param {string} migrationsPath - Path to check
 * @param {Object} logger - Logger object with info, warn, error methods
 * @returns {boolean} true if valid migrations folder
 */
export function validateMigrationsPath(migrationsPath, logger = console) {
  try {
    if (!existsSync(migrationsPath)) {
      logger.warn(`[DB] Migrations folder does not exist: ${migrationsPath}`)
      return false
    }

    // Check for meta folder which is required by Drizzle
    const metaPath = join(migrationsPath, 'meta')
    if (!existsSync(metaPath)) {
      logger.warn(`[DB] Migrations meta folder does not exist: ${metaPath}`)
      return false
    }

    // Check for journal file
    const journalPath = join(metaPath, '_journal.json')
    if (!existsSync(journalPath)) {
      logger.warn(`[DB] Migrations journal file does not exist: ${journalPath}`)
      return false
    }

    logger.info(`[DB] Validated migrations folder: ${migrationsPath}`)
    return true
  } catch (error) {
    logger.error(`[DB] Error validating migrations path: ${error.message}`)
    return false
  }
}

/**
 * Detects the current environment by checking which migration paths exist
 * @param {Object} logger - Logger object with info, warn, error methods
 * @returns {string} Detected environment ('development', 'production')
 */
export function detectEnvironmentFromFileSystem(logger = console) {
  // Check development path first
  const devPath = getMigrationsPath('development')
  if (existsSync(devPath)) {
    logger.info(`[DB] Detected development environment (found ${devPath})`)
    return 'development'
  }

  // Check production paths
  const prodPath = getMigrationsPath('production')
  if (existsSync(prodPath)) {
    logger.info(`[DB] Detected production environment (found ${prodPath})`)
    return 'production'
  }

  // Check production fallback paths
  const fallbackPaths = getProductionFallbackPaths()
  for (const path of fallbackPaths) {
    if (existsSync(path)) {
      logger.info(`[DB] Detected production environment (found fallback ${path})`)
      return 'production'
    }
  }

  // Default to development if nothing found
  logger.warn('[DB] Could not detect environment from file system, defaulting to development')
  return 'development'
}

/**
 * Gets and validates the migrations path, with environment detection fallback
 * @param {string} [environment] - Optional explicit environment ('development', 'test', 'production')
 * @param {Object} [logger] - Optional logger object with info, warn, error methods
 * @returns {string|null} Valid migrations path or null if not found
 */
export function getValidatedMigrationsPath(environment, logger = console) {
  // Use explicit environment or detect from file system
  const env = environment || detectEnvironmentFromFileSystem(logger)

  logger.info(`[DB] Using environment: ${env}`)

  // Get primary path for environment
  const primaryPath = getMigrationsPath(env)

  if (validateMigrationsPath(primaryPath, logger)) {
    return primaryPath
  }

  // If production and primary path failed, try fallback paths
  if (env === 'production') {
    const fallbackPaths = getProductionFallbackPaths()
    for (const fallbackPath of fallbackPaths) {
      if (validateMigrationsPath(fallbackPath, logger)) {
        logger.info(`[DB] Using fallback production path: ${fallbackPath}`)
        return fallbackPath
      }
    }
  }

  logger.error(`[DB] No valid migrations path found for environment: ${env}`)
  return null
}
