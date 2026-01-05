/**
 * Deployment-related database queries
 */

import { getDrizzleDb, deployments, observations } from '../index.js'
import { eq, desc, sql } from 'drizzle-orm'
import log from 'electron-log'
import { getStudyIdFromPath } from './utils.js'

/**
 * Get deployment information from the database using Drizzle ORM
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Deployment data with one row per location
 */
export async function getDeployments(dbPath) {
  const startTime = Date.now()
  log.info(`Querying deployments from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

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
 * Get activity data (observation counts) per location over time periods
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Object>} - Activity data with periods and counts per location
 */
export async function getLocationsActivity(dbPath) {
  const startTime = Date.now()
  log.info(`Querying location activity from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

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
 * @returns {Promise<Object>} - Activity data with periods and counts per deployment
 */
export async function getDeploymentsActivity(dbPath) {
  const startTime = Date.now()
  log.info(`Querying deployment activity from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    // First get the total date range to calculate period size
    const dateRange = await db
      .select({
        minDate: sql`MIN(${deployments.deploymentStart})`.as('minDate'),
        maxDate: sql`MAX(${deployments.deploymentEnd})`.as('maxDate')
      })
      .from(deployments)
      .get()

    if (!dateRange || !dateRange.minDate || !dateRange.maxDate) {
      // Return empty result if no deployments
      return {
        startDate: null,
        endDate: null,
        percentile90Count: 1,
        deployments: []
      }
    }

    // Calculate period boundaries
    const minDate = new Date(dateRange.minDate)
    const maxDate = new Date(dateRange.maxDate)
    const totalDays = (maxDate - minDate) / (1000 * 60 * 60 * 24)
    const periodDays = Math.max(1, Math.ceil(totalDays / 20))

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
      const deploymentPeriods = periods.map((period, i) => {
        const count = row[`period_${i}`] || 0
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
        periods: deploymentPeriods
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
