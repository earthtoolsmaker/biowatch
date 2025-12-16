import { sqliteTable, text, real, integer, unique, index } from 'drizzle-orm/sqlite-core'

export const deployments = sqliteTable(
  'deployments',
  {
    deploymentID: text('deploymentID').primaryKey(),
    locationID: text('locationID'),
    locationName: text('locationName'),
    deploymentStart: text('deploymentStart'),
    deploymentEnd: text('deploymentEnd'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    // CamtrapDP fields extracted from EXIF
    cameraModel: text('cameraModel'), // "Make-Model" format per CamtrapDP spec
    cameraID: text('cameraID'), // Camera serial number from EXIF
    coordinateUncertainty: integer('coordinateUncertainty') // GPS horizontal error in meters
  },
  (table) => [index('idx_deployments_locationID').on(table.locationID)]
)

export const media = sqliteTable(
  'media',
  {
    mediaID: text('mediaID').primaryKey(),
    deploymentID: text('deploymentID').references(() => deployments.deploymentID),
    timestamp: text('timestamp'),
    filePath: text('filePath'),
    fileName: text('fileName'),
    importFolder: text('importFolder'),
    folderName: text('folderName'),
    // Camtrap DP compliant fields
    fileMediatype: text('fileMediatype').default('image/jpeg'), // IANA media type (e.g. 'image/jpeg', 'video/mp4')
    exifData: text('exifData', { mode: 'json' }), // Video/image metadata as JSON
    favorite: integer('favorite', { mode: 'boolean' }).default(false) // User-marked favorite/best capture
  },
  (table) => [
    index('idx_media_deploymentID').on(table.deploymentID),
    index('idx_media_timestamp').on(table.timestamp),
    index('idx_media_filePath').on(table.filePath),
    index('idx_media_folderName').on(table.folderName)
  ]
)

// Study metadata (Camtrap DP aligned)
export const metadata = sqliteTable('metadata', {
  id: text('id').primaryKey(), // Study UUID
  name: text('name'), // Package name/identifier
  title: text('title'), // Human-readable title
  description: text('description'), // Dataset description (Markdown)
  created: text('created').notNull(), // ISO 8601 creation date
  importerName: text('importerName').notNull(), // camtrap/datapackage, wildlife/folder, local/images, etc.
  contributors: text('contributors', { mode: 'json' }), // JSON: [{title, email, role, organization, path}]
  updatedAt: text('updatedAt'), // Last modification
  startDate: text('startDate'), // Temporal start (ISO date)
  endDate: text('endDate') // Temporal end (ISO date)
})

// Track model execution sessions
export const modelRuns = sqliteTable(
  'model_runs',
  {
    id: text('id').primaryKey(), // UUID via crypto.randomUUID()
    modelID: text('modelID').notNull(), // 'speciesnet', 'deepfaune'
    modelVersion: text('modelVersion').notNull(), // '4.0.1a', '1.3'
    startedAt: text('startedAt').notNull(), // ISO timestamp
    status: text('status').default('running'), // 'running', 'completed', 'failed'
    importPath: text('importPath'), // Directory path for this run
    options: text('options', { mode: 'json' }) // JSON: {"country": "FR", "geofence": true, ...}
  },
  (table) => [index('idx_model_runs_startedAt').on(table.startedAt)]
)

// Link media to model runs + store raw response
export const modelOutputs = sqliteTable(
  'model_outputs',
  {
    id: text('id').primaryKey(), // UUID via crypto.randomUUID()
    mediaID: text('mediaID')
      .notNull()
      .references(() => media.mediaID, { onDelete: 'cascade' }),
    runID: text('runID')
      .notNull()
      .references(() => modelRuns.id, { onDelete: 'cascade' }),
    rawOutput: text('rawOutput', { mode: 'json' }) // Full JSON model response
  },
  (table) => [
    unique().on(table.mediaID, table.runID),
    index('idx_model_outputs_runID').on(table.runID)
  ]
)

// Store OCR results for media files
export const ocrOutputs = sqliteTable(
  'ocr_outputs',
  {
    id: text('id').primaryKey(), // UUID via crypto.randomUUID()
    mediaID: text('mediaID')
      .notNull()
      .references(() => media.mediaID, { onDelete: 'cascade' }),
    modelID: text('modelID').notNull(), // 'tesseract' (extensible for future OCR engines)
    modelVersion: text('modelVersion').notNull(), // '5.1.1' (tesseract.js version)
    createdAt: text('createdAt').notNull(), // ISO timestamp
    rawOutput: text('rawOutput', { mode: 'json' }) // Full OCR result (timestamp derived from here)
  },
  (table) => [index('idx_ocr_outputs_mediaID').on(table.mediaID)]
)

export const observations = sqliteTable(
  'observations',
  {
    observationID: text('observationID').primaryKey(),
    mediaID: text('mediaID').references(() => media.mediaID),
    deploymentID: text('deploymentID').references(() => deployments.deploymentID),
    eventID: text('eventID'),
    eventStart: text('eventStart'),
    eventEnd: text('eventEnd'),
    scientificName: text('scientificName'),
    observationType: text('observationType'),
    commonName: text('commonName'),
    classificationProbability: real('classificationProbability'),
    count: integer('count'),
    lifeStage: text('lifeStage'),
    age: text('age'),
    sex: text('sex'),
    behavior: text('behavior'),
    // Bounding box fields (Camtrap DP format: top-left corner, normalized 0-1)
    bboxX: real('bboxX'),
    bboxY: real('bboxY'),
    bboxWidth: real('bboxWidth'),
    bboxHeight: real('bboxHeight'),
    // Detection confidence (bbox confidence from model, separate from classification confidence)
    detectionConfidence: real('detectionConfidence'),
    // Model output link (nullable - NULL if manual entry without model)
    modelOutputID: text('modelOutputID').references(() => modelOutputs.id),
    // Camtrap DP classification fields (all nullable)
    classificationMethod: text('classificationMethod'), // 'machine' | 'human'
    classifiedBy: text('classifiedBy'), // 'SpeciesNet 4.0.1a' or 'John Doe'
    classificationTimestamp: text('classificationTimestamp') // ISO 8601 with timezone
  },
  (table) => [
    index('idx_observations_mediaID').on(table.mediaID),
    index('idx_observations_deploymentID').on(table.deploymentID),
    index('idx_observations_scientificName').on(table.scientificName),
    index('idx_observations_eventStart').on(table.eventStart),
    index('idx_observations_scientificName_eventStart').on(table.scientificName, table.eventStart),
    index('idx_observations_mediaID_deploymentID').on(table.mediaID, table.deploymentID)
  ]
)
