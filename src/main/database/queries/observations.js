/**
 * Observation-related database queries
 */

import { getDrizzleDb, observations } from '../index.js'
import { eq } from 'drizzle-orm'
import log from 'electron-log'
import { getStudyIdFromPath } from './utils.js'
import { lifeStageSchema, sexSchema, behaviorSchema } from '../validators.js'

/**
 * Update an observation's classification (species) with CamTrap DP compliant fields.
 * When a human updates the classification:
 * - scientificName is updated to the new value
 * - classificationMethod is set to 'human'
 * - classifiedBy is set to 'User'
 * - classificationTimestamp is set to current ISO 8601 timestamp
 * - classificationProbability is cleared (null) for human classifications per CamTrap DP spec
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} observationID - The observation ID to update
 * @param {Object} updates - The update values
 * @param {string} updates.scientificName - The new scientific name (can be empty for blank)
 * @param {string} [updates.commonName] - Optional common name
 * @param {string} [updates.observationType] - Optional observation type (e.g., 'blank', 'animal')
 * @param {string} [updates.sex] - Sex of the individual ('female', 'male', 'unknown')
 * @param {string} [updates.lifeStage] - Life stage ('adult', 'subadult', 'juvenile')
 * @param {string[]} [updates.behavior] - Array of observed behaviors
 * @returns {Promise<Object>} - The updated observation
 */
export async function updateObservationClassification(dbPath, observationID, updates) {
  const startTime = Date.now()
  log.info(`Updating observation classification: ${observationID}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    // Prepare update values following CamTrap DP specification
    const updateValues = {
      scientificName: updates.scientificName || null,
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString(),
      // Per CamTrap DP spec: "Omit or provide an approximate probability for human classifications"
      // We set to null to indicate this is a human classification without probability
      classificationProbability: null
    }

    // Add optional fields if provided
    if (updates.commonName !== undefined) {
      updateValues.commonName = updates.commonName
    }

    if (updates.observationType !== undefined) {
      updateValues.observationType = updates.observationType
    }

    // Add Camtrap DP observation fields with validation
    if (updates.sex !== undefined) {
      sexSchema.parse(updates.sex)
      updateValues.sex = updates.sex
    }

    if (updates.lifeStage !== undefined) {
      lifeStageSchema.parse(updates.lifeStage)
      updateValues.lifeStage = updates.lifeStage
    }

    if (updates.behavior !== undefined) {
      behaviorSchema.parse(updates.behavior)
      updateValues.behavior = updates.behavior
    }

    // Perform the update
    await db
      .update(observations)
      .set(updateValues)
      .where(eq(observations.observationID, observationID))

    // Fetch and return the updated observation
    const updatedObservation = await db
      .select()
      .from(observations)
      .where(eq(observations.observationID, observationID))
      .get()

    const elapsedTime = Date.now() - startTime
    log.info(
      `Updated observation ${observationID} to "${updates.scientificName || 'blank'}" in ${elapsedTime}ms`
    )
    return updatedObservation
  } catch (error) {
    log.error(`Error updating observation classification: ${error.message}`)
    throw error
  }
}

/**
 * Update an observation's bounding box coordinates.
 * When a human updates the bbox:
 * - Bbox coordinates are updated (bboxX, bboxY, bboxWidth, bboxHeight)
 * - classificationMethod is set to 'human'
 * - classifiedBy is set to 'User'
 * - classificationTimestamp is updated
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} observationID - The observation ID to update
 * @param {Object} bboxUpdates - The new bbox coordinates
 * @param {number} bboxUpdates.bboxX - Left edge (0-1 normalized)
 * @param {number} bboxUpdates.bboxY - Top edge (0-1 normalized)
 * @param {number} bboxUpdates.bboxWidth - Width (0-1 normalized)
 * @param {number} bboxUpdates.bboxHeight - Height (0-1 normalized)
 * @returns {Promise<Object>} - The updated observation
 */
export async function updateObservationBbox(dbPath, observationID, bboxUpdates) {
  const startTime = Date.now()
  log.info(`Updating observation bbox: ${observationID}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    const { bboxX, bboxY, bboxWidth, bboxHeight } = bboxUpdates

    // Validate bbox values are in valid range
    if (
      bboxX < 0 ||
      bboxX > 1 ||
      bboxY < 0 ||
      bboxY > 1 ||
      bboxWidth <= 0 ||
      bboxWidth > 1 ||
      bboxHeight <= 0 ||
      bboxHeight > 1 ||
      bboxX + bboxWidth > 1.001 ||
      bboxY + bboxHeight > 1.001
    ) {
      throw new Error('Invalid bbox coordinates: must be normalized (0-1) and within bounds')
    }

    // Prepare update values
    const updateValues = {
      bboxX,
      bboxY,
      bboxWidth,
      bboxHeight,
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString()
    }

    // Perform the update
    await db
      .update(observations)
      .set(updateValues)
      .where(eq(observations.observationID, observationID))

    // Fetch and return the updated observation
    const updatedObservation = await db
      .select()
      .from(observations)
      .where(eq(observations.observationID, observationID))
      .get()

    const elapsedTime = Date.now() - startTime
    log.info(`Updated observation ${observationID} bbox in ${elapsedTime}ms`)
    return updatedObservation
  } catch (error) {
    log.error(`Error updating observation bbox: ${error.message}`)
    throw error
  }
}

/**
 * Delete an observation from the database.
 * This permanently removes the observation record.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} observationID - The observation ID to delete
 * @returns {Promise<Object>} - Success indicator with deleted observationID
 */
export async function deleteObservation(dbPath, observationID) {
  const startTime = Date.now()
  log.info(`Deleting observation: ${observationID}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    // Delete the observation
    await db.delete(observations).where(eq(observations.observationID, observationID))

    const elapsedTime = Date.now() - startTime
    log.info(`Deleted observation ${observationID} in ${elapsedTime}ms`)
    return { success: true, observationID }
  } catch (error) {
    log.error(`Error deleting observation: ${error.message}`)
    throw error
  }
}

/**
 * Create a new observation with bounding box (human-drawn).
 * Follows CamTrap DP specification for human classifications.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} observationData - The observation data
 * @param {string} observationData.mediaID - Associated media ID
 * @param {string} observationData.deploymentID - Associated deployment ID
 * @param {string} observationData.timestamp - Media timestamp (ISO 8601)
 * @param {string|null} observationData.scientificName - Species (null for unknown)
 * @param {string|null} observationData.commonName - Common name (optional)
 * @param {number} observationData.bboxX - Left edge (0-1 normalized)
 * @param {number} observationData.bboxY - Top edge (0-1 normalized)
 * @param {number} observationData.bboxWidth - Width (0-1 normalized)
 * @param {number} observationData.bboxHeight - Height (0-1 normalized)
 * @param {string} [observationData.sex] - Sex of the individual ('female', 'male', 'unknown')
 * @param {string} [observationData.lifeStage] - Life stage ('adult', 'subadult', 'juvenile')
 * @param {string[]} [observationData.behavior] - Array of observed behaviors
 * @returns {Promise<Object>} - The created observation
 */
export async function createObservation(dbPath, observationData) {
  const startTime = Date.now()
  log.info(`Creating new observation for media: ${observationData.mediaID}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    const {
      mediaID,
      deploymentID,
      timestamp,
      scientificName,
      commonName,
      bboxX,
      bboxY,
      bboxWidth,
      bboxHeight,
      sex,
      lifeStage,
      behavior
    } = observationData

    // Only validate bbox if coordinates are provided (allow null for observations without bbox)
    const hasBbox = bboxX !== null && bboxX !== undefined
    if (hasBbox) {
      if (
        bboxX < 0 ||
        bboxX > 1 ||
        bboxY < 0 ||
        bboxY > 1 ||
        bboxWidth <= 0 ||
        bboxWidth > 1 ||
        bboxHeight <= 0 ||
        bboxHeight > 1 ||
        bboxX + bboxWidth > 1.001 ||
        bboxY + bboxHeight > 1.001
      ) {
        throw new Error('Invalid bbox coordinates: must be normalized (0-1) and within bounds')
      }
    }

    // Validate Camtrap DP observation fields if provided
    if (sex !== undefined) {
      sexSchema.parse(sex)
    }
    if (lifeStage !== undefined) {
      lifeStageSchema.parse(lifeStage)
    }
    if (behavior !== undefined) {
      behaviorSchema.parse(behavior)
    }

    // Generate IDs
    const observationID = crypto.randomUUID()
    const eventID = crypto.randomUUID()

    // Prepare observation data following CamTrap DP specification
    const newObservation = {
      observationID,
      mediaID,
      deploymentID,
      eventID,
      eventStart: timestamp,
      eventEnd: timestamp,
      scientificName: scientificName || null,
      commonName: commonName || null,
      observationType: 'animal',
      classificationProbability: null, // Human classification - no classificationProbability score
      count: 1,
      bboxX: hasBbox ? bboxX : null,
      bboxY: hasBbox ? bboxY : null,
      bboxWidth: hasBbox ? bboxWidth : null,
      bboxHeight: hasBbox ? bboxHeight : null,
      modelOutputID: null, // No model involved
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString(),
      // Camtrap DP observation fields
      sex: sex || null,
      lifeStage: lifeStage || null,
      behavior: behavior || null
    }

    // Insert the observation
    await db.insert(observations).values(newObservation)

    // Fetch and return the created observation
    const createdObservation = await db
      .select()
      .from(observations)
      .where(eq(observations.observationID, observationID))
      .get()

    const elapsedTime = Date.now() - startTime
    log.info(
      `Created observation ${observationID} for species "${scientificName || 'unknown'}" in ${elapsedTime}ms`
    )
    return createdObservation
  } catch (error) {
    log.error(`Error creating observation: ${error.message}`)
    throw error
  }
}

/**
 * Insert observations data into the database
 * @param {Object} manager - Database manager instance
 * @param {Array} observationsData - Array of observation objects
 * @returns {Promise<void>}
 */
export async function insertObservations(manager, observationsData) {
  log.info(`Inserting ${observationsData.length} observations into database`)

  try {
    const db = manager.getDb()

    manager.transaction(() => {
      let count = 0
      for (const observation of observationsData) {
        db.insert(observations)
          .values({
            observationID: observation.observationID,
            mediaID: observation.mediaID,
            deploymentID: observation.deploymentID,
            eventID: observation.eventID,
            eventStart: observation.eventStart ? observation.eventStart.toISO() : null,
            eventEnd: observation.eventEnd ? observation.eventEnd.toISO() : null,
            scientificName: observation.scientificName,
            commonName: observation.commonName,
            classificationProbability:
              observation.classificationProbability !== undefined
                ? observation.classificationProbability
                : null,
            count: observation.count !== undefined ? observation.count : null
          })
          .run()

        count++
        if (count % 1000 === 0) {
          log.info(`Inserted ${count}/${observationsData.length} observations`)
        }
      }
    })

    log.info(`Successfully inserted ${observationsData.length} observations`)
  } catch (error) {
    log.error(`Error inserting observations: ${error.message}`)
    throw error
  }
}
