/**
 * Sequence-aware per-deployment composition for the Media tab's deployment
 * filter. Unlike a raw media tally, this groups each deployment's media into
 * sequences using the SAME logic the Table/Grid pagination uses (eventID when
 * the study has no sequenceGap, otherwise timestamp-proximity grouping), then
 * counts blank vs detection SEQUENCES — so the bar/hover-card numbers match the
 * rows a user sees after selecting the deployment.
 *
 * NOTE: this dumps all media into JS to group. For very large studies with a
 * positive sequenceGap that's memory-heavy (same trade-off as the species
 * distribution's slow path) — optimizing that is deferred follow-up work.
 */

import { groupMediaIntoSequences, groupMediaByEventID } from './grouping.js'
import {
  getMediaForDeploymentComposition,
  getDeploymentsBasic,
  getDrizzleDb,
  getMetadata
} from '../../database/index.js'
import { getStudyIdFromPath } from '../../database/queries/utils.js'

function isVideoMedia(m) {
  return !!m.fileMediatype && m.fileMediatype.startsWith('video/')
}

/**
 * @param {string} dbPath - Path to the SQLite database
 * @param {number|null} [gapSecondsOverride] - Sequence gap to group by; when
 *   omitted, read from study metadata (matching the table). Mainly for tests.
 * @returns {Promise<Array<{deploymentID, locationName, latitude, longitude, count, detectionCount, blankCount, imageCount, videoCount}>>}
 *   Sequence counts per deployment, sorted by total sequences descending.
 */
export async function getDeploymentComposition(dbPath, gapSecondsOverride) {
  const studyId = getStudyIdFromPath(dbPath)
  let gapSeconds = gapSecondsOverride
  if (gapSeconds === undefined) {
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
    const meta = await getMetadata(db)
    gapSeconds = meta?.sequenceGap ?? null
  }

  const mediaRows = await getMediaForDeploymentComposition(dbPath)
  const deployments = await getDeploymentsBasic(dbPath)

  // SQLite returns the EXISTS flags as 0/1 — normalize to booleans.
  const mediaArray = mediaRows.map((r) => ({
    ...r,
    isDetection: !!Number(r.isDetection),
    isVehicle: !!Number(r.isVehicle)
  }))

  // Count blank vs detection by grouping each media SUBSET independently —
  // mirroring how the Media tab's Blank quick view (and a species filter) work:
  // they filter media first, then group. So a mixed burst (some empty frames,
  // some with the animal) contributes a blank sequence AND a detection sequence,
  // and `blankCount` here equals exactly what "deployment + Blank" shows.
  const group = (subset) =>
    gapSeconds === null
      ? groupMediaByEventID(subset)
      : groupMediaIntoSequences(subset, gapSeconds, isVideoMedia)

  const tallySubset = (subset) => {
    const { sequences, nullTimestampMedia } = group(subset)
    const byDep = new Map()
    const add = (items) => {
      if (!items.length) return
      const dep = items[0].deploymentID
      const e = byDep.get(dep) || { count: 0, images: 0, videos: 0 }
      e.count++
      // A sequence's media type follows its representative (first) item,
      // matching the table's Type column (deriveTableRow uses items[0]).
      if (isVideoMedia(items[0])) e.videos++
      else e.images++
      byDep.set(dep, e)
    }
    for (const seq of sequences) add(seq.items)
    for (const m of nullTimestampMedia) add([m])
    return byDep
  }

  const detectionByDep = tallySubset(mediaArray.filter((m) => m.isDetection))
  const blankByDep = tallySubset(mediaArray.filter((m) => !m.isDetection))
  // Vehicle is a subset of "detection" (it counts toward detectionCount in the
  // bar); this separate tally drives the sequence-aware Vehicle quick-view count.
  const vehicleByDep = tallySubset(mediaArray.filter((m) => m.isVehicle))

  return deployments
    .map((d) => {
      const det = detectionByDep.get(d.deploymentID) || { count: 0, images: 0, videos: 0 }
      const blank = blankByDep.get(d.deploymentID) || { count: 0, images: 0, videos: 0 }
      const vehicle = vehicleByDep.get(d.deploymentID) || { count: 0 }
      return {
        deploymentID: d.deploymentID,
        locationName: d.locationName || d.locationID || d.deploymentID,
        latitude: d.latitude,
        longitude: d.longitude,
        count: det.count + blank.count,
        detectionCount: det.count,
        blankCount: blank.count,
        vehicleCount: vehicle.count,
        imageCount: det.images + blank.images,
        videoCount: det.videos + blank.videos
      }
    })
    .sort(
      (a, b) => b.count - a.count || String(a.deploymentID).localeCompare(String(b.deploymentID))
    )
}
