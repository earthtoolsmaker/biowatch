import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  getDrizzleDb,
  getStudyDatabase,
  media,
  closeStudyDatabase,
  insertMetadata,
  getLatestModelRun
} from '../../database/index.js'
import { eq } from 'drizzle-orm'
import { DEFAULT_SEQUENCE_GAP } from '../../../shared/constants.js'
import { enqueueBatch } from '../queue.js'
import { queueScheduler } from '../queue-scheduler.js'

// Map file extensions to IANA media types (Camtrap DP compliant)
const extensionToMediatype = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v'
}

const mediaExtensions = new Set(Object.keys(extensionToMediatype))

function getFileMediatype(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return extensionToMediatype[ext] || 'application/octet-stream'
}

async function* walkMediaFiles(dir) {
  const dirents = await fs.promises.opendir(dir)
  for await (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      yield* walkMediaFiles(fullPath)
    } else if (
      dirent.isFile() &&
      !dirent.name.startsWith('._') &&
      mediaExtensions.has(path.extname(dirent.name).toLowerCase())
    ) {
      yield fullPath
    }
  }
}

async function insertMedia(db, fullPath, importFolder) {
  // Check if media with this filePath already exists (dedup on re-import)
  const existing = await db.select().from(media).where(eq(media.filePath, fullPath)).limit(1)
  if (existing.length > 0) {
    log.info(`Media already exists for path: ${fullPath}, skipping`)
    return existing[0]
  }

  const folderName =
    importFolder === path.dirname(fullPath)
      ? path.basename(importFolder)
      : path.relative(importFolder, path.dirname(fullPath))
  const mediaData = {
    mediaID: crypto.randomUUID(),
    deploymentID: null,
    timestamp: null,
    filePath: fullPath,
    fileName: path.basename(fullPath),
    importFolder: importFolder,
    folderName: folderName,
    fileMediatype: getFileMediatype(fullPath),
    exifData: null // Populated from Python response for videos (fps, duration, etc.)
  }

  await db.insert(media).values(mediaData)
  return mediaData
}

// {
//   filepath: '/Users/iorek/Downloads/species/0b87ee8f-bf2c-4154-82fd-500b3a8b88ae.JPG',
//   classifications: {
//     classes: [
//       '5a565886-156e-4b19-a017-6a5bbae4df0f;mammalia;lagomorpha;leporidae;oryctolagus;cuniculus;european rabbit',
//       '6c09fa63-2acc-4915-a60b-bd8cee40aedb;mammalia;lagomorpha;leporidae;;;rabbit and hare family',
//       'ce9a5481-b3f7-4e42-8b8b-382f601fded0;mammalia;lagomorpha;leporidae;lepus;europaeus;european hare',
//       '667a4650-a141-4c4e-844e-58cdeaeb4ae1;mammalia;lagomorpha;leporidae;sylvilagus;floridanus;eastern cottontail',
//       'cacc63d7-b949-4731-abce-a403ba76ee34;mammalia;lagomorpha;leporidae;sylvilagus;;sylvilagus species'
//     ],
//     scores: [
//       0.9893904328346252,
//       0.009531639516353607,
//       0.00039335378096438944,
//       0.00019710895139724016,
//       0.00010050772834802046
//     ]
//   },
//   detections: [
//     {
//       category: '1',
//       label: 'animal',
//       conf: 0.9739366769790649,
//       bbox: [Array]
//     },
//     {
//       category: '1',
//       label: 'animal',
//       conf: 0.029717758297920227,
//       bbox: [Array]
//     }
//   ],
//   prediction: '5a565886-156e-4b19-a017-6a5bbae4df0f;mammalia;lagomorpha;leporidae;oryctolagus;cuniculus;european rabbit',
//   prediction_score: 0.9893904328346252,
//   prediction_source: 'classifier',
//   model_version: '4.0.1a'
// }


/**
 * Insert media records in batch using Drizzle ORM with transaction for performance
 * @param {Object} db - Drizzle database instance
 * @param {Object} manager - StudyDatabaseManager instance for transaction support
 * @param {Array} mediaDataArray - Array of media data objects to insert
 */
async function insertMediaBatch(db, manager, mediaDataArray) {
  if (mediaDataArray.length === 0) return

  try {
    // Use transaction for bulk insert performance
    // Insert in chunks to avoid SQLite parameter limits (999 per statement)
    const CHUNK_SIZE = 100

    manager.transaction(() => {
      for (let i = 0; i < mediaDataArray.length; i += CHUNK_SIZE) {
        const chunk = mediaDataArray.slice(i, i + CHUNK_SIZE)
        db.insert(media)
          .values(
            chunk.map((m) => ({
              mediaID: m.mediaID,
              deploymentID: m.deploymentID,
              timestamp: m.timestamp,
              filePath: m.filePath,
              fileName: m.fileName,
              importFolder: m.importFolder,
              folderName: m.folderName,
              fileMediatype: m.fileMediatype,
              exifData: m.exifData
            }))
          )
          .run()
      }
    })

    log.info(`Inserted ${mediaDataArray.length} media records using Drizzle transaction`)
  } catch (error) {
    log.error('Error inserting media batch:', error)
    throw error
  }
}

export class Importer {
  constructor(id, folder, modelReference, country = null) {
    this.id = id
    this.folder = folder
    this.modelReference = modelReference
    this.country = country
    this.dbPath = null
  }

  _enqueueMediaJobs(manager, mediaBatch) {
    if (!this.modelReference) return
    const topic = `${this.modelReference.id}:${this.modelReference.version}`
    enqueueBatch(
      manager,
      mediaBatch.map((m) => ({
        kind: 'ml-inference',
        topic,
        payload: {
          mediaId: m.mediaID,
          filePath: m.filePath,
          fileMediatype: m.fileMediatype
        }
      }))
    )
  }

  async start(addingMore = false) {
    try {
      this.dbPath = path.join(
        app.getPath('userData'),
        'biowatch-data',
        'studies',
        this.id,
        'study.db'
      )
      const dbPath = this.dbPath
      if (!fs.existsSync(dbPath)) {
        log.info(`Database not found at ${dbPath}, creating new one`)
        // Ensure the directory exists
        const dbDir = path.dirname(dbPath)
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true })
        }

        // Get database manager for transaction support
        const manager = await getStudyDatabase(this.id, dbPath)
        this.db = manager.getDb()

        log.info('scanning images in folder:', this.folder)
        console.time('Insert media')

        const mediaBatch = []
        const insertBatchSize = 100000

        for await (const mediaPath of walkMediaFiles(this.folder)) {
          const folderName =
            this.folder === path.dirname(mediaPath)
              ? path.basename(this.folder)
              : path.relative(this.folder, path.dirname(mediaPath))

          const mediaData = {
            mediaID: crypto.randomUUID(),
            deploymentID: null,
            timestamp: null,
            filePath: mediaPath,
            fileName: path.basename(mediaPath),
            importFolder: this.folder,
            folderName: folderName,
            fileMediatype: getFileMediatype(mediaPath),
            exifData: null // Populated from Python response for videos (fps, duration, etc.)
          }

          mediaBatch.push(mediaData)

          if (mediaBatch.length >= insertBatchSize) {
            await insertMediaBatch(this.db, manager, mediaBatch)
            this._enqueueMediaJobs(manager, mediaBatch)
            mediaBatch.length = 0 // Clear the array
          }
        }

        // Insert any remaining items
        if (mediaBatch.length > 0) {
          await insertMediaBatch(this.db, manager, mediaBatch)
          this._enqueueMediaJobs(manager, mediaBatch)
        }

        console.timeEnd('Insert media')
      } else {
        const manager = await getStudyDatabase(this.id, dbPath)
        this.db = manager.getDb()
        if (addingMore) {
          log.info('scanning media files in folder:', this.folder)

          const newMedia = []
          for await (const mediaPath of walkMediaFiles(this.folder)) {
            const result = await insertMedia(this.db, mediaPath, this.folder)
            if (result && result.mediaID) {
              newMedia.push(result)
            }
          }
          if (newMedia.length > 0) {
            this._enqueueMediaJobs(manager, newMedia)
          }
        }
      }

      // Start queue-based processing in background (fire-and-forget)
      const topic = `${this.modelReference.id}:${this.modelReference.version}`
      queueScheduler
        .startStudy(this.id, { topic, country: this.country, importPath: this.folder })
        .catch(async (error) => {
          log.error('Error starting queue processing:', error)

          // Emit error event to frontend for toast notification
          const [mainWindow] = BrowserWindow.getAllWindows()
          if (mainWindow) {
            mainWindow.webContents.send('importer:error', {
              studyId: this.id,
              message: 'The AI model could not start. Please try again or restart the app.'
            })
          }
        })

      return this.id
    } catch (error) {
      console.error('Error starting importer:', error)
      if (this.db) {
        await closeStudyDatabase(this.id, this.dbPath)
      }
      throw error
    }
  }
}

ipcMain.handle('importer:select-images-directory-only', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Images Directory'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Selection canceled' }
  }

  const directoryPath = result.filePaths[0]
  return { success: true, directoryPath }
})

ipcMain.handle(
  'importer:select-images-directory-with-model',
  async (event, directoryPath, modelReference, countryCode = null) => {
    try {
      const id = crypto.randomUUID()
      log.info(
        `Creating new importer with ID ${id} for directory: ${directoryPath} with model: ${modelReference.id} and country: ${countryCode}`
      )
      const importer = new Importer(id, directoryPath, modelReference, countryCode)
      await importer.start()

      // Insert metadata into the database
      const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')
      const db = await getDrizzleDb(id, dbPath)
      const metadataRecord = {
        id,
        name: path.basename(directoryPath),
        title: null,
        description: null,
        created: new Date().toISOString(),
        importerName: 'local/ml_run',
        contributors: null,
        sequenceGap: DEFAULT_SEQUENCE_GAP
      }
      await insertMetadata(db, metadataRecord)
      log.info('Inserted study metadata into database')

      return metadataRecord
    } catch (error) {
      log.error('Error processing images directory with model:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }
)

ipcMain.handle('importer:select-more-images-directory', async (event, id) => {
  if (queueScheduler.activeStudyId === id && queueScheduler.isRunning) {
    log.warn(`Processing is already running for study ${id}`)
    return { success: false, message: 'Processing already running' }
  }

  const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')
  if (!fs.existsSync(dbPath)) {
    log.warn(`Study database not found for ID ${id}`)
    return { success: false, message: 'Study not found' }
  }

  // Get latest model run to retrieve model reference and options
  const db = await getDrizzleDb(id, dbPath)
  const latestRun = await getLatestModelRun(db)
  if (!latestRun) {
    log.warn(`No model run found for study ${id}`)
    return { success: false, message: 'No model run found for study' }
  }

  const modelReference = { id: latestRun.modelID, version: latestRun.modelVersion }
  const options = latestRun.options || {}
  const country = options.country || null

  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Images Directory'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Selection canceled' }
  }

  const directoryPath = result.filePaths[0]
  const importer = new Importer(id, directoryPath, modelReference, country)
  await importer.start(true)
  return { success: true, message: 'Importer started successfully' }
})
