/**
 * Sequence-aware per-deployment composition for the Media tab's deployment
 * filter. Groups each deployment's media into sequences using the SAME unified
 * grouping the Table/Grid pagination uses (eventID when the study has no
 * sequenceGap, otherwise timestamp-proximity grouping), then classifies each
 * WHOLE sequence: a sequence with any real observation is a detection, one with
 * none is blank. So the counts equal the rows a user sees after selecting the
 * deployment — a mixed burst (animal in some frames, empty in others) is ONE
 * detection row, not split into a detection + a blank.
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

async function resolveGapSeconds(dbPath, gapSecondsOverride) {
  if (gapSecondsOverride !== undefined) return gapSecondsOverride
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
  const meta = await getMetadata(db)
  return meta?.sequenceGap ?? null
}

// Classify one deployment's media into unified sequences and count detection /
// blank / vehicle SEQUENCES (a whole sequence with no detection is blank). Same
// logic as getDeploymentComposition, scoped to a single deployment.
function classifyDeployment(mediaArray, gapSeconds) {
  const { sequences, nullTimestampMedia } =
    gapSeconds === null
      ? groupMediaByEventID(mediaArray)
      : groupMediaIntoSequences(mediaArray, gapSeconds, isVideoMedia)
  const seqs = [...sequences.map((s) => s.items), ...nullTimestampMedia.map((m) => [m])]
  const t = { count: 0, detectionCount: 0, blankCount: 0, vehicleCount: 0 }
  for (const items of seqs) {
    if (!items.length) continue
    t.count++
    if (items.some((m) => m.isDetection)) t.detectionCount++
    else t.blankCount++
    if (items.some((m) => m.isVehicle)) t.vehicleCount++
  }
  return t
}

/**
 * Sequence-aware stats for ONE deployment — the unit the Media tab (and this
 * deployment's gallery) shows. Used by the Deployments-tab detail pane so its
 * Blank count matches what the Blank filter actually returns.
 * @param {string} dbPath
 * @param {string} deploymentID
 * @param {number|null} [gapSecondsOverride] - mainly for tests
 * @returns {Promise<{count, detectionCount, blankCount, vehicleCount}>}
 */
export async function getDeploymentSequenceStats(dbPath, deploymentID, gapSecondsOverride) {
  const gapSeconds = await resolveGapSeconds(dbPath, gapSecondsOverride)
  const mediaRows = await getMediaForDeploymentComposition(dbPath, deploymentID)
  const mediaArray = mediaRows.map((r) => ({
    ...r,
    isDetection: !!Number(r.isDetection),
    isVehicle: !!Number(r.isVehicle)
  }))
  return classifyDeployment(mediaArray, gapSeconds)
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

  const group = (subset) =>
    gapSeconds === null
      ? groupMediaByEventID(subset)
      : groupMediaIntoSequences(subset, gapSeconds, isVideoMedia)

  // Group each deployment's media on its OWN (grouping is sequential and
  // deployment-aware, but interleaving deployments in one time-sorted stream
  // would split a deployment's runs at every cross-deployment hop). Per the
  // deployment isolates it, matching "filter to this deployment, then group".
  const mediaByDeployment = new Map()
  for (const m of mediaArray) {
    if (!mediaByDeployment.has(m.deploymentID)) mediaByDeployment.set(m.deploymentID, [])
    mediaByDeployment.get(m.deploymentID).push(m)
  }

  // Classify each whole sequence once: detection (any real observation),
  // blank (none), vehicle (any vehicle observation — a subset of detection).
  const tallyDeployment = (items) => {
    const { sequences, nullTimestampMedia } = group(items)
    const seqs = [...sequences.map((s) => s.items), ...nullTimestampMedia.map((m) => [m])]
    const t = { count: 0, detectionCount: 0, blankCount: 0, vehicleCount: 0, images: 0, videos: 0 }
    for (const seqItems of seqs) {
      if (!seqItems.length) continue
      t.count++
      if (seqItems.some((m) => m.isDetection)) t.detectionCount++
      else t.blankCount++
      if (seqItems.some((m) => m.isVehicle)) t.vehicleCount++
      // A sequence's media type follows its representative (first) item,
      // matching the table's Type column (deriveTableRow uses items[0]).
      if (isVideoMedia(seqItems[0])) t.videos++
      else t.images++
    }
    return t
  }

  const byDep = new Map()
  for (const [dep, items] of mediaByDeployment) byDep.set(dep, tallyDeployment(items))
  const empty = {
    count: 0,
    detectionCount: 0,
    blankCount: 0,
    vehicleCount: 0,
    images: 0,
    videos: 0
  }

  return deployments
    .map((d) => {
      const t = byDep.get(d.deploymentID) || empty
      return {
        deploymentID: d.deploymentID,
        locationName: d.locationName || d.locationID || d.deploymentID,
        latitude: d.latitude,
        longitude: d.longitude,
        count: t.count,
        detectionCount: t.detectionCount,
        blankCount: t.blankCount,
        vehicleCount: t.vehicleCount,
        imageCount: t.images,
        videoCount: t.videos
      }
    })
    .sort(
      (a, b) => b.count - a.count || String(a.deploymentID).localeCompare(String(b.deploymentID))
    )
}
