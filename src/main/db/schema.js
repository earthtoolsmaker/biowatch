import { sqliteTable, text, real, integer, unique } from 'drizzle-orm/sqlite-core'

export const deployments = sqliteTable('deployments', {
  deploymentID: text('deploymentID').primaryKey(),
  locationID: text('locationID'),
  locationName: text('locationName'),
  deploymentStart: text('deploymentStart'),
  deploymentEnd: text('deploymentEnd'),
  latitude: real('latitude'),
  longitude: real('longitude')
})

export const media = sqliteTable('media', {
  mediaID: text('mediaID').primaryKey(),
  deploymentID: text('deploymentID').references(() => deployments.deploymentID),
  timestamp: text('timestamp'),
  filePath: text('filePath'),
  fileName: text('fileName'),
  importFolder: text('importFolder'),
  folderName: text('folderName'),
  // Video support fields
  mediaType: text('mediaType').default('image'), // 'image' | 'video' | 'audio' (future)
  duration: real('duration'), // Duration in seconds (nullable, for video/audio)
  fps: real('fps') // Frames per second (nullable, for video)
})

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
export const modelRuns = sqliteTable('model_runs', {
  id: text('id').primaryKey(), // UUID via crypto.randomUUID()
  modelID: text('modelID').notNull(), // 'speciesnet', 'deepfaune'
  modelVersion: text('modelVersion').notNull(), // '4.0.1a', '1.3'
  startedAt: text('startedAt').notNull(), // ISO timestamp
  status: text('status').default('running'), // 'running', 'completed', 'failed'
  importPath: text('importPath'), // Directory path for this run
  options: text('options', { mode: 'json' }) // JSON: {"country": "FR", "geofence": true, ...}
})

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
  (table) => [unique().on(table.mediaID, table.runID)]
)

export const observations = sqliteTable('observations', {
  observationID: text('observationID').primaryKey(),
  mediaID: text('mediaID').references(() => media.mediaID),
  deploymentID: text('deploymentID').references(() => deployments.deploymentID),
  eventID: text('eventID'),
  eventStart: text('eventStart'),
  eventEnd: text('eventEnd'),
  scientificName: text('scientificName'),
  observationType: text('observationType'),
  commonName: text('commonName'),
  confidence: real('confidence'),
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
})
