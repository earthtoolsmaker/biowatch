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

  // SQLite returns the EXISTS flag as 0/1 — normalize to a boolean.
  const mediaArray = mediaRows.map((r) => ({ ...r, isDetection: !!Number(r.isDetection) }))

  // Group identically to pagination.js: null gap → eventID grouping, otherwise
  // timestamp-proximity (deployment-scoped, video-aware). Null-timestamp media
  // come back separately, each its own single-item sequence.
  const grouped =
    gapSeconds === null
      ? groupMediaByEventID(mediaArray)
      : groupMediaIntoSequences(mediaArray, gapSeconds, isVideoMedia)
  const { sequences, nullTimestampMedia } = grouped

  const byDeployment = new Map()
  const tally = (items) => {
    if (!items.length) return
    const dep = items[0].deploymentID
    const e = byDeployment.get(dep) || { total: 0, detections: 0, images: 0, videos: 0 }
    e.total++
    if (items.some((i) => i.isDetection)) e.detections++
    // A sequence's media type follows its representative (first) item, matching
    // the table's Type column (deriveTableRow uses items[0]).
    if (isVideoMedia(items[0])) e.videos++
    else e.images++
    byDeployment.set(dep, e)
  }
  for (const seq of sequences) tally(seq.items)
  for (const m of nullTimestampMedia) tally([m])

  return deployments
    .map((d) => {
      const e = byDeployment.get(d.deploymentID) || {
        total: 0,
        detections: 0,
        images: 0,
        videos: 0
      }
      return {
        deploymentID: d.deploymentID,
        locationName: d.locationName || d.locationID || d.deploymentID,
        latitude: d.latitude,
        longitude: d.longitude,
        count: e.total,
        detectionCount: e.detections,
        blankCount: e.total - e.detections,
        imageCount: e.images,
        videoCount: e.videos
      }
    })
    .sort(
      (a, b) => b.count - a.count || String(a.deploymentID).localeCompare(String(b.deploymentID))
    )
}
