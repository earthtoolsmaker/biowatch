/**
 * Deployment-related database queries
 */

import { getDrizzleDb } from '../manager.js'
import { deployments, media, observations } from '../models.js'
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  isNotNull,
  ne,
  notExists,
  or,
  sql
} from 'drizzle-orm'
import log from '../../services/logger.js'
import { getStudyIdFromPath } from './utils.js'
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'

/**
 * Get one deployment row per unique (latitude, longitude) — intended for
 * read-only overview maps where "one marker per physical camera-trap
 * location" is the right semantic. Within each coord group, SQLite returns
 * the most-recent-by-deploymentStart row thanks to the subquery's ORDER BY.
 *
 * Contrast with getAllDeployments(), which returns every deployment row and
 * is what editable/draggable maps need so MarkerClusterGroup can correctly
 * count co-located deployments.
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - One row per unique deployment location
 */
export async function getDeploymentLocations(dbPath) {
  const startTime = Date.now()
  log.info(`Querying deployments from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    // Create subquery with ORDER BY to get deployments sorted by locationID and deploymentStart DESC
    const subquery = db
      .select({
        locationName: deployments.locationName,
        locationID: deployments.locationID,
        deploymentID: deployments.deploymentID,
        deploymentStart: deployments.deploymentStart,
        deploymentEnd: deployments.deploymentEnd,
        longitude: deployments.longitude,
        latitude: deployments.latitude
      })
      .from(deployments)
      .orderBy(deployments.locationID, desc(deployments.deploymentStart))
      .as('subquery')

    // Select distinct with GROUP BY to get one deployment per location
    // SQLite returns the first row in each group based on the subquery's ORDER BY
    const result = await db
      .selectDistinct({
        locationID: subquery.locationID,
        locationName: subquery.locationName,
        deploymentID: subquery.deploymentID,
        deploymentStart: subquery.deploymentStart,
        deploymentEnd: subquery.deploymentEnd,
        longitude: subquery.longitude,
        latitude: subquery.latitude
      })
      .from(subquery)
      .groupBy(subquery.latitude, subquery.longitude)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved distinct deployments: ${result.length} unique coordinates found in ${elapsedTime}ms`
    )

    return result
  } catch (error) {
    log.error(`Error querying deployments: ${error.message}`)
    throw error
  }
}

/**
 * Lightweight per-media projection for the Media tab's deployment composition.
 * One row per media, with `isDetection` (1/0) flagging whether it carries a real
 * observation (a named species or a vehicle). The sequence grouping + blank/
 * detection tally happens in the deploymentComposition service so it matches the
 * table's sequence units exactly. Includes the fields the grouping needs
 * (timestamp/eventID/deploymentID) plus fileMediatype/fileName.
 * @param {string} dbPath - Path to the SQLite database
 */
export async function getMediaForDeploymentComposition(dbPath) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
  // Match the table's grouping input exactly: eventID is picked from one of the
  // media's observations (NULL for blanks, which therefore only ever group by
  // timestamp), not from the unused media.eventID column.
  const eventIDPicker = db
    .select({ value: observations.eventID })
    .from(observations)
    .where(eq(observations.mediaID, media.mediaID))
    .orderBy(observations.observationID)
    .limit(1)
  // Correlated "has a real observation" subquery, built with the query builder
  // so the o.mediaID = media.mediaID correlation is emitted correctly (a raw
  // string interpolation drops the table qualifier and matches every media).
  const realObservation = db
    .select({ one: sql`1` })
    .from(observations)
    .where(
      and(
        eq(observations.mediaID, media.mediaID),
        or(
          and(isNotNull(observations.scientificName), ne(observations.scientificName, '')),
          eq(observations.observationType, 'vehicle')
        )
      )
    )
  return (
    db
      .select({
        mediaID: media.mediaID,
        deploymentID: media.deploymentID,
        timestamp: media.timestamp,
        eventID: sql`(${eventIDPicker})`.as('eventID'),
        fileMediatype: media.fileMediatype,
        fileName: media.fileName,
        isDetection: sql`(CASE WHEN ${exists(realObservation)} THEN 1 ELSE 0 END)`.as('isDetection')
      })
      .from(media)
      // Ordered by timestamp so the downstream sequence grouping clusters
      // correctly — groupMediaIntoSequences walks media in order, exactly like
      // getMediaForSequencePagination feeds it. Unsorted input barely groups.
      .orderBy(media.timestamp)
      .all()
  )
}

/**
 * Deployment id + display name + coordinates, for joining onto the aggregated
 * per-deployment counts. Includes deployments with zero media.
 * @param {string} dbPath - Path to the SQLite database
 */
export async function getDeploymentsBasic(dbPath) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
  return db
    .select({
      deploymentID: deployments.deploymentID,
      locationName: deployments.locationName,
      locationID: deployments.locationID,
      latitude: deployments.latitude,
      longitude: deployments.longitude
    })
    .from(deployments)
    .all()
}

/**
 * Get every deployment with its coordinates and identifying fields, no dedup,
 * no observations join. Intended for the Deployments tab map so each
 * deployment has its own marker and MarkerClusterGroup can correctly count
 * co-located deployments.
 *
 * Contrast with getDeploymentLocations(), which dedupes by (latitude, longitude)
 * and returns one row per unique coord — right for read-only overview maps,
 * wrong here because dragging the single "representative" marker silently
 * splits a co-located group.
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Every deployment with minimal fields
 */
export async function getAllDeployments(dbPath) {
  const startTime = Date.now()
  log.info(`Querying all deployments from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    const result = await db
      .select({
        deploymentID: deployments.deploymentID,
        locationID: deployments.locationID,
        locationName: deployments.locationName,
        latitude: deployments.latitude,
        longitude: deployments.longitude,
        deploymentStart: deployments.deploymentStart,
        deploymentEnd: deployments.deploymentEnd,
        cameraID: deployments.cameraID,
        cameraModel: deployments.cameraModel
      })
      .from(deployments)

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved ${result.length} deployments in ${elapsedTime}ms`)
    return result
  } catch (error) {
    log.error(`Error querying all deployments: ${error.message}`)
    throw error
  }
}

/**
 * Distinct species observed at a single deployment, with media counts.
 * Used by the species-filter popover in the Deployments tab so the picker
 * only shows species actually present at the selected deployment.
 *
 * Not sequence-aware (counts are media, not sequences) — the popover only
 * needs the species set; exact counts are a nice-to-have.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} deploymentID
 * @returns {Promise<Array<{scientificName: string, count: number}>>}
 */
export async function getSpeciesForDeployment(dbPath, deploymentID) {
  const startTime = Date.now()
  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    const rows = await db
      .select({
        scientificName: observations.scientificName,
        count: sql`COUNT(DISTINCT ${observations.mediaID})`.as('count')
      })
      .from(observations)
      .where(
        sql`${observations.deploymentID} = ${deploymentID} AND ${observations.scientificName} IS NOT NULL AND ${observations.scientificName} != ''`
      )
      .groupBy(observations.scientificName)
      .orderBy(desc(sql`count`))

    const speciesRows = rows.map((r) => ({
      scientificName: r.scientificName,
      count: Number(r.count)
    }))

    const [blankCount, vehicleCount] = await Promise.all([
      getBlankMediaCountForDeployment(dbPath, deploymentID),
      getVehicleMediaCountForDeployment(dbPath, deploymentID)
    ])

    const result = [...speciesRows]
    if (blankCount > 0) {
      result.push({ scientificName: BLANK_SENTINEL, count: blankCount })
    }
    if (vehicleCount > 0) {
      result.push({ scientificName: VEHICLE_SENTINEL, count: vehicleCount })
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved ${result.length} species for deployment ${deploymentID} in ${elapsedTime}ms`
    )
    return result
  } catch (error) {
    log.error(`Error querying species for deployment: ${error.message}`)
    throw error
  }
}

/**
 * Count blank media at a single deployment, using the new "blank media"
 * definition (no animal/human observation with a species name AND no
 * vehicle observation). Mirrors getBlankMediaCount but scoped to one
 * deployment.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} deploymentID
 * @returns {Promise<number>}
 */
export async function getBlankMediaCountForDeployment(dbPath, deploymentID) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

  const realObservations = db
    .select({ one: sql`1` })
    .from(observations)
    .where(
      and(
        eq(observations.mediaID, media.mediaID),
        or(
          and(isNotNull(observations.scientificName), ne(observations.scientificName, '')),
          eq(observations.observationType, 'vehicle')
        )
      )
    )

  const result = await db
    .select({ count: count().as('count') })
    .from(media)
    .where(and(eq(media.deploymentID, deploymentID), notExists(realObservations)))
    .get()

  return Number(result?.count || 0)
}

/**
 * Count media with at least one vehicle observation at a single deployment.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} deploymentID
 * @returns {Promise<number>}
 */
export async function getVehicleMediaCountForDeployment(dbPath, deploymentID) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

  const result = await db
    .select({ count: countDistinct(observations.mediaID).as('count') })
    .from(observations)
    .where(
      and(eq(observations.deploymentID, deploymentID), eq(observations.observationType, 'vehicle'))
    )
    .get()

  return Number(result?.count || 0)
}

/**
 * Total media count at a single deployment.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} deploymentID
 * @returns {Promise<number>}
 */
export async function getMediaCountForDeployment(dbPath, deploymentID) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

  const result = await db
    .select({ count: count().as('count') })
    .from(media)
    .where(eq(media.deploymentID, deploymentID))
    .get()

  return Number(result?.count || 0)
}

/**
 * Total observation count at a single deployment (including blanks).
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} deploymentID
 * @returns {Promise<number>}
 */
export async function getObservationCountForDeployment(dbPath, deploymentID) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

  const result = await db
    .select({ count: count().as('count') })
    .from(observations)
    .where(eq(observations.deploymentID, deploymentID))
    .get()

  return Number(result?.count || 0)
}

/**
 * Get activity data (observation counts) per location over time periods
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Object>} - Activity data with periods and counts per location
 */
export async function getLocationsActivity(dbPath) {
  const startTime = Date.now()
  log.info(`Querying location activity from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    // First get the total date range to calculate period size
    const dateRange = await db
      .select({
        minDate: sql`MIN(${deployments.deploymentStart})`.as('minDate'),
        maxDate: sql`MAX(${deployments.deploymentEnd})`.as('maxDate')
      })
      .from(deployments)
      .get()

    if (!dateRange) {
      throw new Error('No deployment date range found')
    }

    // Get all locations
    const locations = await db
      .selectDistinct({
        locationID: deployments.locationID,
        locationName: deployments.locationName,
        longitude: deployments.longitude,
        latitude: deployments.latitude
      })
      .from(deployments)

    // Get all observations with their location IDs and event start times
    const observationData = await db
      .select({
        locationID: deployments.locationID,
        eventID: observations.eventID,
        eventStart: observations.eventStart
      })
      .from(observations)
      .innerJoin(deployments, eq(observations.deploymentID, deployments.deploymentID))

    // Process the data in JavaScript
    const minDate = new Date(dateRange.minDate)
    const maxDate = new Date(dateRange.maxDate)
    const totalDays = (maxDate - minDate) / (1000 * 60 * 60 * 24)
    const periodDays = Math.ceil(totalDays / 20)

    // Generate periods
    const periods = []
    let currentStart = new Date(minDate)

    while (currentStart < maxDate) {
      const periodEnd = new Date(currentStart)
      periodEnd.setDate(periodEnd.getDate() + periodDays)

      periods.push({
        start: currentStart.toISOString(),
        end: periodEnd.toISOString()
      })

      currentStart = new Date(periodEnd)
    }

    // Create location map
    const locationMap = new Map()
    locations.forEach((location) => {
      locationMap.set(location.locationID, {
        locationID: location.locationID,
        locationName: location.locationName,
        longitude: location.longitude,
        latitude: location.latitude,
        periods: periods.map((period) => ({
          start: period.start,
          end: period.end,
          count: 0
        }))
      })
    })

    // Count observations per location per period
    const allCounts = []

    observationData.forEach((obs) => {
      const location = locationMap.get(obs.locationID)
      if (!location) return

      const obsDate = new Date(obs.eventStart)

      for (let i = 0; i < periods.length; i++) {
        const periodStart = new Date(periods[i].start)
        const periodEnd = new Date(periods[i].end)

        if (obsDate >= periodStart && obsDate < periodEnd) {
          location.periods[i].count++
          break
        }
      }
    })

    // Collect all non-zero counts for percentile calculation
    locationMap.forEach((location) => {
      location.periods.forEach((period) => {
        if (period.count > 0) {
          allCounts.push(period.count)
        }
      })
    })

    // Sort counts for percentile calculations
    allCounts.sort((a, b) => a - b)

    // Calculate 95th percentile of period counts
    const percentile95Index = Math.floor(allCounts.length * 0.95)
    const percentile90Count = allCounts[percentile95Index] || 1

    const result = {
      startDate: dateRange.minDate,
      endDate: dateRange.maxDate,
      percentile90Count,
      locations: Array.from(locationMap.values())
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved location activity data for ${result.locations.length} locations in ${elapsedTime}ms`
    )
    return result
  } catch (error) {
    log.error(`Error querying location activity: ${error.message}`)
    throw error
  }
}

/**
 * Insert deployment data into the database
 * @param {Object} manager - Database manager instance
 * @param {Array} deploymentsData - Array of deployment objects
 * @returns {Promise<void>}
 */
export async function insertDeployments(manager, deploymentsData) {
  log.info(`Inserting ${Object.keys(deploymentsData).length} deployments into database`)

  try {
    const db = manager.getDb()

    manager.transaction(() => {
      for (const depKey of Object.keys(deploymentsData)) {
        const dep = deploymentsData[depKey]
        db.insert(deployments)
          .values({
            deploymentID: dep.deploymentID,
            locationID: dep.locationID,
            locationName: dep.locationName,
            deploymentStart: dep.deploymentStart ? dep.deploymentStart.toISO() : null,
            deploymentEnd: dep.deploymentEnd ? dep.deploymentEnd.toISO() : null,
            latitude: dep.latitude,
            longitude: dep.longitude
          })
          .run()
      }
    })

    log.info(`Successfully inserted ${Object.keys(deploymentsData).length} deployments`)
  } catch (error) {
    log.error(`Error inserting deployments: ${error.message}`)
    throw error
  }
}

/**
 * Get activity data (observation counts) per deployment over time periods
 * Uses SQL-level aggregation for performance with large datasets
 * @param {string} dbPath - Path to the SQLite database
 * @param {number} [periodCount=20] - Number of time-period buckets to aggregate into
 * @returns {Promise<Object>} - Activity data with periods and counts per deployment
 */
export async function getDeploymentsActivity(dbPath, periodCount) {
  const startTime = Date.now()
  // Robust against null/0/NaN from the IPC boundary — JS default params only
  // fire on undefined, but the renderer can legitimately send null before the
  // timeline width is measured. Also clamped to a sane upper bound: each extra
  // bucket adds a SUM(CASE) expression to a single GROUP BY scan, so an
  // ultra-wide / multi-monitor renderer asking for hundreds of buckets would
  // make the worker query proportionally slower on large studies.
  const requested = typeof periodCount === 'number' && periodCount > 0 ? periodCount : 20
  const buckets = Math.min(requested, 100)
  log.info(`Querying deployment activity from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    // First get the total date range to calculate period size
    const dateRange = await db
      .select({
        minDate: sql`MIN(${deployments.deploymentStart})`.as('minDate'),
        maxDate: sql`MAX(${deployments.deploymentEnd})`.as('maxDate')
      })
      .from(deployments)
      .get()

    if (!dateRange || !dateRange.minDate || !dateRange.maxDate) {
      // No-timestamps case: dataset has deployments but no datetimes (e.g.
      // LILA Biome Health, where COCO images carry only `location`, not
      // `datetime`). The list still wants every deployment with a total
      // observation count; the renderer hides the timeline UI based on
      // hasTimestamps. Without this branch the page short-circuits to
      // "No deployments found" even though the deployments table is full.
      const rows = await db
        .select({
          deploymentID: deployments.deploymentID,
          locationName: deployments.locationName,
          locationID: deployments.locationID,
          deploymentStart: deployments.deploymentStart,
          deploymentEnd: deployments.deploymentEnd,
          latitude: deployments.latitude,
          longitude: deployments.longitude,
          totalCount: count(observations.observationID).as('totalCount')
        })
        .from(deployments)
        .leftJoin(observations, eq(deployments.deploymentID, observations.deploymentID))
        .groupBy(deployments.deploymentID)

      return {
        startDate: null,
        endDate: null,
        percentile90Count: 1,
        hasTimestamps: false,
        deployments: rows.map((row) => ({
          deploymentID: row.deploymentID,
          locationName: row.locationName,
          locationID: row.locationID,
          deploymentStart: row.deploymentStart,
          deploymentEnd: row.deploymentEnd,
          latitude: row.latitude,
          longitude: row.longitude,
          periods: [],
          totalCount: Number(row.totalCount || 0)
        }))
      }
    }

    // Calculate period boundaries
    const minDate = new Date(dateRange.minDate)
    const maxDate = new Date(dateRange.maxDate)
    const totalDays = (maxDate - minDate) / (1000 * 60 * 60 * 24)
    const periodDays = Math.max(1, Math.ceil(totalDays / buckets))

    // Generate periods
    const periods = []
    let currentStart = new Date(minDate)

    while (currentStart < maxDate) {
      const periodEnd = new Date(currentStart)
      periodEnd.setDate(periodEnd.getDate() + periodDays)

      periods.push({
        start: currentStart.toISOString(),
        end: periodEnd.toISOString()
      })

      currentStart = new Date(periodEnd)
    }

    // Build SQL CASE expressions for each period
    // This aggregates observation counts at the database level
    const periodCases = periods.map((period, i) =>
      sql`SUM(CASE WHEN ${observations.eventStart} >= ${period.start} AND ${observations.eventStart} < ${period.end} THEN 1 ELSE 0 END)`.as(
        `period_${i}`
      )
    )

    // Single aggregated query: join deployments with observations and count per period
    const aggregatedData = await db
      .select({
        deploymentID: deployments.deploymentID,
        locationName: deployments.locationName,
        locationID: deployments.locationID,
        deploymentStart: deployments.deploymentStart,
        deploymentEnd: deployments.deploymentEnd,
        latitude: deployments.latitude,
        longitude: deployments.longitude,
        ...Object.fromEntries(periodCases.map((c, i) => [`period_${i}`, c]))
      })
      .from(deployments)
      .leftJoin(observations, eq(deployments.deploymentID, observations.deploymentID))
      .groupBy(deployments.deploymentID)

    // Transform aggregated data to expected format
    const allCounts = []
    const deploymentsResult = aggregatedData.map((row) => {
      let totalCount = 0
      const deploymentPeriods = periods.map((period, i) => {
        const count = row[`period_${i}`] || 0
        totalCount += count
        if (count > 0) {
          allCounts.push(count)
        }
        return {
          start: period.start,
          end: period.end,
          count
        }
      })

      return {
        deploymentID: row.deploymentID,
        locationName: row.locationName,
        locationID: row.locationID,
        deploymentStart: row.deploymentStart,
        deploymentEnd: row.deploymentEnd,
        latitude: row.latitude,
        longitude: row.longitude,
        periods: deploymentPeriods,
        totalCount
      }
    })

    // Sort counts for percentile calculation
    allCounts.sort((a, b) => a - b)

    // Calculate 95th percentile of period counts
    const percentile95Index = Math.floor(allCounts.length * 0.95)
    const percentile90Count = allCounts[percentile95Index] || 1

    const result = {
      startDate: dateRange.minDate,
      endDate: dateRange.maxDate,
      percentile90Count,
      hasTimestamps: true,
      deployments: deploymentsResult
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved deployment activity data for ${result.deployments.length} deployments in ${elapsedTime}ms`
    )
    return result
  } catch (error) {
    log.error(`Error querying deployment activity: ${error.message}`)
    throw error
  }
}
