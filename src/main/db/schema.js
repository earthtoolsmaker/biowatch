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
  folderName: text('folderName')
})

// Track model execution sessions
export const modelRuns = sqliteTable('model_runs', {
  id: text('id').primaryKey(), // UUID via crypto.randomUUID()
  modelID: text('modelID').notNull(), // 'speciesnet', 'deepfaune'
  modelVersion: text('modelVersion').notNull(), // '4.0.1a', '1.3'
  startedAt: text('startedAt').notNull(), // ISO timestamp
  status: text('status').default('running') // 'running', 'completed', 'failed'
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
  // Model output link (nullable - NULL if manual entry without model)
  modelOutputID: text('modelOutputID').references(() => modelOutputs.id),
  // Camtrap DP classification fields (all nullable)
  classificationMethod: text('classificationMethod'), // 'machine' | 'human'
  classifiedBy: text('classifiedBy'), // 'SpeciesNet 4.0.1a' or 'John Doe'
  classificationTimestamp: text('classificationTimestamp') // ISO 8601 with timezone
})
