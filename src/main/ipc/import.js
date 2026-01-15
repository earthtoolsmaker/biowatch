/**
 * Import-related IPC handlers
 */

import { spawn } from 'child_process'
import crypto from 'crypto'
import { app, dialog, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { processDataset } from '../services/extractor.js'
import {
  sendGbifImportProgress,
  sendDemoImportProgress,
  sendLilaImportProgress
} from '../services/progress.js'
import {
  importCamTrapDataset,
  importWildlifeDataset,
  importDeepfauneDataset,
  importLilaDataset,
  LILA_DATASETS
} from '../services/import/index.js'
import { extractZip, downloadFile } from '../services/download.ts'

/**
 * Register all import-related IPC handlers
 */
export function registerImportIPCHandlers() {
  // Add dataset selection handler (supports both directories and zip files)
  // Note: On Linux, GTK file chooser cannot handle ['openFile', 'openDirectory'] together,
  // so we use directory-only mode on Linux
  ipcMain.handle('import:select-camtrap-dp', async () => {
    const isLinux = process.platform === 'linux'

    const result = await dialog.showOpenDialog({
      title: 'Select CamTrap DP Dataset',
      defaultPath: app.getPath('home'),
      properties: isLinux ? ['openDirectory'] : ['openFile', 'openDirectory'],
      filters: isLinux
        ? undefined
        : [
            { name: 'Datasets', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] }
          ]
    })

    if (!result || result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const id = crypto.randomUUID()

    return await processDataset(selectedPath, id)
  })

  // Add Wildlife Insights dataset selection handler
  ipcMain.handle('import:select-wildlife', async () => {
    const isLinux = process.platform === 'linux'

    const result = await dialog.showOpenDialog({
      title: 'Select Wildlife Insights Dataset',
      defaultPath: app.getPath('home'),
      properties: isLinux ? ['openDirectory'] : ['openFile', 'openDirectory'],
      filters: isLinux
        ? undefined
        : [
            { name: 'Wildlife Datasets', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] }
          ]
    })

    if (!result || result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const id = crypto.randomUUID()
    let pathToImport = selectedPath

    try {
      // Check if selected path is a file (potential zip) or directory
      const stats = statSync(selectedPath)
      const isZip = stats.isFile() && selectedPath.toLowerCase().endsWith('.zip')

      if (isZip) {
        log.info(`Processing Wildlife Insights zip file: ${selectedPath}`)

        // Create a directory for extraction in app data
        const extractPath = join(app.getPath('userData'), id)
        if (!existsSync(extractPath)) {
          mkdirSync(extractPath, { recursive: true })
        }

        // Extract the zip file
        await extractZip(selectedPath, extractPath)

        // Find the directory containing a projects.csv file
        let wildlifeInsightsDirPath = null

        const findWildlifeInsightsDir = (dir) => {
          if (wildlifeInsightsDirPath) return

          try {
            const files = readdirSync(dir)

            if (files.includes('projects.csv')) {
              wildlifeInsightsDirPath = dir
              return
            }

            for (const file of files) {
              const fullPath = join(dir, file)
              if (statSync(fullPath).isDirectory()) {
                findWildlifeInsightsDir(fullPath)
              }
            }
          } catch (error) {
            log.warn(`Error reading directory ${dir}: ${error.message}`)
          }
        }

        findWildlifeInsightsDir(extractPath)

        if (!wildlifeInsightsDirPath) {
          throw new Error(
            'Wildlife Insights directory with projects.csv not found in extracted archive'
          )
        }

        log.info(`Found Wildlife Insights directory at ${wildlifeInsightsDirPath}`)
        pathToImport = wildlifeInsightsDirPath
      } else if (!stats.isDirectory()) {
        throw new Error('The selected path is neither a directory nor a zip file')
      }

      // Import using Wildlife Insights importer
      const { data } = await importWildlifeDataset(pathToImport, id)

      if (!data) {
        return null
      }

      // Clean up CSV files after successful import if it was a zip
      if (pathToImport !== selectedPath) {
        log.info('Cleaning up CSV files...')

        const cleanupDirectory = (dir) => {
          try {
            const files = readdirSync(dir)

            for (const file of files) {
              const fullPath = join(dir, file)

              if (statSync(fullPath).isDirectory()) {
                cleanupDirectory(fullPath)
              } else if (file.toLowerCase().endsWith('.csv')) {
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
      log.error('Error processing Wildlife Insights dataset:', error)
      // Clean up extracted directory if there was an error
      if (pathToImport !== selectedPath) {
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
  })

  ipcMain.handle('import:select-deepfaune', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Deepfaune CSV', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (!result || result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const id = crypto.randomUUID()

    try {
      log.info(`Processing Deepfaune CSV file: ${selectedPath}`)

      // Import using Deepfaune importer
      const { data } = await importDeepfauneDataset(selectedPath, id)

      if (!data) {
        return null
      }

      return {
        path: selectedPath,
        data,
        id
      }
    } catch (error) {
      log.error('Error processing Deepfaune CSV dataset:', error)
      throw error
    }
  })

  ipcMain.handle('import:download-demo', async () => {
    const datasetTitle = 'Demo Dataset'

    try {
      log.info('Downloading and importing demo dataset')

      // Stage 0: Downloading
      sendDemoImportProgress({
        stage: 'downloading',
        stageIndex: 0,
        totalStages: 3,
        datasetTitle,
        downloadProgress: { percent: 0, downloadedBytes: 0, totalBytes: 0 }
      })

      // Create a temp directory for the downloaded file
      const downloadDir = join(app.getPath('temp'), 'camtrap-demo')
      if (!existsSync(downloadDir)) {
        mkdirSync(downloadDir, { recursive: true })
      }

      const demoDatasetUrl =
        'https://github.com/earthtoolsmaker/biowatch/releases/download/v1.5.0/camtrapdp-demo-dataset.zip'
      const zipPath = join(downloadDir, 'demo-dataset.zip')
      const extractPath = join(downloadDir, 'extracted')

      log.info(`Downloading demo dataset from ${demoDatasetUrl} to ${zipPath}`)
      await downloadFile(demoDatasetUrl, zipPath, (progress) => {
        sendDemoImportProgress({
          stage: 'downloading',
          stageIndex: 0,
          totalStages: 3,
          datasetTitle,
          downloadProgress: {
            percent: progress.percent || 0,
            downloadedBytes: progress.downloadedBytes || 0,
            totalBytes: progress.totalBytes || 0
          }
        })
      })
      log.info('Download complete')

      // Stage 1: Extracting
      sendDemoImportProgress({
        stage: 'extracting',
        stageIndex: 1,
        totalStages: 3,
        datasetTitle
      })

      // Create extraction directory if it doesn't exist
      if (!existsSync(extractPath)) {
        mkdirSync(extractPath, { recursive: true })
      } else {
        // Clean the extraction directory first to avoid conflicts
        const files = readdirSync(extractPath)
        for (const file of files) {
          const filePath = join(extractPath, file)
          if (statSync(filePath).isDirectory()) {
            await new Promise((resolve, reject) => {
              const rmProcess = spawn('rm', ['-rf', filePath])
              rmProcess.on('close', (code) => {
                if (code === 0) resolve()
                else reject(new Error(`Failed to delete directory: ${filePath}`))
              })
              rmProcess.on('error', reject)
            })
          } else {
            unlinkSync(filePath)
          }
        }
      }

      // Extract the zip file
      await extractZip(zipPath, extractPath)

      // Find the directory containing a datapackage.json file
      let camtrapDpDirPath = null

      const findCamtrapDpDir = (dir) => {
        if (camtrapDpDirPath) return

        try {
          const files = readdirSync(dir)

          if (files.includes('datapackage.json')) {
            camtrapDpDirPath = dir
            return
          }

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

      // Stage 2: Importing CSVs
      sendDemoImportProgress({
        stage: 'importing_csvs',
        stageIndex: 2,
        totalStages: 3,
        datasetTitle
      })

      const id = crypto.randomUUID()
      const { data } = await importCamTrapDataset(
        camtrapDpDirPath,
        id,
        (csvProgress) => {
          sendDemoImportProgress({
            stage: 'importing_csvs',
            stageIndex: 2,
            totalStages: 3,
            datasetTitle,
            csvProgress: {
              currentFile: csvProgress.currentFile,
              fileIndex: csvProgress.fileIndex,
              totalFiles: csvProgress.totalFiles,
              insertedRows: csvProgress.insertedRows || 0,
              totalRows: csvProgress.totalRows || 0,
              phase: csvProgress.phase
            }
          })
        },
        { nameOverride: datasetTitle }
      )

      const result = {
        path: camtrapDpDirPath,
        data: {
          ...data,
          name: datasetTitle
        },
        id
      }

      log.info('Cleaning up temporary files after successful import...')

      try {
        if (existsSync(zipPath)) {
          unlinkSync(zipPath)
          log.info(`Deleted zip file: ${zipPath}`)
        }
      } catch (error) {
        log.warn(`Failed to delete zip file: ${error.message}`)
      }

      try {
        await new Promise((resolve) => {
          const rmProcess = spawn('rm', ['-rf', extractPath])
          rmProcess.on('close', (code) => {
            if (code === 0) {
              log.info(`Deleted extraction directory: ${extractPath}`)
              resolve()
            } else {
              log.warn(`Failed to delete extraction directory, exit code: ${code}`)
              resolve()
            }
          })
          rmProcess.on('error', (err) => {
            log.warn(`Error during extraction directory cleanup: ${err.message}`)
            resolve()
          })
        })
      } catch (error) {
        log.warn(`Failed to cleanup extraction directory: ${error.message}`)
      }

      // Stage 3: Complete
      sendDemoImportProgress({
        stage: 'complete',
        stageIndex: 3,
        totalStages: 3,
        datasetTitle
      })

      return result
    } catch (error) {
      log.error('Error downloading or importing demo dataset:', error)

      sendDemoImportProgress({
        stage: 'error',
        stageIndex: -1,
        totalStages: 3,
        datasetTitle,
        error: {
          message: error.message,
          retryable: true
        }
      })

      throw error
    }
  })

  ipcMain.handle('import:gbif-dataset', async (_, datasetKey) => {
    let datasetTitle = null

    try {
      log.info(`Downloading and importing GBIF dataset: ${datasetKey}`)

      // Stage 0: Fetching metadata
      sendGbifImportProgress({
        stage: 'fetching_metadata',
        stageIndex: 0,
        totalStages: 4,
        stageName: 'Fetching dataset metadata from GBIF...',
        datasetKey
      })

      // First, fetch the dataset metadata to get the download URL
      const datasetResponse = await fetch(`https://api.gbif.org/v1/dataset/${datasetKey}`)
      if (!datasetResponse.ok) {
        throw new Error(`Failed to fetch dataset metadata: ${datasetResponse.statusText}`)
      }

      const datasetMetadata = await datasetResponse.json()
      datasetTitle = datasetMetadata.title
      log.info(`Dataset title: ${datasetTitle}`)

      // Find the CAMTRAP_DP endpoint
      const camtrapEndpoint = datasetMetadata.endpoints?.find(
        (endpoint) => endpoint.type === 'CAMTRAP_DP'
      )
      if (!camtrapEndpoint) {
        throw new Error('No CAMTRAP_DP endpoint found for this dataset')
      }

      const downloadUrl = camtrapEndpoint.url
      log.info(`Found download URL: ${downloadUrl}`)

      // Create a temp directory for the downloaded file
      const downloadDir = join(app.getPath('temp'), `gbif-${datasetKey}`)
      if (!existsSync(downloadDir)) {
        mkdirSync(downloadDir, { recursive: true })
      }

      const zipPath = join(downloadDir, 'gbif-dataset.zip')
      const extractPath = join(downloadDir, 'extracted')

      // Stage 1: Downloading
      sendGbifImportProgress({
        stage: 'downloading',
        stageIndex: 1,
        totalStages: 4,
        stageName: 'Downloading dataset archive...',
        datasetKey,
        datasetTitle,
        downloadProgress: { percent: 0, downloadedBytes: 0, totalBytes: 0 }
      })

      log.info(`Downloading GBIF dataset from ${downloadUrl} to ${zipPath}`)
      await downloadFile(downloadUrl, zipPath, (progress) => {
        sendGbifImportProgress({
          stage: 'downloading',
          stageIndex: 1,
          totalStages: 4,
          stageName: 'Downloading dataset archive...',
          datasetKey,
          datasetTitle,
          downloadProgress: {
            percent: progress.percent || 0,
            downloadedBytes: progress.downloadedBytes || 0,
            totalBytes: progress.totalBytes || 0
          }
        })
      })
      log.info('Download complete')

      // Stage 2: Extracting
      sendGbifImportProgress({
        stage: 'extracting',
        stageIndex: 2,
        totalStages: 4,
        stageName: 'Extracting archive...',
        datasetKey,
        datasetTitle
      })

      // Create extraction directory if it doesn't exist
      if (!existsSync(extractPath)) {
        mkdirSync(extractPath, { recursive: true })
      } else {
        const files = readdirSync(extractPath)
        for (const file of files) {
          const filePath = join(extractPath, file)
          if (statSync(filePath).isDirectory()) {
            await new Promise((resolve, reject) => {
              const rmProcess = spawn('rm', ['-rf', filePath])
              rmProcess.on('close', (code) => {
                if (code === 0) resolve()
                else reject(new Error(`Failed to delete directory: ${filePath}`))
              })
              rmProcess.on('error', reject)
            })
          } else {
            unlinkSync(filePath)
          }
        }
      }

      // Extract the zip file
      await extractZip(zipPath, extractPath)

      // Find the directory containing a datapackage.json file
      let camtrapDpDirPath = null

      const findCamtrapDpDir = (dir) => {
        if (camtrapDpDirPath) return

        try {
          const files = readdirSync(dir)

          if (files.includes('datapackage.json')) {
            camtrapDpDirPath = dir
            return
          }

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

      // Stage 3: Importing CSVs
      sendGbifImportProgress({
        stage: 'importing_csvs',
        stageIndex: 3,
        totalStages: 4,
        stageName: 'Importing data into database...',
        datasetKey,
        datasetTitle
      })

      const id = crypto.randomUUID()
      const { data } = await importCamTrapDataset(camtrapDpDirPath, id, (csvProgress) => {
        sendGbifImportProgress({
          stage: 'importing_csvs',
          stageIndex: 3,
          totalStages: 4,
          stageName: `Importing ${csvProgress.currentFile}...`,
          datasetKey,
          datasetTitle,
          csvProgress: {
            currentFile: csvProgress.currentFile,
            fileIndex: csvProgress.fileIndex,
            totalFiles: csvProgress.totalFiles,
            insertedRows: csvProgress.insertedRows || 0,
            totalRows: csvProgress.totalRows || 0,
            phase: csvProgress.phase
          }
        })
      })

      const result = {
        path: camtrapDpDirPath,
        data: {
          ...data,
          name: datasetTitle || data.name
        },
        id
      }

      log.info('Cleaning up temporary files after successful import...')

      try {
        if (existsSync(zipPath)) {
          unlinkSync(zipPath)
          log.info(`Deleted zip file: ${zipPath}`)
        }
      } catch (error) {
        log.warn(`Failed to delete zip file: ${error.message}`)
      }

      try {
        await new Promise((resolve) => {
          const rmProcess = spawn('rm', ['-rf', extractPath])
          rmProcess.on('close', (code) => {
            if (code === 0) {
              log.info(`Deleted extraction directory: ${extractPath}`)
              resolve()
            } else {
              log.warn(`Failed to delete extraction directory, exit code: ${code}`)
              resolve()
            }
          })
          rmProcess.on('error', (err) => {
            log.warn(`Error during extraction directory cleanup: ${err.message}`)
            resolve()
          })
        })
      } catch (error) {
        log.warn(`Failed to cleanup extraction directory: ${error.message}`)
      }

      // Stage 4: Complete
      sendGbifImportProgress({
        stage: 'complete',
        stageIndex: 4,
        totalStages: 4,
        stageName: 'Import complete!',
        datasetKey,
        datasetTitle
      })

      return result
    } catch (error) {
      log.error('Error downloading or importing GBIF dataset:', error)

      sendGbifImportProgress({
        stage: 'error',
        stageIndex: -1,
        totalStages: 4,
        stageName: 'Import failed',
        datasetKey,
        datasetTitle,
        error: {
          message: error.message,
          retryable: !error.message.includes('No CAMTRAP_DP endpoint')
        }
      })

      throw error
    }
  })

  // LILA dataset handlers
  ipcMain.handle('import:lila-datasets', async () => {
    return LILA_DATASETS
  })

  ipcMain.handle('import:lila-dataset', async (_, datasetId) => {
    let datasetTitle = null

    try {
      log.info(`Importing LILA dataset: ${datasetId}`)

      // Find the dataset configuration
      const dataset = LILA_DATASETS.find((d) => d.id === datasetId)
      if (!dataset) {
        throw new Error(`Unknown LILA dataset: ${datasetId}`)
      }
      datasetTitle = dataset.name

      // Generate a unique ID for the study
      const id = crypto.randomUUID()

      // Import the dataset with progress callback
      const result = await importLilaDataset(datasetId, id, (progress) => {
        sendLilaImportProgress({
          ...progress,
          datasetId
        })
      })

      // Send completion progress
      sendLilaImportProgress({
        stage: 'complete',
        stageIndex: 3,
        totalStages: 3,
        datasetTitle,
        datasetId
      })

      return {
        id,
        data: result.data
      }
    } catch (error) {
      log.error('Error importing LILA dataset:', error)

      sendLilaImportProgress({
        stage: 'error',
        stageIndex: -1,
        totalStages: 3,
        datasetTitle,
        datasetId,
        error: {
          message: error.message,
          retryable: true
        }
      })

      throw error
    }
  })
}
