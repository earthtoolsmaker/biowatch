import fs from 'fs'
import path from 'path'
import os from 'os'
import { DateTime } from 'luxon'
import { getDrizzleDb, deployments, media, observations, insertMetadata } from '../db/index.js'
import { downloadFileWithRetry, extractZip } from '../download.ts'

// Conditionally import electron modules for production, use fallback for testing
let app, log

// Initialize electron modules with proper async handling
async function initializeElectronModules() {
  if (app && log) return // Already initialized

  try {
    const electron = await import('electron')
    app = electron.app
    const electronLog = await import('electron-log')
    log = electronLog.default
  } catch {
    // Fallback for testing environment
    app = {
      getPath: () => '/tmp'
    }
    log = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {}
    }
  }
}

/**
 * Whitelisted LILA datasets with their metadata and access URLs
 * Images are loaded via HTTP at runtime from Azure Blob Storage
 */
export const LILA_DATASETS = [
  {
    id: 'biome-health-maasai-mara-2018',
    name: 'Biome Health Project Maasai Mara 2018',
    description: 'Wildlife monitoring dataset from Maasai Mara ecosystem, Kenya (2018)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/biome-health-project-maasai-mara-2018/biome-health-project-maasai-mara-2018.json',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/biome-health-project-maasai-mara-2018/',
    isZipped: false,
    imageCount: 37075,
    categoryCount: 100
  },
  {
    id: 'snapshot-karoo',
    name: 'Snapshot Karoo',
    description: 'Wildlife from Karoo National Park, South Africa',
    metadataUrl:
      'https://storage.googleapis.com/public-datasets-lila/snapshot-safari/KAR/SnapshotKaroo_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KAR/KAR_public/',
    isZipped: true,
    imageCount: 38074,
    categoryCount: 38
  },
  {
    id: 'ena24-detection',
    name: 'ENA24 Detection',
    description: 'Eastern North America camera traps with bounding boxes (23 species)',
    metadataUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/ena24/ena24.json',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/ena24/images/',
    isZipped: false,
    imageCount: 10000,
    categoryCount: 23
  },
  {
    id: 'caltech-camera-traps',
    name: 'Caltech Camera Traps',
    description: 'Wildlife from Southwestern United States (21 species, 243K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/caltechcameratraps/labels/caltech_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/caltech-unzipped/cct_images/',
    isZipped: true,
    imageCount: 243100,
    categoryCount: 21
  },
  {
    id: 'missouri-camera-traps',
    name: 'Missouri Camera Traps',
    description: 'Wildlife from Missouri, USA (20 species, 25K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/missouricameratraps/missouri_camera_traps_set1_1.21.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/missouricameratraps/images/',
    isZipped: true,
    imageCount: 25000,
    categoryCount: 20
  },
  {
    id: 'nacti',
    name: 'North American Camera Trap Images',
    description: 'Wildlife from 5 US locations (28 species, 3.7M images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/nacti/nacti_metadata.1.14.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/nacti-unzipped/',
    isZipped: true,
    imageCount: 3700000,
    categoryCount: 28
  },
  {
    id: 'wcs-camera-traps',
    name: 'WCS Camera Traps',
    description: 'Wildlife Conservation Society data from 12 countries (675 species, 1.4M images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/wcs/wcs_camera_traps.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/wcs-unzipped/',
    isZipped: true,
    imageCount: 1400000,
    categoryCount: 675
  },
  {
    id: 'wellington-camera-traps',
    name: 'Wellington Camera Traps',
    description: 'Wildlife from Wellington, New Zealand (270K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/wellingtoncameratraps/wellington_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/wellington-unzipped/images/',
    isZipped: true,
    imageCount: 270450,
    categoryCount: 17
  },
  {
    id: 'island-conservation-camera-traps',
    name: 'Island Conservation Camera Traps',
    description: 'Invasive species detection on islands (123K images, bboxes available)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/islandconservationcameratraps/island_conservation_camera_traps_1.02.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/islandconservationcameratraps/public/',
    isZipped: true,
    imageCount: 123000,
    categoryCount: 20
  },
  {
    id: 'channel-islands-camera-traps',
    name: 'Channel Islands Camera Traps',
    description: 'California Channel Islands wildlife with bounding boxes (246K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/channel-islands-camera-traps/channel-islands-camera-traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/channel-islands-camera-traps/images/',
    isZipped: true,
    imageCount: 246529,
    categoryCount: 10
  },
  {
    id: 'idaho-camera-traps',
    name: 'Idaho Camera Traps',
    description: 'Wildlife from Idaho, USA (62 species, 1.5M images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/idaho-camera-traps/idaho-camera-traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/idaho-camera-traps/public/',
    isZipped: true,
    imageCount: 1500000,
    categoryCount: 62
  },
  {
    id: 'snapshot-serengeti',
    name: 'Snapshot Serengeti',
    description: 'Serengeti National Park, Tanzania (61 species, 7.1M images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshotserengeti-v-2-0/SnapshotSerengeti_S1-11_v2_1.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshotserengeti-unzipped/',
    isZipped: true,
    imageCount: 7100000,
    categoryCount: 61
  },
  {
    id: 'snapshot-kgalagadi',
    name: 'Snapshot Kgalagadi',
    description: 'Kgalagadi Transfrontier Park, South Africa (10K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KGA/SnapshotKgalagadi_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KGA/KGA_public/',
    isZipped: true,
    imageCount: 10222,
    categoryCount: 30
  },
  {
    id: 'snapshot-enonkishu',
    name: 'Snapshot Enonkishu',
    description: 'Enonkishu Conservancy, Kenya (28K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/ENO/SnapshotEnonkishu_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/ENO/ENO_public/',
    isZipped: true,
    imageCount: 28544,
    categoryCount: 35
  },
  {
    id: 'snapshot-camdeboo',
    name: 'Snapshot Camdeboo',
    description: 'Camdeboo National Park, South Africa (30K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/CDB/SnapshotCamdeboo_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/CDB/CDB_public/',
    isZipped: true,
    imageCount: 30227,
    categoryCount: 35
  },
  {
    id: 'snapshot-mountain-zebra',
    name: 'Snapshot Mountain Zebra',
    description: 'Mountain Zebra National Park, South Africa (73K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/MTZ/SnapshotMountainZebra_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/MTZ/MTZ_public/',
    isZipped: true,
    imageCount: 73034,
    categoryCount: 30
  },
  {
    id: 'snapshot-kruger',
    name: 'Snapshot Kruger',
    description: 'Kruger National Park, South Africa (10K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KRU/SnapshotKruger_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KRU/KRU_public/',
    isZipped: true,
    imageCount: 10072,
    categoryCount: 40
  },
  {
    id: 'swg-camera-traps',
    name: 'SWG Camera Traps',
    description: 'Snapshot Wisconsin/Germany wildlife (2M images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/swg-camera-traps/swg_camera_traps.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/swg-camera-traps/',
    isZipped: true,
    imageCount: 2039657,
    categoryCount: 30
  },
  {
    id: 'orinoquia-camera-traps',
    name: 'Orinoquia Camera Traps',
    description: 'Colombian Orinoquia region wildlife (104K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/orinoquia-camera-traps/orinoquia_camera_traps_metadata.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/orinoquia-camera-traps/public/',
    isZipped: true,
    imageCount: 104782,
    categoryCount: 50
  },
  {
    id: 'nz-trailcams',
    name: 'Trail Camera Images of New Zealand Animals',
    description: 'New Zealand wildlife (2.5M images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/nz-trailcams/trail_camera_images_of_new_zealand_animals_1.00.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/nz-trailcams/',
    isZipped: true,
    imageCount: 2500000,
    categoryCount: 15
  },
  {
    id: 'desert-lion-camera-traps',
    name: 'Desert Lion Conservation Camera Traps',
    description: 'Namibian desert lions (66K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/desert-lion-camera-traps/desert_lion_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/desert-lion-camera-traps/annotated-imgs/',
    isZipped: true,
    imageCount: 65959,
    categoryCount: 20
  },
  {
    id: 'ohio-small-animals',
    name: 'Ohio Small Animals',
    description: 'Small mammals from Ohio, USA (45 species, 118K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/osu-small-animals/osu-small-animals.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/osu-small-animals/',
    isZipped: true,
    imageCount: 118554,
    categoryCount: 45
  },
  {
    id: 'seattleish-camera-traps',
    name: 'Seattle(ish) Camera Traps',
    description: 'Urban wildlife from Seattle area, USA',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/seattleish-camera-traps/seattleish_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/seattleish-camera-traps/',
    isZipped: true,
    imageCount: 50000,
    categoryCount: 20
  },
  {
    id: 'unsw-predators',
    name: 'UNSW Predators',
    description: 'Australian predator monitoring (131K images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/unsw-predators/unsw-predators.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/unsw-predators/images/',
    isZipped: true,
    imageCount: 131802,
    categoryCount: 15
  },
  {
    id: 'nkhotakota-camera-traps',
    name: 'Nkhotakota Camera Traps',
    description: 'Nkhotakota Wildlife Reserve, Malawi (321K images, some bboxes)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/nkhotakota-camera-traps/nkhotakota_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/nkhotakota-camera-traps/',
    isZipped: true,
    imageCount: 321562,
    categoryCount: 46
  },
  {
    id: 'california-small-animals',
    name: 'California Small Animals',
    description: 'Small mammals from California, USA (2.2M images)',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/california-small-animals/california_small_animals_with_sequences.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/california-small-animals/',
    isZipped: true,
    imageCount: 2278071,
    categoryCount: 30
  }
]

/**
 * Category names that indicate blank/empty images (case-insensitive)
 * These should not create observations - media records are still created
 */
const BLANK_CATEGORY_NAMES = new Set(['empty', 'blank', 'nothing'])

/**
 * Check if a category name represents a blank/empty image
 * @param {string} categoryName - The category name to check
 * @returns {boolean} - True if the category indicates a blank/empty image
 */
function isBlankCategory(categoryName) {
  if (!categoryName) return false
  return BLANK_CATEGORY_NAMES.has(categoryName.toLowerCase().trim())
}

/**
 * Import a LILA dataset by its ID
 * @param {string} datasetId - ID of the LILA dataset to import
 * @param {string} id - Unique ID for the study
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} - Object containing dbPath and metadata
 */
export async function importLilaDataset(datasetId, id, onProgress = null) {
  await initializeElectronModules()
  const biowatchDataPath = path.join(app.getPath('userData'), 'biowatch-data')
  return await importLilaDatasetWithPath(datasetId, biowatchDataPath, id, onProgress)
}

/**
 * Import a LILA dataset (core function for testing)
 * @param {string} datasetId - ID of the LILA dataset to import
 * @param {string} biowatchDataPath - Path to the biowatch-data directory
 * @param {string} id - Unique ID for the study
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} - Object containing dbPath and metadata
 */
export async function importLilaDatasetWithPath(
  datasetId,
  biowatchDataPath,
  id,
  onProgress = null
) {
  await initializeElectronModules()
  log.info(`Starting LILA dataset import for: ${datasetId}`)

  // Find the dataset configuration
  const dataset = LILA_DATASETS.find((d) => d.id === datasetId)
  if (!dataset) {
    throw new Error(`Unknown LILA dataset: ${datasetId}`)
  }

  // Create database in the specified biowatch-data directory
  const dbPath = path.join(biowatchDataPath, 'studies', id, 'study.db')
  log.info(`Creating database at: ${dbPath}`)

  // Ensure the directory exists
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  // Get Drizzle database connection
  const db = await getDrizzleDb(id, dbPath)

  try {
    // Stage 1: Download metadata
    if (onProgress) {
      onProgress({
        stage: 'downloading',
        stageIndex: 0,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    const cocoData = await downloadAndParseMetadata(dataset, onProgress)
    log.info(`Downloaded metadata: ${cocoData.images?.length || 0} images`)

    // Stage 2: Parse COCO format
    if (onProgress) {
      onProgress({
        stage: 'parsing',
        stageIndex: 1,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    // Validate COCO data
    const validationErrors = validateCOCOData(cocoData)
    if (validationErrors.length > 0) {
      throw new Error(`Invalid COCO data: ${validationErrors.join(', ')}`)
    }

    // Build category lookup map
    const categoryMap = new Map()
    if (cocoData.categories) {
      for (const cat of cocoData.categories) {
        categoryMap.set(cat.id, cat.name)
      }
    }
    log.info(`Built category map with ${categoryMap.size} categories`)

    // Build image lookup map for annotations
    const imageMap = new Map()
    for (const img of cocoData.images) {
      imageMap.set(img.id, img)
    }

    // Transform data
    const deploymentsData = transformCOCOToDeployments(cocoData.images)
    const mediaData = transformCOCOToMedia(cocoData.images, dataset.imageBaseUrl)
    const observationsData = transformCOCOToObservations(
      cocoData.annotations || [],
      categoryMap,
      imageMap
    )

    log.info(
      `Transformed: ${deploymentsData.length} deployments, ${mediaData.length} media, ${observationsData.length} observations`
    )

    // Stage 3: Import to database
    if (onProgress) {
      onProgress({
        stage: 'importing',
        stageIndex: 2,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    // Insert deployments
    await batchInsert(db, deployments, deploymentsData, 'deployments', (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'importing',
          stageIndex: 2,
          totalStages: 3,
          datasetTitle: dataset.name,
          importProgress: {
            table: 'deployments',
            ...progress
          }
        })
      }
    })

    // Insert media
    await batchInsert(db, media, mediaData, 'media', (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'importing',
          stageIndex: 2,
          totalStages: 3,
          datasetTitle: dataset.name,
          importProgress: {
            table: 'media',
            ...progress
          }
        })
      }
    })

    // Insert observations
    await batchInsert(db, observations, observationsData, 'observations', (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'importing',
          stageIndex: 2,
          totalStages: 3,
          datasetTitle: dataset.name,
          importProgress: {
            table: 'observations',
            ...progress
          }
        })
      }
    })

    // Insert metadata
    const metadataRecord = {
      id,
      name: dataset.name,
      title: cocoData.info?.description || dataset.name,
      description: dataset.description,
      created: new Date().toISOString(),
      importerName: 'lila/coco',
      contributors: null,
      startDate: null,
      endDate: null
    }
    await insertMetadata(db, metadataRecord)
    log.info('Inserted study metadata into database')

    // Signal completion
    if (onProgress) {
      onProgress({
        stage: 'complete',
        stageIndex: 3,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    log.info('LILA dataset import completed successfully')

    return {
      dbPath,
      data: metadataRecord
    }
  } catch (error) {
    log.error('Error importing LILA dataset:', error)

    if (onProgress) {
      onProgress({
        stage: 'error',
        stageIndex: -1,
        totalStages: 3,
        datasetTitle: dataset.name,
        error: {
          message: error.message
        }
      })
    }

    throw error
  }
}

/**
 * Download and parse LILA metadata (JSON or ZIP)
 */
async function downloadAndParseMetadata(dataset, onProgress) {
  await initializeElectronModules()

  const tempDir = path.join(os.tmpdir(), 'biowatch-lila-import')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  if (dataset.isZipped) {
    // Download ZIP file
    const zipPath = path.join(tempDir, `${dataset.id}.zip`)
    await downloadFileWithRetry(dataset.metadataUrl, zipPath, (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'downloading',
          stageIndex: 0,
          totalStages: 3,
          datasetTitle: dataset.name,
          downloadProgress: progress
        })
      }
    })

    // Extract ZIP
    const extractPath = path.join(tempDir, dataset.id)
    await extractZip(zipPath, extractPath)

    // Find JSON file in extracted contents
    const jsonFile = findJsonFile(extractPath)
    if (!jsonFile) {
      throw new Error('No JSON file found in ZIP archive')
    }

    const jsonContent = fs.readFileSync(jsonFile, 'utf8')
    return JSON.parse(sanitizeJsonString(jsonContent))
  } else {
    // Download JSON directly
    const jsonPath = path.join(tempDir, `${dataset.id}.json`)
    await downloadFileWithRetry(dataset.metadataUrl, jsonPath, (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'downloading',
          stageIndex: 0,
          totalStages: 3,
          datasetTitle: dataset.name,
          downloadProgress: progress
        })
      }
    })

    const jsonContent = fs.readFileSync(jsonPath, 'utf8')
    return JSON.parse(sanitizeJsonString(jsonContent))
  }
}

/**
 * Sanitize JSON string by replacing invalid NaN values with null
 * LILA datasets sometimes contain NaN from Python/NumPy which is not valid JSON
 */
function sanitizeJsonString(jsonString) {
  // Replace standalone NaN (not part of a string) with null
  // Matches: NaN preceded by colon and optional whitespace, followed by comma, closing bracket, or whitespace
  return jsonString.replace(/:\s*NaN\s*([,}\]])/g, ': null$1')
}

/**
 * Recursively find a JSON file in a directory
 */
function findJsonFile(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findJsonFile(fullPath)
      if (found) return found
    } else if (entry.name.endsWith('.json')) {
      return fullPath
    }
  }

  return null
}

/**
 * Validate COCO Camera Traps data structure
 */
function validateCOCOData(data) {
  const errors = []

  if (!data.images || !Array.isArray(data.images)) {
    errors.push('Missing or invalid "images" array')
  }

  if (data.images && data.images.length === 0) {
    errors.push('Empty "images" array')
  }

  // categories and annotations can be optional
  if (data.categories && !Array.isArray(data.categories)) {
    errors.push('Invalid "categories" - must be array if present')
  }

  if (data.annotations && !Array.isArray(data.annotations)) {
    errors.push('Invalid "annotations" - must be array if present')
  }

  return errors
}

/**
 * Transform COCO images to Biowatch deployments
 * Uses the 'location' field as deploymentID
 * Computes deploymentStart/deploymentEnd from MIN/MAX image datetimes per location
 */
function transformCOCOToDeployments(images) {
  // Group images by location and compute temporal bounds
  const locationData = new Map()

  for (const img of images) {
    if (!img.location) continue

    const loc = String(img.location)
    if (!locationData.has(loc)) {
      locationData.set(loc, {
        minDatetime: null,
        maxDatetime: null
      })
    }

    const data = locationData.get(loc)
    const imgDatetime = img.datetime ? transformDateField(img.datetime) : null

    if (imgDatetime) {
      if (!data.minDatetime || imgDatetime < data.minDatetime) {
        data.minDatetime = imgDatetime
      }
      if (!data.maxDatetime || imgDatetime > data.maxDatetime) {
        data.maxDatetime = imgDatetime
      }
    }
  }

  return Array.from(locationData.entries()).map(([location, data]) => ({
    deploymentID: location,
    locationID: location,
    locationName: location,
    deploymentStart: data.minDatetime,
    deploymentEnd: data.maxDatetime,
    latitude: null,
    longitude: null,
    cameraModel: null,
    cameraID: null,
    coordinateUncertainty: null
  }))
}

/**
 * Transform COCO images to Biowatch media
 * Constructs HTTP URLs for lazy loading
 */
function transformCOCOToMedia(images, imageBaseUrl) {
  return images.map((img) => ({
    mediaID: String(img.id),
    deploymentID: img.location ? String(img.location) : null,
    timestamp: transformDateField(img.datetime),
    filePath: `${imageBaseUrl}${img.file_name}`,
    fileName: img.file_name,
    fileMediatype: getMediaTypeFromFileName(img.file_name),
    exifData: null,
    favorite: false
  }))
}

/**
 * Transform COCO annotations to Biowatch observations
 * Filters out blank/empty categories - no observation is created for those
 */
function transformCOCOToObservations(annotations, categoryMap, imageMap) {
  return annotations
    .map((ann, index) => {
      const image = imageMap.get(ann.image_id)
      const categoryName = categoryMap.get(ann.category_id) || 'Unknown'

      // Filter out blank/empty categories - no observation should be created
      // Media records are still created, but blank images have no observation
      if (isBlankCategory(categoryName)) {
        return null
      }

      // Normalize bounding box from pixels to 0-1
      const bbox = normalizeBbox(ann.bbox, image?.width, image?.height)

      return {
        observationID: ann.id ? String(ann.id) : `obs_${ann.image_id}_${index}`,
        mediaID: String(ann.image_id),
        deploymentID: image?.location ? String(image.location) : null,
        eventID: null,
        eventStart: image?.datetime ? transformDateField(image.datetime) : null,
        eventEnd: image?.datetime ? transformDateField(image.datetime) : null,
        scientificName: categoryName,
        commonName: categoryName,
        observationType: 'animal',
        classificationProbability: null,
        count: 1,
        prediction: null,
        lifeStage: null,
        age: null,
        sex: null,
        behavior: null,
        bboxX: bbox?.bboxX ?? null,
        bboxY: bbox?.bboxY ?? null,
        bboxWidth: bbox?.bboxWidth ?? null,
        bboxHeight: bbox?.bboxHeight ?? null
      }
    })
    .filter(Boolean) // Remove null entries (filtered blank/empty categories)
}

/**
 * Normalize COCO bbox from pixels to 0-1 coordinates
 * COCO format: [x, y, width, height] in pixels (top-left origin)
 * Biowatch format: normalized 0-1 coordinates
 */
function normalizeBbox(bbox, imageWidth, imageHeight) {
  if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
    return null
  }

  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
    return null
  }

  const [x, y, width, height] = bbox

  return {
    bboxX: x / imageWidth,
    bboxY: y / imageHeight,
    bboxWidth: width / imageWidth,
    bboxHeight: height / imageHeight
  }
}

/**
 * Transform date field from COCO format to ISO
 */
function transformDateField(dateValue) {
  if (!dateValue) return null

  // Try ISO format first
  let date = DateTime.fromISO(dateValue)
  if (date.isValid) {
    return date.toUTC().toISO()
  }

  // Try COCO common format: "2022-12-31 09:52:50"
  date = DateTime.fromFormat(dateValue, 'yyyy-MM-dd HH:mm:ss')
  if (date.isValid) {
    return date.toUTC().toISO()
  }

  return null
}

/**
 * Get MIME type from file name
 */
function getMediaTypeFromFileName(fileName) {
  if (!fileName) return 'image/jpeg'

  const ext = fileName.toLowerCase().split('.').pop()
  const mimeTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp'
  }

  return mimeTypes[ext] || 'image/jpeg'
}

/**
 * Batch insert data into database
 */
async function batchInsert(db, table, data, tableName, onProgress) {
  await initializeElectronModules()

  if (data.length === 0) {
    log.info(`No data to insert for ${tableName}`)
    return
  }

  const batchSize = 1000
  const totalBatches = Math.ceil(data.length / batchSize)

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    await db.insert(table).values(batch)

    const insertedRows = Math.min(i + batchSize, data.length)
    const batchNumber = Math.floor(i / batchSize) + 1

    log.debug(`Inserted batch ${batchNumber}/${totalBatches} into ${tableName}`)

    if (onProgress) {
      onProgress({
        insertedRows,
        totalRows: data.length,
        batchNumber,
        totalBatches
      })
    }
  }

  log.info(`Completed insertion of ${data.length} rows into ${tableName}`)
}
