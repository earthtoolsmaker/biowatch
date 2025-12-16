/**
 * Main database interface using Drizzle ORM
 * Replaces the old db.js with type-safe database operations
 */

import { eq, desc } from 'drizzle-orm'
import { getStudyDatabase, closeStudyDatabase, closeAllDatabases } from './manager.js'
import { deployments, media, observations, modelRuns, modelOutputs, ocrOutputs, metadata } from './models.js'
import {
  metadataSchema,
  metadataUpdateSchema,
  modelRunOptionsSchema,
  rawOutputSchema
} from './validators.js'
import log from 'electron-log'

// Re-export schema and manager functions
export { deployments, media, observations, modelRuns, modelOutputs, ocrOutputs, metadata }
export { getStudyDatabase, closeStudyDatabase, closeAllDatabases }

// Re-export Zod validation schemas
export {
  contributorSchema,
  contributorsSchema,
  metadataSchema,
  metadataUpdateSchema,
  metadataCreateSchema,
  contributorRoles,
  importerNames,
  // Model run and output schemas
  modelRunOptionsSchema,
  speciesnetRawOutputSchema,
  deepfauneRawOutputSchema,
  manasRawOutputSchema,
  rawOutputSchema
} from './validators.js'

/**
 * Helper function to get Drizzle database instance for a study
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @param {Object} options - Database options (e.g., {readonly: true})
 * @returns {Promise<Object>} Drizzle database instance
 */
export async function getDrizzleDb(studyId, dbPath, options = {}) {
  const manager = await getStudyDatabase(studyId, dbPath, options)
  return manager.getDb()
}

/**
 * Helper function to get a readonly Drizzle database instance for a study
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @returns {Promise<Object>} Readonly Drizzle database instance
 */
export async function getReadonlyDrizzleDb(studyId, dbPath) {
  const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
  return manager.getDb()
}

/**
 * Helper function to execute raw SQL queries when needed
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
export async function executeRawQuery(studyId, dbPath, query, params = []) {
  const manager = await getStudyDatabase(studyId, dbPath)
  const sqlite = manager.getSqlite()

  try {
    const statement = sqlite.prepare(query)
    return statement.all(params)
  } catch (error) {
    log.error(`[DB] Raw query failed for study ${studyId}:`, error)
    throw error
  }
}

// ============================================================================
// Metadata CRUD operations
// ============================================================================

/**
 * Insert study metadata into the database
 * @param {Object} db - Drizzle database instance
 * @param {Object} data - Metadata object
 * @returns {Promise<Object>} Inserted metadata
 */
export async function insertMetadata(db, data) {
  const result = await db.insert(metadata).values(data).returning()
  return result[0]
}

/**
 * Get study metadata from the database
 * @param {Object} db - Drizzle database instance
 * @returns {Promise<Object|null>} Validated metadata object or null if not found
 */
export async function getMetadata(db) {
  const result = await db.select().from(metadata).limit(1)
  if (!result[0]) return null

  // Validate the metadata structure
  const parsed = metadataSchema.safeParse(result[0])
  if (!parsed.success) {
    log.warn('Invalid metadata in database:', parsed.error.format())
    // Return raw data anyway to avoid breaking the app, but log the warning
    return result[0]
  }
  return parsed.data
}

/**
 * Update study metadata in the database
 * @param {Object} db - Drizzle database instance
 * @param {string} id - Study ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated metadata
 * @throws {Error} If updates don't match expected schema
 */
export async function updateMetadata(db, id, updates) {
  // Validate updates before writing
  const parsed = metadataUpdateSchema.safeParse(updates)
  if (!parsed.success) {
    const errorMessage = `Invalid metadata update: ${JSON.stringify(parsed.error.format())}`
    log.error(errorMessage)
    throw new Error(errorMessage)
  }

  const result = await db
    .update(metadata)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(metadata.id, id))
    .returning()
  return result[0]
}

/**
 * Insert a model run record with optional importPath and options
 * @param {Object} db - Drizzle database instance
 * @param {Object} data - Model run data including id, modelID, modelVersion, startedAt, status, importPath, options
 * @returns {Promise<Object>} Inserted model run
 * @throws {Error} If options don't match expected schema
 */
export async function insertModelRun(db, data) {
  // Validate options before insert (strict validation)
  if (data.options !== undefined) {
    const parsed = modelRunOptionsSchema.safeParse(data.options)
    if (!parsed.success) {
      const errorMessage = `Invalid model run options: ${JSON.stringify(parsed.error.format())}`
      log.error(errorMessage)
      throw new Error(errorMessage)
    }
  }

  const result = await db.insert(modelRuns).values(data).returning()
  return result[0]
}

/**
 * Insert a model output record with validated rawOutput
 * @param {Object} db - Drizzle database instance
 * @param {Object} data - Model output data including id, mediaID, runID, rawOutput
 * @returns {Promise<Object>} Inserted model output
 * @throws {Error} If rawOutput doesn't match expected schema
 */
export async function insertModelOutput(db, data) {
  // Validate rawOutput before insert (strict validation)
  if (data.rawOutput !== undefined && data.rawOutput !== null) {
    const parsed = rawOutputSchema.safeParse(data.rawOutput)
    if (!parsed.success) {
      const errorMessage = `Invalid model output rawOutput: ${JSON.stringify(parsed.error.format())}`
      log.error(errorMessage)
      throw new Error(errorMessage)
    }
  }

  const result = await db.insert(modelOutputs).values(data).returning()
  return result[0]
}

/**
 * Get the latest model run for a study (for resume functionality)
 * @param {Object} db - Drizzle database instance
 * @returns {Promise<Object|null>} Latest model run or null
 */
export async function getLatestModelRun(db) {
  const result = await db.select().from(modelRuns).orderBy(desc(modelRuns.startedAt)).limit(1)
  return result[0] || null
}

// ============================================================================
// Re-export all query functions for unified imports
// ============================================================================

export {
  // Utils
  formatToMatchOriginal,
  getStudyIdFromPath,
  isTimestampBasedDataset,
  checkStudyHasEventIDs,
  createImageDirectoryDatabase,
  // Deployments
  getDeployments,
  getLocationsActivity,
  insertDeployments,
  getDeploymentsActivity,
  // Species
  getSpeciesDistribution,
  getBlankMediaCount,
  getSpeciesTimeseries,
  getSpeciesHeatmapData,
  getSpeciesDailyActivity,
  getDistinctSpecies,
  // Media
  getMedia,
  getFilesData,
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  updateMediaTimestamp,
  insertMedia,
  updateMediaFavorite,
  countMediaWithNullTimestamps,
  // Observations
  updateObservationClassification,
  updateObservationBbox,
  deleteObservation,
  createObservation,
  insertObservations,
  // Best media
  getTemporalBucket,
  selectDiverseMedia,
  getBestMedia
} from './queries/index.js'
