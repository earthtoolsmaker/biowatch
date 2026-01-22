/**
 * Species-related database queries
 */

import { getDrizzleDb, deployments, media, observations } from '../index.js'
import {
  eq,
  and,
  desc,
  count,
  sql,
  isNotNull,
  ne,
  inArray,
  gte,
  lte,
  isNull,
  or,
  notExists
} from 'drizzle-orm'
import log from 'electron-log'
import { getStudyIdFromPath } from './utils.js'
import { BLANK_SENTINEL } from '../../../shared/constants.js'

/**
 * Get species distribution from the database using Drizzle ORM
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Species distribution data
 */
export async function getSpeciesDistribution(dbPath) {
  const startTime = Date.now()
  log.info(`Querying species distribution from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    const result = await db
      .select({
        scientificName: observations.scientificName,
        count: count(observations.observationID).as('count')
      })
      .from(observations)
      .where(
        and(
          isNotNull(observations.scientificName),
          ne(observations.scientificName, ''),
          sql`(${observations.observationType} IS NULL OR ${observations.observationType} != 'blank')`
        )
      )
      .groupBy(observations.scientificName)
      .orderBy(desc(count(observations.observationID)))

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved species distribution: ${result.length} species found in ${elapsedTime}ms`)

    return result
  } catch (error) {
    log.error(`Error querying species distribution: ${error.message}`)
    throw error
  }
}

/**
 * Get count of blank media (media with no observations) from the database
 * Counts media with no linked observations via mediaID foreign key.
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<number>} - Count of media files with no observations
 */
export async function getBlankMediaCount(dbPath) {
  const startTime = Date.now()
  log.info(`Querying blank media count from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    // Count media with no linked observations
    const matchingObservations = db
      .select({ one: sql`1` })
      .from(observations)
      .where(eq(observations.mediaID, media.mediaID))

    const result = await db
      .select({ count: count().as('count') })
      .from(media)
      .where(notExists(matchingObservations))
      .get()

    const blankCount = result?.count || 0
    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved blank media count: ${blankCount} in ${elapsedTime}ms`)

    return blankCount
  } catch (error) {
    log.error(`Error querying blank media count: ${error.message}`)
    throw error
  }
}

/**
 * Get species distribution data grouped by media for sequence-aware counting.
 * Returns one row per (species, media) combination with the count of observations.
 * Used by the frontend to calculate sequence-aware species counts by:
 * 1. Grouping media into sequences based on timestamp proximity
 * 2. Taking the MAX count of each species within each sequence
 * 3. Summing the max counts across all sequences
 *
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, count }
 */
export async function getSpeciesDistributionByMedia(dbPath) {
  const startTime = Date.now()
  log.info(`Querying species distribution by media from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    const result = await db
      .select({
        scientificName: observations.scientificName,
        mediaID: media.mediaID,
        timestamp: media.timestamp,
        deploymentID: media.deploymentID,
        eventID: observations.eventID,
        fileMediatype: media.fileMediatype,
        count: count(observations.observationID).as('count')
      })
      .from(observations)
      .innerJoin(media, eq(observations.mediaID, media.mediaID))
      .where(
        and(
          isNotNull(observations.scientificName),
          ne(observations.scientificName, ''),
          sql`(${observations.observationType} IS NULL OR ${observations.observationType} != 'blank')`
        )
      )
      .groupBy(observations.scientificName, media.mediaID)
      .orderBy(media.timestamp)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved species distribution by media: ${result.length} species-media combinations in ${elapsedTime}ms`
    )

    return result
  } catch (error) {
    log.error(`Error querying species distribution by media: ${error.message}`)
    throw error
  }
}

/**
 * Get species timeseries data by media for sequence-aware counting.
 * Returns observations with media-level detail for frontend sequence grouping.
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} speciesNames - List of scientific names to include
 * @returns {Promise<Array>} - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, weekStart, count }
 */
export async function getSpeciesTimeseriesByMedia(dbPath, speciesNames = []) {
  const startTime = Date.now()
  log.info(`Querying species timeseries by media from: ${dbPath}`)

  const requestingBlanks = speciesNames.includes(BLANK_SENTINEL)
  const regularSpecies = speciesNames.filter((s) => s !== BLANK_SENTINEL)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    const shouldRunSpeciesQuery = regularSpecies.length > 0 || !requestingBlanks

    let results = []

    if (shouldRunSpeciesQuery) {
      // Build species filter condition
      const speciesCondition =
        regularSpecies.length > 0
          ? inArray(observations.scientificName, regularSpecies)
          : isNotNull(observations.scientificName)

      // Week start calculation using SQLite date functions
      const weekStartColumn =
        sql`date(substr(${media.timestamp}, 1, 10), 'weekday 0', '-7 days')`.as('weekStart')

      results = await db
        .select({
          scientificName: observations.scientificName,
          mediaID: media.mediaID,
          timestamp: media.timestamp,
          deploymentID: media.deploymentID,
          eventID: observations.eventID,
          fileMediatype: media.fileMediatype,
          weekStart: weekStartColumn,
          count: count(observations.observationID).as('count')
        })
        .from(observations)
        .innerJoin(media, eq(observations.mediaID, media.mediaID))
        .where(
          and(
            isNotNull(observations.scientificName),
            ne(observations.scientificName, ''),
            or(isNull(observations.observationType), ne(observations.observationType, 'blank')),
            speciesCondition
          )
        )
        .groupBy(observations.scientificName, media.mediaID)
        .orderBy(media.timestamp)
    }

    // Handle blanks if requested
    if (requestingBlanks) {
      const weekStartColumn =
        sql`date(substr(${media.timestamp}, 1, 10), 'weekday 0', '-7 days')`.as('weekStart')

      // Correlated subquery for blank detection
      const matchingObservations = db
        .select({ one: sql`1` })
        .from(observations)
        .where(eq(observations.mediaID, media.mediaID))

      const blankResults = await db
        .select({
          scientificName: sql`${BLANK_SENTINEL}`.as('scientificName'),
          mediaID: media.mediaID,
          timestamp: media.timestamp,
          deploymentID: media.deploymentID,
          eventID: sql`NULL`.as('eventID'),
          fileMediatype: media.fileMediatype,
          weekStart: weekStartColumn,
          count: sql`1`.as('count')
        })
        .from(media)
        .where(and(isNotNull(media.timestamp), notExists(matchingObservations)))
        .orderBy(media.timestamp)

      results = [...results, ...blankResults]
    }

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved species timeseries by media: ${results.length} rows in ${elapsedTime}ms`)

    return results
  } catch (error) {
    log.error(`Error querying species timeseries by media: ${error.message}`)
    throw error
  }
}

/**
 * Get species heatmap data by media for sequence-aware counting.
 * Returns observations with media-level detail for frontend sequence grouping.
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} species - List of scientific names to include
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @param {number} startHour - Starting hour of day (0-24)
 * @param {number} endHour - Ending hour of day (0-24)
 * @param {boolean} includeNullTimestamps - Whether to include observations with null timestamps
 * @returns {Promise<Array>} - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, latitude, longitude, locationName, count }
 */
export async function getSpeciesHeatmapDataByMedia(
  dbPath,
  species,
  startDate,
  endDate,
  startHour = 0,
  endHour = 24,
  includeNullTimestamps = false
) {
  const startTime = Date.now()
  log.info(`Querying species heatmap data by media from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    // Build base conditions
    const baseConditions = [
      inArray(observations.scientificName, species),
      isNotNull(deployments.latitude),
      isNotNull(deployments.longitude)
    ]

    // Add date range filter with null timestamp support
    // Skip date filtering entirely if includeNullTimestamps=true and no dates provided
    if (includeNullTimestamps && (!startDate || !endDate)) {
      // No date filtering - include all records regardless of timestamp
    } else if (includeNullTimestamps) {
      baseConditions.push(
        or(
          isNull(media.timestamp),
          and(gte(media.timestamp, startDate), lte(media.timestamp, endDate))
        )
      )
    } else {
      baseConditions.push(gte(media.timestamp, startDate))
      baseConditions.push(lte(media.timestamp, endDate))
    }

    // Add time-of-day condition using sql template for SQLite strftime
    // When includeNullTimestamps=true, also allow null timestamps through
    const hourColumn = sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER)`
    if (startHour < endHour) {
      // Simple range (e.g., 8:00 to 17:00)
      const timeCondition = and(sql`${hourColumn} >= ${startHour}`, sql`${hourColumn} < ${endHour}`)
      baseConditions.push(
        includeNullTimestamps ? or(isNull(media.timestamp), timeCondition) : timeCondition
      )
    } else if (startHour > endHour) {
      // Wrapping range (e.g., 22:00 to 6:00)
      const timeCondition = or(sql`${hourColumn} >= ${startHour}`, sql`${hourColumn} < ${endHour}`)
      baseConditions.push(
        includeNullTimestamps ? or(isNull(media.timestamp), timeCondition) : timeCondition
      )
    }
    // If startHour equals endHour, we include all hours (full day)

    const results = await db
      .select({
        scientificName: observations.scientificName,
        mediaID: media.mediaID,
        timestamp: media.timestamp,
        deploymentID: media.deploymentID,
        eventID: observations.eventID,
        fileMediatype: media.fileMediatype,
        latitude: deployments.latitude,
        longitude: deployments.longitude,
        locationName: deployments.locationName,
        count: count(observations.observationID).as('count')
      })
      .from(observations)
      .innerJoin(media, eq(observations.mediaID, media.mediaID))
      .innerJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
      .where(and(...baseConditions))
      .groupBy(observations.scientificName, media.mediaID)
      .orderBy(media.timestamp)

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved species heatmap data by media: ${results.length} rows in ${elapsedTime}ms`)

    return results
  } catch (error) {
    log.error(`Error querying species heatmap data by media: ${error.message}`)
    throw error
  }
}

/**
 * Get species daily activity data by media for sequence-aware counting.
 * Returns observations with media-level detail for frontend sequence grouping.
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} species - List of scientific names to include
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @returns {Promise<Array>} - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, hour, count }
 */
export async function getSpeciesDailyActivityByMedia(dbPath, species, startDate, endDate) {
  const startTime = Date.now()
  log.info(`Querying species daily activity by media from: ${dbPath}`)

  const requestingBlanks = species.includes(BLANK_SENTINEL)
  const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    let results = []

    // Hour extraction using SQLite strftime
    const hourColumn = sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER)`.as('hour')

    if (regularSpecies.length > 0) {
      results = await db
        .select({
          scientificName: observations.scientificName,
          mediaID: media.mediaID,
          timestamp: media.timestamp,
          deploymentID: media.deploymentID,
          eventID: observations.eventID,
          fileMediatype: media.fileMediatype,
          hour: hourColumn,
          count: count(observations.observationID).as('count')
        })
        .from(observations)
        .innerJoin(media, eq(observations.mediaID, media.mediaID))
        .where(
          and(
            inArray(observations.scientificName, regularSpecies),
            gte(media.timestamp, startDate),
            lte(media.timestamp, endDate)
          )
        )
        .groupBy(observations.scientificName, media.mediaID)
        .orderBy(media.timestamp)
    }

    // Handle blanks if requested
    if (requestingBlanks) {
      // Correlated subquery for blank detection
      const matchingObservations = db
        .select({ one: sql`1` })
        .from(observations)
        .where(eq(observations.mediaID, media.mediaID))

      const blankResults = await db
        .select({
          scientificName: sql`${BLANK_SENTINEL}`.as('scientificName'),
          mediaID: media.mediaID,
          timestamp: media.timestamp,
          deploymentID: media.deploymentID,
          eventID: sql`NULL`.as('eventID'),
          fileMediatype: media.fileMediatype,
          hour: hourColumn,
          count: sql`1`.as('count')
        })
        .from(media)
        .where(
          and(
            isNotNull(media.timestamp),
            gte(media.timestamp, startDate),
            lte(media.timestamp, endDate),
            notExists(matchingObservations)
          )
        )
        .orderBy(media.timestamp)

      results = [...results, ...blankResults]
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved species daily activity by media: ${results.length} rows in ${elapsedTime}ms`
    )

    return results
  } catch (error) {
    log.error(`Error querying species daily activity by media: ${error.message}`)
    throw error
  }
}

/**
 * Get all distinct species names from the observations table
 * Used to populate dropdowns for species selection
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Array of distinct species with scientificName and commonName
 */
export async function getDistinctSpecies(dbPath) {
  const startTime = Date.now()
  log.info(`Querying distinct species from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    const rows = await db
      .select({
        scientificName: observations.scientificName,
        commonName: observations.commonName,
        observationCount: count(observations.observationID).as('observationCount')
      })
      .from(observations)
      .where(and(isNotNull(observations.scientificName), ne(observations.scientificName, '')))
      .groupBy(observations.scientificName)
      .orderBy(desc(count(observations.observationID)), observations.scientificName)

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved ${rows.length} distinct species in ${elapsedTime}ms`)
    return rows
  } catch (error) {
    log.error(`Error querying distinct species: ${error.message}`)
    throw error
  }
}
