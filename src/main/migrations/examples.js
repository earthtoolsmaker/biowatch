/**
 * Example usage of the Umzug-based migration system
 * 
 * This file demonstrates how to use the new migration system in your application
 */

import { 
  runMigrations, 
  isMigrationNeeded, 
  getMigrationStatus,
  rollbackToVersion
} from './migrations.js'

/**
 * Example: Check and run migrations during app startup
 */
export async function handleAppStartupMigrations(userDataPath, logger = console) {
  try {
    // Check if any migrations are needed
    const needsMigration = await isMigrationNeeded(userDataPath)
    
    if (needsMigration) {
      logger.info('Migrations needed, starting migration process...')
      
      // Get current migration status
      const statusBefore = await getMigrationStatus(userDataPath)
      logger.info('Current migration status:', {
        currentVersion: statusBefore.currentVersion,
        pendingMigrations: statusBefore.pendingMigrations
      })
      
      // Run all pending migrations
      await runMigrations(userDataPath, logger)
      
      // Verify migrations completed
      const statusAfter = await getMigrationStatus(userDataPath)
      logger.info('Migration completed successfully:', {
        currentVersion: statusAfter.currentVersion,
        executedMigrations: statusAfter.executedMigrations
      })
    } else {
      logger.info('No migrations needed, app is up to date')
    }
  } catch (error) {
    logger.error('Migration failed:', error)
    throw error
  }
}

/**
 * Example: Manual migration management
 */
export async function manualMigrationExample(userDataPath) {
  // Get detailed migration status
  const status = await getMigrationStatus(userDataPath)
  
  console.log('Migration Status:')
  console.log('- Current Version:', status.currentVersion)
  console.log('- Latest Version:', status.latestVersion)
  console.log('- Needs Migration:', status.needsMigration)
  console.log('- Executed Migrations:', status.executedMigrations)
  console.log('- Pending Migrations:', status.pendingMigrations)
  
  // Example: Rollback to a specific version (be careful!)
  if (status.currentVersion === 'v1.0.15') {
    try {
      console.log('Rolling back to previous version...')
      await rollbackToVersion(userDataPath, 'v1.0.14')
      console.log('Rollback completed')
    } catch (error) {
      console.error('Rollback failed:', error.message)
      // This is expected if v1.0.14 doesn't exist or rollback isn't supported
    }
  }
}

/**
 * Example: Error handling and recovery
 */
export async function robustMigrationExample(userDataPath, logger = console) {
  let migrationAttempts = 0
  const maxAttempts = 3
  
  while (migrationAttempts < maxAttempts) {
    try {
      const needsMigration = await isMigrationNeeded(userDataPath)
      
      if (needsMigration) {
        logger.info(`Migration attempt ${migrationAttempts + 1}/${maxAttempts}`)
        await runMigrations(userDataPath, logger)
        logger.info('Migration successful')
        break
      } else {
        logger.info('No migration needed')
        break
      }
    } catch (error) {
      migrationAttempts++
      logger.error(`Migration attempt ${migrationAttempts} failed:`, error.message)
      
      if (migrationAttempts >= maxAttempts) {
        logger.error('All migration attempts failed, manual intervention required')
        throw new Error(`Migration failed after ${maxAttempts} attempts: ${error.message}`)
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

/**
 * Example: Using the system in an Electron main process
 */
export async function electronMainProcessExample() {
  const { app } = require('electron')
  const path = require('path')
  
  // Wait for app to be ready
  await app.whenReady()
  
  // Get the user data path
  const userDataPath = app.getPath('userData')
  
  // Create a custom logger that logs to both console and electron-log
  const logger = {
    info: (message, ...args) => {
      console.log(message, ...args)
      // If using electron-log: log.info(message, ...args)
    },
    error: (message, ...args) => {
      console.error(message, ...args)
      // If using electron-log: log.error(message, ...args)
    },
    warn: (message, ...args) => {
      console.warn(message, ...args)
      // If using electron-log: log.warn(message, ...args)
    }
  }
  
  // Handle migrations during startup
  try {
    await handleAppStartupMigrations(userDataPath, logger)
    console.log('App ready with migrations completed')
  } catch (error) {
    console.error('Failed to complete migrations:', error)
    // Decide whether to continue or exit the app
    app.quit()
  }
}

// If running this file directly, run the examples
if (import.meta.url === `file://${process.argv[1]}`) {
  const testPath = '/tmp/migration-example'
  
  console.log('=== Migration System Examples ===')
  
  try {
    await handleAppStartupMigrations(testPath)
    await manualMigrationExample(testPath)
    await robustMigrationExample(testPath)
    
    console.log('All examples completed successfully!')
  } catch (error) {
    console.error('Example failed:', error)
  }
}
