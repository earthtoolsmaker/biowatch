/**
 * Dataset extraction utilities for processing zip files and CamTrap DP datasets
 */

import { app } from 'electron'
import log from 'electron-log'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { importCamTrapDataset } from './import/index.js'

/**
 * Process a dataset from a path (directory or zip file)
 * If a zip file is provided, it will be extracted first
 * @param {string} inputPath - Path to the dataset (directory or zip file)
 * @param {string} id - Unique ID for the study
 * @param {Function} [onProgress] - Optional progress callback
 * @returns {Promise<Object>} Object containing path, data, and id
 */
export async function processDataset(inputPath, id, onProgress) {
  let pathToImport = inputPath

  try {
    // Check if selected path is a file (potential zip) or directory
    const stats = statSync(inputPath)
    const isZip = stats.isFile() && inputPath.toLowerCase().endsWith('.zip')
    const totalStages = isZip ? 2 : 1

    if (isZip) {
      log.info(`Processing zip file: ${inputPath}`)

      // Notify extracting stage
      if (onProgress) {
        onProgress({
          stage: 'extracting',
          stageIndex: 0,
          totalStages,
          isZip: true
        })
      }

      // Create a directory for extraction in app data
      const extractPath = join(app.getPath('userData'), id)
      if (!existsSync(extractPath)) {
        mkdirSync(extractPath, { recursive: true })
      }

      // Extract the zip file
      log.info(`Extracting ${inputPath} to ${extractPath}`)
      await new Promise((resolve, reject) => {
        const tarProcess = spawn('tar', ['-xf', inputPath, '-C', extractPath])

        tarProcess.stdout.on('data', (data) => {
          log.info(`tar output: ${data}`)
        })

        tarProcess.stderr.on('data', (data) => {
          log.info(`tar progress: ${data}`)
        })

        tarProcess.on('error', (err) => {
          log.error(`Error executing tar command:`, err)
          reject(err)
        })

        tarProcess.on('close', (code) => {
          if (code === 0) {
            log.info(`Extraction complete to ${extractPath}`)
            resolve()
          } else {
            const err = new Error(`tar process exited with code ${code}`)
            log.error(err)
            reject(err)
          }
        })
      })

      // Find the directory containing a datapackage.json file
      let camtrapDpDirPath = null

      const findCamtrapDpDir = (dir) => {
        if (camtrapDpDirPath) return // Already found, exit recursion

        try {
          const files = readdirSync(dir)

          // First check if this directory has datapackage.json
          if (files.includes('datapackage.json')) {
            camtrapDpDirPath = dir
            return
          }

          // Then check subdirectories
          for (const file of files) {
            const fullPath = join(dir, file)
            if (statSync(fullPath).isDirectory()) {
              findCamtrapDpDir(fullPath)
            }
          }
        } catch (error) {
          log.warn(`Error reading directory ${dir}: ${error.message}`)
        }
      }

      findCamtrapDpDir(extractPath)

      if (!camtrapDpDirPath) {
        throw new Error('CamTrap DP directory with datapackage.json not found in extracted archive')
      }

      log.info(`Found CamTrap DP directory at ${camtrapDpDirPath}`)
      pathToImport = camtrapDpDirPath
    } else if (!stats.isDirectory()) {
      throw new Error('The selected path is neither a directory nor a zip file')
    }

    // Notify importing_csvs stage
    if (onProgress) {
      onProgress({
        stage: 'importing_csvs',
        stageIndex: isZip ? 1 : 0,
        totalStages,
        isZip
      })
    }

    // Import the dataset with progress callback
    const { data } = await importCamTrapDataset(pathToImport, id, (csvProgress) => {
      if (onProgress) {
        onProgress({
          stage: 'importing_csvs',
          stageIndex: isZip ? 1 : 0,
          totalStages,
          isZip,
          csvProgress: {
            currentFile: csvProgress.currentFile,
            fileIndex: csvProgress.fileIndex,
            totalFiles: csvProgress.totalFiles,
            insertedRows: csvProgress.insertedRows || 0,
            totalRows: csvProgress.totalRows || 0,
            phase: csvProgress.phase
          }
        })
      }
    })

    if (!data) {
      return
    }

    // Clean up CSV files and datapackage.json after successful import if it was a zip
    if (pathToImport !== inputPath) {
      log.info('Cleaning up CSV files and datapackage.json...')

      const cleanupDirectory = (dir) => {
        try {
          const files = readdirSync(dir)

          for (const file of files) {
            const fullPath = join(dir, file)

            if (statSync(fullPath).isDirectory()) {
              cleanupDirectory(fullPath)
            } else if (
              file.toLowerCase().endsWith('.csv') ||
              file.toLowerCase() === 'datapackage.json'
            ) {
              log.info(`Removing file: ${fullPath}`)
              unlinkSync(fullPath)
            }
          }
        } catch (error) {
          log.warn(`Error cleaning up directory ${dir}: ${error.message}`)
        }
      }

      cleanupDirectory(pathToImport)
    }

    return {
      path: pathToImport,
      data,
      id
    }
  } catch (error) {
    log.error('Error processing dataset:', error)
    // Clean up extracted directory if there was an error
    if (pathToImport !== inputPath) {
      try {
        await new Promise((resolve) => {
          const rmProcess = spawn('rm', ['-rf', join(app.getPath('userData'), id)])
          rmProcess.on('close', () => resolve())
          rmProcess.on('error', () => resolve())
        })
      } catch (cleanupError) {
        log.warn(`Failed to clean up after error: ${cleanupError.message}`)
      }
    }
    throw error
  }
}
