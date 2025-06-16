import { existsSync, mkdirSync, readdirSync, statSync, renameSync, rmSync } from 'fs'
import { join } from 'path'

/**
 * Migration to move from flat .db files to structured folder layout
 *
 * From:
 *   userData/
 *     - study1.db
 *     - study2.db
 *     - model-zoo/
 *     - python-environments/
 *
 * To:
 *   userData/
 *     - biowatch-data/
 *       - studies/
 *         - study1/
 *           - study.db
 *         - study2/
 *           - study.db
 *       - model-zoo/
 *       - python-environments/
 */
export const fileSystemRestructureMigration = {
  version: 'v1.0.15',
  description:
    'Restructure database files from flat structure to organized folders and move model-zoo and python-environments',

  /**
   * Move databases to new folder structure
   * @param {string} userDataPath - Path to app userData directory
   */
  async up(userDataPath) {
    console.info('Starting file system restructure migration')

    try {
      // Create new directory structure first
      const biowatchDataPath = join(userDataPath, 'biowatch-data')
      const studiesPath = join(biowatchDataPath, 'studies')

      if (!existsSync(biowatchDataPath)) {
        mkdirSync(biowatchDataPath, { recursive: true })
        console.info(`Created directory: ${biowatchDataPath}`)
      }

      if (!existsSync(studiesPath)) {
        mkdirSync(studiesPath, { recursive: true })
        console.info(`Created directory: ${studiesPath}`)
      }

      // Find all .db files in the root userData directory
      let files
      try {
        files = readdirSync(userDataPath)
      } catch (error) {
        console.warn('Could not read userData directory:', error.message)
        return
      }

      const dbFiles = files.filter((file) => {
        // Skip hidden files and ensure it's a .db file
        if (file.startsWith('.') || !file.endsWith('.db')) {
          return false
        }

        // Verify it's actually a file, not a directory
        const fullPath = join(userDataPath, file)
        try {
          return statSync(fullPath).isFile()
        } catch (error) {
          console.warn(`Could not stat file ${file}:`, error.message)
          return false
        }
      })

      console.info(`Found ${dbFiles.length} database files to migrate: ${dbFiles.join(', ')}`)

      // Move each database file to its new location
      for (const dbFile of dbFiles) {
        const studyId = dbFile.replace('.db', '')
        const oldPath = join(userDataPath, dbFile)
        const newStudyDir = join(studiesPath, studyId)
        const newPath = join(newStudyDir, 'study.db')

        try {
          // Create study directory
          if (!existsSync(newStudyDir)) {
            mkdirSync(newStudyDir, { recursive: true })
            console.info(`Created study directory: ${newStudyDir}`)
          }

          // Move the database file
          renameSync(oldPath, newPath)
          console.info(`Migrated ${dbFile} -> ${newPath}`)
        } catch (error) {
          console.error(`Failed to migrate ${dbFile}:`, error.message)
          throw error
        }
      }

      // Move model-zoo directory if it exists
      const oldModelZooPath = join(userDataPath, 'model-zoo')
      const newModelZooPath = join(biowatchDataPath, 'model-zoo')
      if (existsSync(oldModelZooPath)) {
        try {
          renameSync(oldModelZooPath, newModelZooPath)
          console.info(`Migrated model-zoo -> ${newModelZooPath}`)
        } catch (error) {
          console.error('Failed to migrate model-zoo:', error.message)
          throw error
        }
      } else {
        console.info('No model-zoo directory found, skipping')
      }

      // Move python-environments directory if it exists
      const oldPythonEnvPath = join(userDataPath, 'python-environments')
      const newPythonEnvPath = join(biowatchDataPath, 'python-environments')
      if (existsSync(oldPythonEnvPath)) {
        try {
          renameSync(oldPythonEnvPath, newPythonEnvPath)
          console.info(`Migrated python-environments -> ${newPythonEnvPath}`)
        } catch (error) {
          console.error('Failed to migrate python-environments:', error.message)
          throw error
        }
      } else {
        console.info('No python-environments directory found, skipping')
      }

      console.info(`File system restructure migration completed successfully`)
    } catch (error) {
      console.error('File system restructure migration failed:', error)
      throw error
    }
  },

  /**
   * Rollback to flat file structure
   * @param {string} userDataPath - Path to app userData directory
   */
  async down(userDataPath) {
    console.info('Starting file system restructure rollback')

    try {
      const studiesPath = join(userDataPath, 'biowatch-data', 'studies')

      if (!existsSync(studiesPath)) {
        console.info('New structure does not exist, rollback not needed')
        return
      }

      // Find all study directories
      let studyDirs
      try {
        studyDirs = readdirSync(studiesPath)
      } catch (error) {
        console.warn('Could not read studies directory:', error.message)
        return
      }

      const validStudyDirs = studyDirs.filter((dir) => {
        const studyPath = join(studiesPath, dir)
        try {
          return statSync(studyPath).isDirectory()
        } catch (error) {
          console.warn(`Could not stat directory ${dir}:`, error.message)
          return false
        }
      })

      console.info(
        `Found ${validStudyDirs.length} study directories to rollback: ${validStudyDirs.join(', ')}`
      )

      // Move each study database back to flat structure
      for (const studyDir of validStudyDirs) {
        const studyPath = join(studiesPath, studyDir)
        const dbPath = join(studyPath, 'study.db')
        const oldPath = join(userDataPath, `${studyDir}.db`)

        if (existsSync(dbPath)) {
          try {
            // Move the database file back
            renameSync(dbPath, oldPath)
            console.info(`Rolled back ${dbPath} -> ${oldPath}`)

            // Try to remove the empty study directory
            try {
              rmSync(studyPath, { recursive: true, force: true })
              console.info(`Removed directory: ${studyPath}`)
            } catch (error) {
              console.warn(`Could not remove directory ${studyPath}:`, error.message)
            }
          } catch (error) {
            console.error(`Failed to rollback ${studyDir}:`, error.message)
            throw error
          }
        } else {
          console.warn(`No study.db found in ${studyPath}, skipping`)
        }
      }

      // Move model-zoo back if it exists
      const newModelZooPath = join(userDataPath, 'biowatch-data', 'model-zoo')
      const oldModelZooPath = join(userDataPath, 'model-zoo')
      if (existsSync(newModelZooPath)) {
        try {
          renameSync(newModelZooPath, oldModelZooPath)
          console.info(`Rolled back model-zoo -> ${oldModelZooPath}`)
        } catch (error) {
          console.error('Failed to rollback model-zoo:', error.message)
          throw error
        }
      }

      // Move python-environments back if it exists
      const newPythonEnvPath = join(userDataPath, 'biowatch-data', 'python-environments')
      const oldPythonEnvPath = join(userDataPath, 'python-environments')
      if (existsSync(newPythonEnvPath)) {
        try {
          renameSync(newPythonEnvPath, oldPythonEnvPath)
          console.info(`Rolled back python-environments -> ${oldPythonEnvPath}`)
        } catch (error) {
          console.error('Failed to rollback python-environments:', error.message)
          throw error
        }
      }

      // Try to remove the biowatch-data directory if it's empty
      try {
        const biowatchDataPath = join(userDataPath, 'biowatch-data')
        if (existsSync(biowatchDataPath)) {
          const remainingFiles = readdirSync(biowatchDataPath)
          const hasStudies = remainingFiles.includes('studies')
          const hasModelZoo = remainingFiles.includes('model-zoo')
          const hasPythonEnv = remainingFiles.includes('python-environments')

          // Check if we should remove the entire structure
          let shouldRemove = true

          if (hasStudies) {
            const remainingStudies = readdirSync(studiesPath)
            if (remainingStudies.length > 0) {
              shouldRemove = false
            }
          }

          if (hasModelZoo || hasPythonEnv) {
            shouldRemove = false
          }

          if (shouldRemove) {
            rmSync(biowatchDataPath, { recursive: true, force: true })
            console.info('Removed empty biowatch-data directory structure')
          } else {
            console.info('biowatch-data directory still contains files, not removing')
          }
        }
      } catch (error) {
        console.warn('Could not clean up biowatch-data directory:', error.message)
      }

      console.info(`File system restructure rollback completed successfully`)
    } catch (error) {
      console.error('File system restructure rollback failed:', error)
      throw error
    }
  }
}
