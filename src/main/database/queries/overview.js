/**
 * Overview tab — consolidated stats query.
 * Returns one payload covering every KPI tile shown on the Overview tab,
 * including the derived date range used by the Span tile.
 *
 * The query collapses what were eight separate round-trips into two
 * `prepare/get` calls: one mega-query with subqueries for counts + range,
 * and a separate distinct-species pull (kept separate so we can JS-join
 * against the bundled speciesInfo dictionary for the threatened tally).
 */

import { getStudyDatabase } from '../manager.js'
import log from '../../services/logger.js'
import { getStudyIdFromPath } from './utils.js'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/resolver.js'

const THREATENED_IUCN = new Set(['VU', 'EN', 'CR', 'EW', 'EX'])

/**
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<{
 *   speciesCount: number,
 *   threatenedCount: number,
 *   threatenedSpecies: Array<{ scientificName: string, iucn: string }>,
 *   cameraCount: number,
 *   locationCount: number,
 *   observationCount: number,
 *   cameraDays: number,
 *   mediaCount: number,
 *   derivedRange: { start: string | null, end: string | null }
 * }>}
 */
export async function getOverviewStats(dbPath) {
  const startTime = Date.now()
  log.info(`Querying overview stats from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
    const sqlite = manager.getSqlite()

    // 1. Counts + derived range in a single query. Each subquery runs once
    //    and SQLite plans the whole thing as a parallel-ish scan, so this
    //    is materially cheaper than 8 separate prepare/get calls.
    const row = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(DISTINCT COALESCE(cameraID, deploymentID)) FROM deployments) AS cameraCount,
           (SELECT COUNT(DISTINCT locationID) FROM deployments WHERE locationID IS NOT NULL) AS locationCount,
           (SELECT COUNT(*) FROM observations
              WHERE (scientificName IS NOT NULL AND scientificName != '')
                 OR observationType = 'vehicle') AS observationCount,
           (SELECT COALESCE(SUM(julianday(deploymentEnd) - julianday(deploymentStart)), 0)
              FROM deployments
              WHERE deploymentStart IS NOT NULL
                AND deploymentEnd   IS NOT NULL
                AND julianday(deploymentStart) IS NOT NULL
                AND julianday(deploymentEnd)   IS NOT NULL) AS cameraDays,
           (SELECT COUNT(*) FROM media) AS mediaCount,
           (SELECT startDate FROM metadata LIMIT 1) AS overrideStart,
           (SELECT endDate   FROM metadata LIMIT 1) AS overrideEnd,
           (SELECT MIN(eventStart) FROM observations
              WHERE eventStart IS NOT NULL AND eventStart != '') AS minObs,
           (SELECT MAX(eventStart) FROM observations
              WHERE eventStart IS NOT NULL AND eventStart != '') AS maxObs,
           (SELECT MIN(deploymentStart) FROM deployments
              WHERE deploymentStart IS NOT NULL AND deploymentStart != '') AS minDep,
           (SELECT MAX(deploymentEnd) FROM deployments
              WHERE deploymentEnd   IS NOT NULL AND deploymentEnd   != '') AS maxDep,
           (SELECT MIN(timestamp) FROM media
              WHERE timestamp IS NOT NULL AND timestamp != '') AS minMed,
           (SELECT MAX(timestamp) FROM media
              WHERE timestamp IS NOT NULL AND timestamp != '') AS maxMed`
      )
      .get()

    // 2. Distinct species names (for species count + threatened tally).
    //    Kept separate from #1 because we need the names themselves, not
    //    just a count, to look up IUCN status from the bundled dictionary.
    //    The `observationType != 'blank'` filter is redundant — by
    //    convention blank-type observations have a null/empty scientificName
    //    (verified: zero rows in MICA, GMU8 Leuven, Serengeti, NACTI break
    //    this). Dropping it lets SQLite use idx_observations_scientificName
    //    as a covering index for the GROUP BY scan.
    const speciesRows = sqlite
      .prepare(
        `SELECT scientificName FROM observations
           WHERE scientificName IS NOT NULL AND scientificName != ''
           GROUP BY scientificName`
      )
      .all()

    const speciesCount = speciesRows.length
    const threatenedSpecies = []
    for (const r of speciesRows) {
      const info = resolveSpeciesInfo(r.scientificName)
      if (info?.iucn && THREATENED_IUCN.has(info.iucn)) {
        threatenedSpecies.push({ scientificName: r.scientificName, iucn: info.iucn })
      }
    }
    const threatenedCount = threatenedSpecies.length

    const derivedRange = {
      start:
        toIsoDate(row?.overrideStart) ||
        toIsoDate(row?.minObs) ||
        toIsoDate(row?.minDep) ||
        toIsoDate(row?.minMed),
      end:
        toIsoDate(row?.overrideEnd) ||
        toIsoDate(row?.maxObs) ||
        toIsoDate(row?.maxDep) ||
        toIsoDate(row?.maxMed)
    }

    const result = {
      speciesCount,
      threatenedCount,
      threatenedSpecies,
      cameraCount: row?.cameraCount ?? 0,
      locationCount: row?.locationCount ?? 0,
      observationCount: row?.observationCount ?? 0,
      cameraDays: Math.round(row?.cameraDays || 0),
      mediaCount: row?.mediaCount ?? 0,
      derivedRange
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Overview stats: ${result.speciesCount} species, ${result.observationCount} obs, ${result.mediaCount} media in ${elapsedTime}ms`
    )

    return result
  } catch (error) {
    log.error(`Error in getOverviewStats: ${error.message}`)
    throw error
  }
}

function toIsoDate(value) {
  if (!value) return null
  // value can be 'YYYY-MM-DD' or full ISO 'YYYY-MM-DDTHH:MM:SSZ'.
  // Take the first 10 characters either way.
  return String(value).slice(0, 10)
}
