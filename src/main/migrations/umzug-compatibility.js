import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { createUmzug } from './umzug-index.js'

/**
 * Migration helper for transitioning from the old custom system to Umzug
 * This handles compatibility with the existing .biowatch-version file
 */

/**
 * Migrate from old version tracking to Umzug's JSON storage
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<void>}
 */
export async function migrateToUmzug(userDataPath) {
  const oldVersionFile = join(userDataPath, '.biowatch-version')
  const umzugStorageFile = join(userDataPath, '.biowatch-migrations.json')
  
  // If Umzug storage already exists, we're already migrated
  if (existsSync(umzugStorageFile)) {
    return
  }
  
  // Check if we have an old version file
  if (existsSync(oldVersionFile)) {
    try {
      const currentVersion = readFileSync(oldVersionFile, 'utf8').trim()
      
      // Create Umzug storage with the current version marked as executed
      const executedMigrations = []
      
      // If we have a version, mark all migrations up to that version as executed
      if (currentVersion) {
        executedMigrations.push(currentVersion)
      }
      
      // Write the Umzug storage file
      writeFileSync(umzugStorageFile, JSON.stringify(executedMigrations), 'utf8')
      
      console.info(`Migrated version tracking from ${oldVersionFile} to Umzug storage`)
    } catch (error) {
      console.warn('Failed to migrate old version file:', error.message)
    }
  } else {
    // No old version file, check if we need to detect old structure
    const needsMigration = await detectOldStructure(userDataPath)
    
    if (needsMigration) {
      // Old structure exists but no version file - this means we need to run migrations
      writeFileSync(umzugStorageFile, JSON.stringify([]), 'utf8')
    } else {
      // Fresh install - mark all migrations as executed to avoid running them
      const allMigrationNames = ['v1.0.15'] // List all known migration names
      writeFileSync(umzugStorageFile, JSON.stringify(allMigrationNames), 'utf8')
    }
  }
}

/**
 * Detect if old database structure exists (for migration detection)
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<boolean>} True if old structure detected
 */
async function detectOldStructure(userDataPath) {
  try {
    const files = readdirSync(userDataPath)
    const dbFiles = files.filter((file) => file.endsWith('.db') && !file.startsWith('.'))
    return dbFiles.length > 0
  } catch {
    return false
  }
}

/**
 * Enhanced isMigrationNeeded that handles the transition
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<boolean>} True if migration is needed
 */
export async function isMigrationNeeded(userDataPath) {
  // First, ensure we've migrated to Umzug
  await migrateToUmzug(userDataPath)

  // Now use Umzug to check for pending migrations
  const umzug = createUmzug(userDataPath)
  const pending = await umzug.pending()
  return pending.length > 0
}
