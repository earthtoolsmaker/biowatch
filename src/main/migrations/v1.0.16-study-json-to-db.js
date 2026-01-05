import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getDrizzleDb, insertMetadata, getMetadata } from '../database/index.js'

/**
 * Migration to move study.json files to database metadata table
 *
 * From:
 *   userData/biowatch-data/studies/study-id/
 *     - study.json (with path, importerName, name, country, data, id, createdAt)
 *     - study.db
 *
 * To:
 *   userData/biowatch-data/studies/study-id/
 *     - study.db (with metadata table populated)
 *     - study.json deleted
 */
export const studyJsonToDbMigration = {
  version: 'v1.0.16',
  description: 'Migrate study.json files to database metadata table',

  /**
   * Migrate study.json files to database metadata
   * @param {string} userDataPath - Path to app userData directory
   */
  async up(userDataPath) {
    console.info('Starting study.json to database migration')

    try {
      const studiesPath = join(userDataPath, 'biowatch-data', 'studies')

      if (!existsSync(studiesPath)) {
        console.info('No studies directory found, migration not needed')
        return
      }

      // Get all study directories
      let studyDirs
      try {
        studyDirs = readdirSync(studiesPath, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name)
      } catch (error) {
        console.warn('Could not read studies directory:', error.message)
        return
      }

      if (studyDirs.length === 0) {
        console.info('No study directories found')
        return
      }

      console.info(`Found ${studyDirs.length} study directories`)

      // Find all studies with study.json files
      const studiesWithJson = []
      for (const studyId of studyDirs) {
        const studyJsonPath = join(studiesPath, studyId, 'study.json')
        if (existsSync(studyJsonPath)) {
          studiesWithJson.push(studyId)
        }
      }

      if (studiesWithJson.length === 0) {
        console.info('No studies with study.json found, migration not needed')
        return
      }

      console.info(`Found ${studiesWithJson.length} studies with study.json files`)

      // Migrate each study
      let migratedCount = 0
      let skippedCount = 0
      let failedCount = 0

      for (const studyId of studiesWithJson) {
        const studyPath = join(studiesPath, studyId)
        const studyJsonPath = join(studyPath, 'study.json')
        const dbPath = join(studyPath, 'study.db')

        console.info(`Processing study: ${studyId}`)

        // Check if database exists
        if (!existsSync(dbPath)) {
          console.warn(`Database not found for ${studyId}, skipping`)
          skippedCount++
          continue
        }

        try {
          // Read study.json
          const studyJsonContent = readFileSync(studyJsonPath, 'utf-8')
          const studyJson = JSON.parse(studyJsonContent)

          // Get database connection
          const db = await getDrizzleDb(studyId, dbPath)

          // Check if metadata already exists
          const existingMetadata = await getMetadata(db)
          if (existingMetadata) {
            console.info(`Metadata already exists in database for ${studyId}, skipping insert`)
            // Delete study.json since metadata is already in DB
            unlinkSync(studyJsonPath)
            console.info(`Deleted study.json for ${studyId}`)
            skippedCount++
            continue
          }

          // Transform study.json to metadata format
          // Old format can be either:
          // 1. Simple: { path, importerName, name, country, data: { name, country }, id, createdAt }
          // 2. Camtrap DP: { id, data: { name, title, description, created, contributors, temporal, ... }, name, importerName, createdAt }
          const data = studyJson.data || {}

          const metadataRecord = {
            id: studyJson.id,
            name: studyJson.name || data.name,
            title: data.title || data.name || studyJson.name,
            description: data.description || null,
            created: data.created || studyJson.createdAt,
            importerName: studyJson.importerName,
            contributors: data.contributors || null,
            updatedAt: studyJson.createdAt,
            startDate: data.temporal?.start || null,
            endDate: data.temporal?.end || null
          }

          // Insert metadata into database
          await insertMetadata(db, metadataRecord)

          console.info(`Successfully migrated metadata for ${studyId} to database`)

          // Delete study.json file after successful migration
          unlinkSync(studyJsonPath)
          console.info(`Deleted study.json for ${studyId}`)

          migratedCount++
        } catch (error) {
          console.error(`Failed to migrate ${studyId}:`, error.message)
          failedCount++
          // Continue with other studies instead of throwing
        }
      }

      console.info(
        `Study.json to database migration completed: ${migratedCount} migrated, ${skippedCount} skipped, ${failedCount} failed`
      )
    } catch (error) {
      console.error('Study.json to database migration failed:', error)
      throw error
    }
  },

  /**
   * Rollback metadata from database to study.json files
   * @param {string} userDataPath - Path to app userData directory
   */
  async down(userDataPath) {
    console.info('Starting study.json to database rollback')

    try {
      const studiesPath = join(userDataPath, 'biowatch-data', 'studies')

      if (!existsSync(studiesPath)) {
        console.info('No studies directory found, rollback not needed')
        return
      }

      // Get all study directories
      let studyDirs
      try {
        studyDirs = readdirSync(studiesPath, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name)
      } catch (error) {
        console.warn('Could not read studies directory:', error.message)
        return
      }

      console.info(`Found ${studyDirs.length} study directories`)

      // Rollback all studies
      let rolledBackCount = 0
      let skippedCount = 0
      let failedCount = 0

      for (const studyId of studyDirs) {
        const studyPath = join(studiesPath, studyId)
        const studyJsonPath = join(studyPath, 'study.json')
        const dbPath = join(studyPath, 'study.db')

        console.info(`Processing rollback for study: ${studyId}`)

        // Check if study.json already exists
        if (existsSync(studyJsonPath)) {
          console.info(`study.json already exists for ${studyId}, skipping rollback`)
          skippedCount++
          continue
        }

        // Check if database exists
        if (!existsSync(dbPath)) {
          console.warn(`Database not found for ${studyId}, skipping rollback`)
          skippedCount++
          continue
        }

        try {
          // Get database connection
          const db = await getDrizzleDb(studyId, dbPath)

          // Get metadata from database
          const metadata = await getMetadata(db)

          if (!metadata) {
            console.warn(`No metadata found in database for ${studyId}, cannot rollback`)
            skippedCount++
            continue
          }

          // Transform metadata to study.json format
          // Build a study.json that preserves as much data as possible
          const studyJson = {
            id: metadata.id,
            data: {
              name: metadata.name,
              title: metadata.title,
              description: metadata.description,
              created: metadata.created,
              contributors: metadata.contributors,
              temporal:
                metadata.startDate || metadata.endDate
                  ? {
                      start: metadata.startDate,
                      end: metadata.endDate
                    }
                  : null
            },
            name: metadata.name,
            importerName: metadata.importerName,
            createdAt: metadata.created
          }

          // Remove null values from data object
          Object.keys(studyJson.data).forEach((key) => {
            if (studyJson.data[key] === null) {
              delete studyJson.data[key]
            }
          })
          if (studyJson.data.temporal === null) {
            delete studyJson.data.temporal
          }

          // Write study.json file
          const fs = await import('fs/promises')
          await fs.writeFile(studyJsonPath, JSON.stringify(studyJson, null, 2), 'utf-8')

          console.info(`Successfully created study.json for ${studyId}`)
          rolledBackCount++
        } catch (error) {
          console.error(`Failed to rollback ${studyId}:`, error.message)
          failedCount++
          // Continue with other studies instead of throwing
        }
      }

      console.info(
        `Study.json to database rollback completed: ${rolledBackCount} rolled back, ${skippedCount} skipped, ${failedCount} failed`
      )

      console.info(`Study.json to database rollback completed successfully`)
    } catch (error) {
      console.error('Study.json to database rollback failed:', error)
      throw error
    }
  }
}
