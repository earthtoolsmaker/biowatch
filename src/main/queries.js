import sqlite3 from 'sqlite3'
import log from 'electron-log'

/**
 * Get species distribution from the database
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} bounds - Map bounds for filtering (optional)
 * @param {number} bounds.north - Northern boundary
 * @param {number} bounds.south - Southern boundary
 * @param {number} bounds.east - Eastern boundary
 * @param {number} bounds.west - Western boundary
 * @returns {Promise<Array>} - Species distribution data
 */
export async function getSpeciesDistribution(dbPath, bounds) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    log.info(`Querying species distribution from: ${dbPath}`)
    if (bounds) {
      log.info(
        `Filtering by bounds: N=${bounds.north}, S=${bounds.south}, E=${bounds.east}, W=${bounds.west}`
      )
    }

    // Open the database
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      // Build bounds filter if provided
      let boundsFilter = ''
      const queryParams = []

      if (bounds) {
        boundsFilter = `
          AND d.latitude IS NOT NULL
          AND d.longitude IS NOT NULL
          AND d.latitude <= ? AND d.latitude >= ?
          AND d.longitude <= ? AND d.longitude >= ?
        `
        queryParams.push(bounds.north, bounds.south, bounds.east, bounds.west)
      }

      // Query to count occurrences by species
      const query = `
        SELECT
          o.scientificName,
          COUNT(*) as count
        FROM observations o
        JOIN deployments d ON o.deploymentID = d.deploymentID
        WHERE o.scientificName IS NOT NULL AND o.scientificName != ''
        AND (o.observationType IS NULL OR o.observationType != 'blank')
        ${boundsFilter}
        GROUP BY o.scientificName
        ORDER BY count DESC
      `

      db.all(query, queryParams, (err, rows) => {
        // Close the database
        db.close()

        if (err) {
          log.error(`Error querying database: ${err.message}`)
          return reject(err)
        }

        const elapsedTime = Date.now() - startTime
        log.info(`Retrieved species distribution: ${rows.length} species found in ${elapsedTime}ms`)
        resolve(rows)
      })
    })
  })
}

/**
 * Get deployment information from the database
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Deployment data with one row per location
 */
export async function getDeployments(dbPath) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    log.info(`Querying deployments from: ${dbPath}`)

    // Open the database
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      // Query to get distinct deployments by locationID
      // This will return the first (most recent) deployment for each location
      const query = `
        SELECT DISTINCT
          locationID,
          locationName,
          deploymentID,
          deploymentStart,
          deploymentEnd,
          longitude,
          latitude
        FROM (
          SELECT
            locationName,
            locationID,
            deploymentID,
            deploymentStart,
            deploymentEnd,
            longitude,
            latitude
          FROM deployments
          ORDER BY locationID, deploymentStart DESC
        )
        GROUP BY locationID
      `

      db.all(query, [], (err, rows) => {
        // Close the database
        db.close()

        if (err) {
          log.error(`Error querying deployments: ${err.message}`)
          return reject(err)
        }

        const elapsedTime = Date.now() - startTime
        log.info(
          `Retrieved distinct deployments: ${rows.length} locations found in ${elapsedTime}ms`
        )
        resolve(rows)
      })
    })
  })
}

/**
 * Get activity data (observation counts) per location over time periods
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Object>} - Activity data with periods and counts per location
 */
export async function getLocationsActivity(dbPath) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    log.info(`Querying location activity from: ${dbPath}`)

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      // First get the total date range to calculate period size
      const dateRangeQuery = `
        SELECT
          MIN(deploymentStart) as minDate,
          MAX(deploymentEnd) as maxDate
        FROM deployments
      `

      db.get(dateRangeQuery, [], (err, dateRange) => {
        if (err) {
          db.close()
          log.error(`Error getting date range: ${err.message}`)
          return reject(err)
        }

        // Get all locations
        const locationsQuery = `
          SELECT DISTINCT
            locationID,
            locationName,
            longitude,
            latitude
          FROM deployments
        `

        db.all(locationsQuery, [], (err, locations) => {
          if (err) {
            db.close()
            log.error(`Error querying locations: ${err.message}`)
            return reject(err)
          }

          // Get all observations with their location IDs and event start times
          const observationsQuery = `
            SELECT
              d.locationID,
              o.eventID,
              o.eventStart
            FROM observations o
            JOIN deployments d ON o.deploymentID = d.deploymentID
          `

          db.all(observationsQuery, [], (err, observations) => {
            db.close()

            if (err) {
              log.error(`Error querying observations: ${err.message}`)
              return reject(err)
            }

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

            observations.forEach((obs) => {
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
            resolve(result)
          })
        })
      })
    })
  })
}

/**
 * Get daily timeseries data for specific species
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} speciesNames - List of scientific names to include
 * @param {Object} bounds - Map bounds for filtering (optional)
 * @returns {Promise<Object>} - Timeseries data for specified species
 */
export async function getSpeciesTimeseries(dbPath, speciesNames = [], bounds) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    log.info(`Querying species timeseries from: ${dbPath} for specific species`)
    log.info(`Selected species: ${speciesNames.join(', ')}`)
    if (bounds) {
      log.info(
        `Filtering by bounds: N=${bounds.north}, S=${bounds.south}, E=${bounds.east}, W=${bounds.west}`
      )
    }

    // Open the database
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      // Prepare IN clause for selected species if provided
      let speciesClause = ''
      let speciesFilter = ''

      if (speciesNames && speciesNames.length > 0) {
        const quotedSpecies = speciesNames.map((name) => `'${name.replace(/'/g, "''")}'`).join(',')
        speciesClause = `WHERE scientificName IN (${quotedSpecies})`
        speciesFilter = `AND o.scientificName IN (${quotedSpecies})`
      }

      // Build bounds filter if provided
      let boundsFilter = ''
      if (bounds) {
        boundsFilter = `
          AND d.latitude IS NOT NULL
          AND d.longitude IS NOT NULL
          AND d.latitude <= ${bounds.north} AND d.latitude >= ${bounds.south}
          AND d.longitude <= ${bounds.east} AND d.longitude >= ${bounds.west}
        `
      }

      // Query using recursive CTE to generate week series and join with observations
      const timeseriesQuery = `
        WITH date_range AS (
          SELECT
            date(min(substr(o.eventStart, 1, 10)), 'weekday 0') AS start_week,
            date(max(substr(o.eventStart, 1, 10)), 'weekday 0') AS end_week
          FROM observations o
          JOIN deployments d ON o.deploymentID = d.deploymentID
          WHERE substr(o.eventStart, 1, 4) > '1970'
          ${boundsFilter}
        ),
        weeks(week_start) AS (
          SELECT start_week FROM date_range
          UNION ALL
          SELECT date(week_start, '+7 days')
          FROM weeks, date_range
          WHERE week_start < end_week
        ),
        species_list AS (
          SELECT
            o.scientificName,
            COUNT(*) as count
          FROM observations o
          JOIN deployments d ON o.deploymentID = d.deploymentID
          WHERE o.scientificName IS NOT NULL AND o.scientificName != ''
          ${speciesFilter ? speciesFilter : ''}
          ${boundsFilter}
          GROUP BY o.scientificName
        ),
        week_species_combinations AS (
          SELECT
            weeks.week_start,
            species_list.scientificName
          FROM weeks
          CROSS JOIN species_list
        ),
        weekly_counts AS (
          SELECT
            date(substr(o.eventStart, 1, 10), 'weekday 0') as observation_week,
            o.scientificName,
            COUNT(*) as count
          FROM observations o
          JOIN deployments d ON o.deploymentID = d.deploymentID
          WHERE o.scientificName IS NOT NULL AND o.scientificName != ''
          ${speciesFilter ? speciesFilter : ''}
          ${boundsFilter}
          GROUP BY observation_week, o.scientificName
        )
        SELECT
          wsc.week_start as date,
          wsc.scientificName,
          COALESCE(wc.count, 0) as count,
          sl.count as total_count
        FROM week_species_combinations wsc
        LEFT JOIN weekly_counts wc ON wsc.week_start = wc.observation_week
          AND wsc.scientificName = wc.scientificName
        JOIN species_list sl ON wsc.scientificName = sl.scientificName
        ORDER BY wsc.week_start ASC, wsc.scientificName
      `

      db.all(timeseriesQuery, [], (err, timeseries) => {
        db.close()

        if (err) {
          log.error(`Error querying timeseries: ${err.message}`)
          return reject(err)
        }

        // Process the SQL results into the expected format
        const processedData = processTimeseriesDataFromSql(timeseries)

        // Extract species metadata from the timeseries data
        const speciesMap = new Map()
        timeseries.forEach((row) => {
          if (!speciesMap.has(row.scientificName)) {
            speciesMap.set(row.scientificName, {
              scientificName: row.scientificName,
              count: row.total_count
            })
          }
        })

        // Convert the map to an array and sort by count descending
        const speciesData = Array.from(speciesMap.values()).sort((a, b) => b.count - a.count)

        const elapsedTime = Date.now() - startTime
        log.info(
          `Retrieved timeseries data: ${processedData.length} weeks for ${speciesData.length} species in ${elapsedTime}ms`
        )
        resolve({
          allSpecies: speciesData,
          timeseries: processedData
        })
      })
    })
  })
}

/**
 * Get species geolocation data for heatmap visualization
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} species - List of scientific names to include
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @param {number} startHour - Starting hour of day (0-24)
 * @param {number} endHour - Ending hour of day (0-24)
 * @param {Object} bounds - Map bounds for filtering (optional)
 * @returns {Promise<Object>} - Species geolocation data for heatmap
 */
export async function getSpeciesHeatmapData(
  dbPath,
  species,
  startDate,
  endDate,
  startHour = 0,
  endHour = 24,
  bounds
) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    log.info(`Querying species heatmap data from: ${dbPath}`)
    log.info(`Date range: ${startDate} to ${endDate}`)
    log.info(`Time range: ${startHour} to ${endHour} hours`)
    log.info(`Species: ${species.join(', ')}`)
    if (bounds) {
      log.info(
        `Filtering by bounds: N=${bounds.north}, S=${bounds.south}, E=${bounds.east}, W=${bounds.west}`
      )
    }

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      // Extract species names for the IN clause with proper escaping
      const speciesNames = species.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')

      // Time of day query condition
      let timeCondition = ''
      if (startHour < endHour) {
        // Simple range (e.g., 8:00 to 17:00)
        timeCondition = `
          AND CAST(strftime('%H', o.eventStart) AS INTEGER) >= ${startHour}
          AND CAST(strftime('%H', o.eventStart) AS INTEGER) < ${endHour}
        `
      } else if (startHour > endHour) {
        // Wrapping range (e.g., 22:00 to 6:00)
        timeCondition = `
          AND CAST(strftime('%H', o.eventStart) AS INTEGER) >= ${startHour}
          OR CAST(strftime('%H', o.eventStart) AS INTEGER) < ${endHour}
        `
      }
      // If startHour equals endHour, we include all hours (full day)

      // Build bounds filter if provided
      let boundsFilter = ''
      if (bounds) {
        boundsFilter = `
          AND d.latitude <= ${bounds.north} AND d.latitude >= ${bounds.south}
          AND d.longitude <= ${bounds.east} AND d.longitude >= ${bounds.west}
        `
      }

      // Query to get observation counts by location and species
      const query = `
        SELECT
          d.locationName,
          d.latitude,
          d.longitude,
          o.scientificName,
          COUNT(*) as count
        FROM observations o
        JOIN deployments d ON o.deploymentID = d.deploymentID
        WHERE
          o.scientificName IN (${speciesNames})
          AND o.eventStart >= ?
          AND o.eventStart <= ?
          AND d.latitude IS NOT NULL
          AND d.longitude IS NOT NULL
          ${timeCondition}
          ${boundsFilter}
        GROUP BY d.latitude, d.longitude, o.scientificName
        ORDER BY count DESC
      `

      db.all(query, [startDate, endDate], (err, rows) => {
        db.close()

        if (err) {
          log.error(`Error querying species heatmap data: ${err.message}`)
          return reject(err)
        }

        // Process the data to create species-specific datasets
        const speciesData = {}
        species.forEach((s) => {
          speciesData[s] = []
        })

        rows.forEach((row) => {
          if (speciesData[row.scientificName]) {
            speciesData[row.scientificName].push({
              lat: parseFloat(row.latitude), // Convert to number here
              lng: parseFloat(row.longitude), // Convert to number here
              count: row.count,
              locationName: row.locationName
            })
          }
        })

        const elapsedTime = Date.now() - startTime
        log.info(`Retrieved heatmap data: ${rows.length} location points in ${elapsedTime}ms`)
        resolve(speciesData)
      })
    })
  })
}

/**
 * Get media files from the database that have animal observations with optional filtering
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of media files to return
 * @param {number} options.offset - Number of records to skip for pagination
 * @param {Array<string>} options.species - List of species to filter by (optional)
 * @param {Object} options.dateRange - Date range to filter by (optional)
 * @param {string} options.dateRange.start - Start date (ISO string)
 * @param {string} options.dateRange.end - End date (ISO string)
 * @param {Object} options.timeRange - Time of day range to filter by (optional)
 * @param {number} options.timeRange.start - Start hour (0-23)
 * @param {number} options.timeRange.end - End hour (0-23)
 * @returns {Promise<Array>} - Media files matching the criteria
 */
export async function getMedia(dbPath, options = {}) {
  const { limit = 10, offset = 0, species = [], dateRange = {}, timeRange = {} } = options

  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    log.info(`Querying media files from: ${dbPath} with filtering options`)
    log.info(`Pagination: limit ${limit}, offset ${offset}`)

    if (species.length > 0) {
      log.info(`Species filter: ${species.join(', ')}`)
    }

    if (dateRange.start && dateRange.end) {
      log.info(`Date range: ${typeof dateRange.start} to ${dateRange.end}`)
    }

    if (timeRange.start !== undefined && timeRange.end !== undefined) {
      log.info(`Time range: ${timeRange.start}:00 to ${timeRange.end}:00`)
    }

    // Open the database
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      // Build the query with optional filters
      let query = `
        SELECT DISTINCT
          m.mediaID,
          m.filePath,
          m.fileName,
          m.timestamp,
          m.deploymentID,
          o.scientificName
        FROM media m
        JOIN observations o ON m.timestamp = o.eventStart
        WHERE o.scientificName IS NOT NULL
          AND o.scientificName != ''

      `

      const queryParams = []

      // Add species filter if provided
      if (species.length > 0) {
        const placeholders = species.map(() => '?').join(',')
        query += ` AND o.scientificName IN (${placeholders})`
        queryParams.push(...species)
      }

      // Add date range filter if provided
      if (dateRange.start && dateRange.end) {
        // Format Date objects to ISO strings if they're not already
        const startDate =
          dateRange.start instanceof Date ? dateRange.start.toISOString() : dateRange.start
        const endDate = dateRange.end instanceof Date ? dateRange.end.toISOString() : dateRange.end

        log.info(`Formatted date range: ${startDate} to ${endDate}`)

        query += ` AND m.timestamp >= ? AND m.timestamp <= ?`
        queryParams.push(startDate, endDate)
      }

      // Add time of day filter if provided
      if (timeRange.start !== undefined && timeRange.end !== undefined) {
        if (timeRange.start < timeRange.end) {
          // Simple range (e.g., 8:00 to 17:00)
          query += ` AND CAST(strftime('%H', m.timestamp) AS INTEGER) >= ?
                     AND CAST(strftime('%H', m.timestamp) AS INTEGER) < ?`
          queryParams.push(timeRange.start, timeRange.end)
        } else if (timeRange.start > timeRange.end) {
          // Wrapping range (e.g., 22:00 to 6:00)
          query += ` AND (CAST(strftime('%H', m.timestamp) AS INTEGER) >= ?
                     OR CAST(strftime('%H', m.timestamp) AS INTEGER) < ?)`
          queryParams.push(timeRange.start, timeRange.end)
        }
      }

      // Add ordering and limit with offset for pagination
      query += `
        ORDER BY m.timestamp DESC
        LIMIT ? OFFSET ?
      `
      queryParams.push(limit, offset)

      db.all(query, queryParams, (err, rows) => {
        // Close the database
        db.close()

        if (err) {
          log.error(`Error querying media with observations: ${err.message}`)
          return reject(err)
        }

        const elapsedTime = Date.now() - startTime
        log.info(
          `Retrieved ${rows.length} media files matching criteria (offset: ${offset}) in ${elapsedTime}ms`
        )
        resolve(rows)
      })
    })
  })
}

/**
 * Get hourly activity data for species
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} species - List of scientific names to include
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @param {Object} bounds - Map bounds for filtering (optional)
 * @returns {Promise<Object>} - Hourly activity data for specified species
 */
export async function getSpeciesDailyActivity(dbPath, species, startDate, endDate, bounds) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    log.info(`Querying species daily activity from: ${dbPath}`)
    log.info(`Date range: ${startDate} to ${endDate}`)
    log.info(`Species: ${species.join(', ')}`)
    if (bounds) {
      log.info(
        `Filtering by bounds: N=${bounds.north}, S=${bounds.south}, E=${bounds.east}, W=${bounds.west}`
      )
    }

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      // Extract species names for the IN clause with proper escaping
      const speciesNames = species.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')

      // Build bounds filter if provided
      let boundsFilter = ''
      if (bounds) {
        boundsFilter = `
          AND d.latitude IS NOT NULL
          AND d.longitude IS NOT NULL
          AND d.latitude <= ${bounds.north} AND d.latitude >= ${bounds.south}
          AND d.longitude <= ${bounds.east} AND d.longitude >= ${bounds.west}
        `
      }

      // Query to get observation counts by hour and species
      const query = `
        SELECT
          CAST(strftime('%H', o.eventStart) AS INTEGER) as hour,
          o.scientificName,
          COUNT(*) as count
        FROM observations o
        JOIN deployments d ON o.deploymentID = d.deploymentID
        WHERE
          o.scientificName IN (${speciesNames})
          AND o.eventStart >= ?
          AND o.eventStart <= ?
          ${boundsFilter}
        GROUP BY hour, o.scientificName
        ORDER BY hour, o.scientificName
      `

      db.all(query, [startDate, endDate], (err, rows) => {
        db.close()

        if (err) {
          log.error(`Error querying species daily activity data: ${err.message}`)
          return reject(err)
        }

        // Process the data to create species-specific hourly patterns
        const hourlyData = Array(24)
          .fill()
          .map((_, i) => ({
            hour: i,
            // Initialize with 0 for each species
            ...Object.fromEntries(species.map((s) => [s, 0]))
          }))

        // Fill in the actual data from the query results
        rows.forEach((row) => {
          hourlyData[row.hour][row.scientificName] = row.count
        })

        const elapsedTime = Date.now() - startTime
        log.info(
          `Retrieved daily activity data: ${rows.length} hour/species combinations in ${elapsedTime}ms`
        )
        resolve(hourlyData)
      })
    })
  })
}

// Helper function to process timeseries data from SQL query
function processTimeseriesDataFromSql(rawData) {
  const resultMap = new Map()

  // Group by date and collect counts for each species
  rawData.forEach((entry) => {
    if (!resultMap.has(entry.date)) {
      resultMap.set(entry.date, {})
    }
    const dateEntry = resultMap.get(entry.date)
    dateEntry[entry.scientificName] = entry.count
  })

  // Convert map to array format
  return Array.from(resultMap.entries())
    .map(([date, speciesCounts]) => ({
      date,
      ...speciesCounts
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Create and initialize a new database for an image directory
 * @param {string} dbPath - Path for the new SQLite database
 * @returns {Promise<sqlite3.Database>} - Database instance
 */
export async function createImageDirectoryDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    log.info(`Creating new database at: ${dbPath}`)

    // Create/open the database
    const db = new sqlite3.Database(
      dbPath,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
      async (err) => {
        if (err) {
          log.error(`Error creating database: ${err.message}`)
          return reject(err)
        }

        try {
          // Enable foreign keys
          await runQuery(db, 'PRAGMA foreign_keys = ON')

          // Create deployments table
          await runQuery(
            db,
            `
          CREATE TABLE IF NOT EXISTS deployments (
            deploymentID TEXT PRIMARY KEY,
            locationID TEXT,
            locationName TEXT,
            deploymentStart TEXT,
            deploymentEnd TEXT,
            latitude REAL,
            longitude REAL
          )
        `
          )

          // Create media table
          await runQuery(
            db,
            `
          CREATE TABLE IF NOT EXISTS media (
            mediaID TEXT PRIMARY KEY,
            deploymentID TEXT,
            timestamp TEXT,
            filePath TEXT,
            fileName TEXT,
            FOREIGN KEY (deploymentID) REFERENCES deployments (deploymentID)
          )
        `
          )

          // Create observations table (for future predictions)
          await runQuery(
            db,
            `
          CREATE TABLE IF NOT EXISTS observations (
            observationID TEXT PRIMARY KEY,
            mediaID TEXT,
            deploymentID TEXT,
            eventID TEXT,
            eventStart TEXT,
            scientificName TEXT,
            confidence REAL,
            count INTEGER DEFAULT 1,
            prediction TEXT,
            FOREIGN KEY (mediaID) REFERENCES media (mediaID),
            FOREIGN KEY (deploymentID) REFERENCES deployments (deploymentID)
          )
        `
          )

          resolve(db)
        } catch (error) {
          log.error(`Error initializing database: ${error.message}`)
          reject(error)
        }
      }
    )
  })
}

/**
 * Insert deployment data into the database
 * @param {sqlite3.Database} db - Database instance
 * @param {Array} deployments - Array of deployment objects
 * @returns {Promise<void>}
 */
export async function insertDeployments(db, deployments) {
  return new Promise((resolve, reject) => {
    log.info(`Inserting ${Object.keys(deployments).length} deployments into database`)

    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      try {
        const insertSql = `
          INSERT INTO deployments (
            deploymentID, locationID, locationName,
            deploymentStart, deploymentEnd, latitude, longitude
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `

        for (const depKey of Object.keys(deployments)) {
          const dep = deployments[depKey]
          await runQuery(db, insertSql, [
            dep.deploymentID,
            dep.locationID,
            dep.locationName,
            dep.deploymentStart ? dep.deploymentStart.toISO() : null,
            dep.deploymentEnd ? dep.deploymentEnd.toISO() : null,
            dep.latitude,
            dep.longitude
          ])
        }

        db.run('COMMIT', (err) => {
          if (err) {
            log.error(`Error committing transaction: ${err.message}`)
            db.run('ROLLBACK')
            return reject(err)
          }
          log.info(`Successfully inserted ${Object.keys(deployments).length} deployments`)
          resolve()
        })
      } catch (error) {
        log.error(`Error inserting deployments: ${error.message}`)
        db.run('ROLLBACK')
        reject(error)
      }
    })
  })
}

/**
 * Insert media data into the database
 * @param {sqlite3.Database} db - Database instance
 * @param {Array} media - Array of media objects
 * @returns {Promise<void>}
 */
export async function insertMedia(db, media) {
  return new Promise((resolve, reject) => {
    log.info(`Inserting ${Object.keys(media).length} media items into database`)

    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      try {
        const insertSql = `
          INSERT INTO media (
            mediaID, deploymentID, timestamp, filePath, fileName
          ) VALUES (?, ?, ?, ?, ?)
        `

        let count = 0
        for (const mediaPath of Object.keys(media)) {
          const item = media[mediaPath]
          console.log('ITEM', item)
          await runQuery(db, insertSql, [
            item.mediaID,
            item.deploymentID,
            item.timestamp ? item.timestamp.toISO() : null,
            item.filePath,
            item.fileName
          ])

          count++
          if (count % 1000 === 0) {
            log.info(`Inserted ${count}/${Object.keys(media).length} media items`)
          }
        }

        db.run('COMMIT', (err) => {
          if (err) {
            log.error(`Error committing transaction: ${err.message}`)
            db.run('ROLLBACK')
            return reject(err)
          }
          log.info(`Successfully inserted ${count} media items`)
          resolve()
        })
      } catch (error) {
        log.error(`Error inserting media: ${error.message}`)
        db.run('ROLLBACK')
        reject(error)
      }
    })
  })
}

/**
 * Insert observations data into the database
 * @param {sqlite3.Database} db - Database instance
 * @param {Array} observations - Array of observation objects
 * @returns {Promise<void>}
 */
export async function insertObservations(db, observations) {
  return new Promise((resolve, reject) => {
    log.info(`Inserting ${observations.length} observations into database`)

    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      try {
        const insertSql = `
          INSERT INTO observations (
            observationID, mediaID, deploymentID, eventID,
            eventStart, scientificName, confidence, prediction
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `

        let count = 0
        for (const observation of observations) {
          await runQuery(db, insertSql, [
            observation.observationID,
            observation.mediaID,
            observation.deploymentID,
            observation.eventID,
            observation.eventStart ? observation.eventStart.toISO() : null,
            observation.scientificName,
            observation.confidence || null,
            observation.prediction || null
          ])

          count++
          if (count % 1000 === 0) {
            log.info(`Inserted ${count}/${observations.length} observations`)
          }
        }

        db.run('COMMIT', (err) => {
          if (err) {
            log.error(`Error committing transaction: ${err.message}`)
            db.run('ROLLBACK')
            return reject(err)
          }
          log.info(`Successfully inserted ${count} observations`)
          resolve()
        })
      } catch (error) {
        log.error(`Error inserting observations: ${error.message}`)
        db.run('ROLLBACK')
        reject(error)
      }
    })
  })
}

/**
 * Run a SQLite query (helper function)
 * @param {sqlite3.Database} db - Database instance
 * @param {string} query - SQL query
 * @param {Array} params - Parameters for the query
 * @returns {Promise<Object>} - Result of the query
 */
function runQuery(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) {
        reject(err)
      } else {
        resolve(this)
      }
    })
  })
}

/**
 * Get activity data (observation counts) per deployment over time periods
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Object>} - Activity data with periods and counts per deployment
 */
export async function getDeploymentsActivity(dbPath) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    log.info(`Querying deployment activity from: ${dbPath}`)

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      // First get the total date range to calculate period size
      const dateRangeQuery = `
        SELECT
          MIN(deploymentStart) as minDate,
          MAX(deploymentEnd) as maxDate
        FROM deployments
      `

      db.get(dateRangeQuery, [], (err, dateRange) => {
        if (err) {
          db.close()
          log.error(`Error getting date range: ${err.message}`)
          return reject(err)
        }

        // Get all deployments
        const deploymentsQuery = `
          SELECT DISTINCT
            deploymentID,
            locationName,
            locationID,
            deploymentStart,
            deploymentEnd,
            latitude,
            longitude
          FROM deployments
        `

        db.all(deploymentsQuery, [], (err, deployments) => {
          if (err) {
            db.close()
            log.error(`Error querying deployments: ${err.message}`)
            return reject(err)
          }

          // Get all observations with their deployment IDs and event start times
          const observationsQuery = `
            SELECT
              deploymentID,
              eventID,
              eventStart
            FROM observations
          `

          db.all(observationsQuery, [], (err, observations) => {
            db.close()

            if (err) {
              log.error(`Error querying observations: ${err.message}`)
              return reject(err)
            }

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

            // Create deployment map
            const deploymentMap = new Map()
            deployments.forEach((deployment) => {
              deploymentMap.set(deployment.deploymentID, {
                deploymentID: deployment.deploymentID,
                locationName: deployment.locationName,
                locationID: deployment.locationID,
                deploymentStart: deployment.deploymentStart,
                deploymentEnd: deployment.deploymentEnd,
                latitude: deployment.latitude,
                longitude: deployment.longitude,
                periods: periods.map((period) => ({
                  start: period.start,
                  end: period.end,
                  count: 0
                }))
              })
            })

            // Count observations per deployment per period
            const allCounts = []

            observations.forEach((obs) => {
              const deployment = deploymentMap.get(obs.deploymentID)
              if (!deployment) return

              const obsDate = new Date(obs.eventStart)

              for (let i = 0; i < periods.length; i++) {
                const periodStart = new Date(periods[i].start)
                const periodEnd = new Date(periods[i].end)

                if (obsDate >= periodStart && obsDate < periodEnd) {
                  deployment.periods[i].count++
                  break
                }
              }
            })

            // Collect all non-zero counts for percentile calculation
            deploymentMap.forEach((deployment) => {
              deployment.periods.forEach((period) => {
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
              deployments: Array.from(deploymentMap.values())
            }

            const elapsedTime = Date.now() - startTime
            log.info(
              `Retrieved deployment activity data for ${result.deployments.length} deployments in ${elapsedTime}ms`
            )
            resolve(result)
          })
        })
      })
    })
  })
}
