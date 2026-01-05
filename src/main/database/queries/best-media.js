/**
 * Best media selection queries
 * Complex scoring and diversity selection logic for hero images
 */

import { executeRawQuery } from '../index.js'
import log from 'electron-log'
import { getStudyIdFromPath } from './utils.js'

/**
 * Assigns sequence IDs to media candidates based on timestamp proximity within the same deployment.
 * Reuses the same logic as the media tab's groupMediaIntoSequences function.
 * Media within gapThresholdSeconds of each other at the same deployment get the same sequence ID.
 *
 * @param {Array} candidates - Array of media candidates with timestamp and deploymentID
 * @param {number} gapThresholdSeconds - Maximum gap in seconds to consider media as same sequence (default: 120)
 * @returns {Array} - Same candidates array with sequenceID added to each item
 */
function assignSequenceIDs(candidates, gapThresholdSeconds = 120) {
  if (!candidates || candidates.length === 0) return candidates

  // Sort by deploymentID then timestamp for grouping
  const sorted = [...candidates].sort((a, b) => {
    const deployA = a.deploymentID || ''
    const deployB = b.deploymentID || ''
    if (deployA !== deployB) return deployA.localeCompare(deployB)
    const timeA = new Date(a.timestamp).getTime() || 0
    const timeB = new Date(b.timestamp).getTime() || 0
    return timeA - timeB
  })

  const gapMs = gapThresholdSeconds * 1000
  let currentSequenceId = null
  let currentDeployment = null
  let lastTimestamp = null
  let sequenceCounter = 0

  // Create a map of mediaID to sequenceID
  const sequenceMap = new Map()

  for (const candidate of sorted) {
    const deployment = candidate.deploymentID || null
    let mediaTime = null

    try {
      mediaTime = new Date(candidate.timestamp).getTime()
      if (isNaN(mediaTime)) mediaTime = null
    } catch {
      mediaTime = null
    }

    // Check if we should start a new sequence
    const differentDeployment = deployment !== currentDeployment
    const noValidTimestamp = mediaTime === null || lastTimestamp === null
    const gapTooLarge = mediaTime && lastTimestamp && Math.abs(mediaTime - lastTimestamp) > gapMs

    if (differentDeployment || noValidTimestamp || gapTooLarge) {
      // Start new sequence
      sequenceCounter++
      currentSequenceId = `seq-${sequenceCounter}`
      currentDeployment = deployment
    }

    sequenceMap.set(candidate.mediaID, currentSequenceId)
    if (mediaTime) lastTimestamp = mediaTime
  }

  // Add sequenceID to each candidate
  return candidates.map((c) => ({
    ...c,
    sequenceID: sequenceMap.get(c.mediaID) || `seq-unique-${c.mediaID}`
  }))
}

/**
 * Get temporal bucket for a timestamp (for diversity grouping)
 * Groups timestamps into weekly buckets to ensure temporal spread
 *
 * @param {string|null} timestamp - ISO timestamp string
 * @param {number} bucketDays - Number of days per bucket (default: 7)
 * @returns {string} - Bucket identifier (e.g., "2024-W23" for week 23 of 2024)
 */
export function getTemporalBucket(timestamp, bucketDays = 7) {
  if (!timestamp) return 'unknown'
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return 'unknown'
  const startOfYear = new Date(date.getFullYear(), 0, 1)
  const dayOfYear = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000))
  const bucketIndex = Math.floor(dayOfYear / bucketDays)
  return `${date.getFullYear()}-W${bucketIndex}`
}

/**
 * Select diverse media from candidates using a greedy algorithm
 * Applies diversity constraints to ensure variety in species, deployments, time periods, and sequences
 *
 * @param {Array} candidates - Scored media candidates (sorted by score descending), with sequenceID assigned
 * @param {number} limit - Target number of results
 * @param {Object} config - Diversity configuration
 * @param {number} config.maxPerSpecies - Max images per species (default: 2)
 * @param {number} config.maxPerDeployment - Max images per deployment (default: 3)
 * @param {number} config.maxPerTemporalBucket - Max images per time bucket (default: 4)
 * @param {number} config.maxPerSequence - Max images per sequence (default: 1)
 * @param {number} config.temporalBucketDays - Days per temporal bucket (default: 7)
 * @param {number} config.minQualityThreshold - Minimum quality score to consider (default: 0.3)
 * @returns {Array} - Selected diverse media
 */
export function selectDiverseMedia(candidates, limit, config = {}) {
  const {
    maxPerSpecies = 2,
    maxPerDeployment = 3,
    maxPerTemporalBucket = 4,
    maxPerSequence = 1,
    temporalBucketDays = 7,
    minQualityThreshold = 0.3
  } = config

  // Handle null/undefined/empty input
  if (!candidates || candidates.length === 0) {
    return []
  }

  // Filter by quality threshold first
  const qualified = candidates.filter((c) => c.compositeScore >= minQualityThreshold)

  const selected = []
  const selectedIds = new Set()

  // Track selection counts per dimension
  const speciesCount = new Map()
  const deploymentCount = new Map()
  const temporalBucketCount = new Map()
  const sequenceCount = new Map()

  // ============================================================
  // PHASE 1: Guarantee one image per species (highest-scoring)
  // This ensures every species gets representation before global
  // constraints (deployment, temporal) can block them
  // ============================================================

  // Group candidates by species
  const speciesGroups = new Map()
  for (const c of qualified) {
    const species = c.scientificName || 'unknown'
    if (!speciesGroups.has(species)) {
      speciesGroups.set(species, [])
    }
    speciesGroups.get(species).push(c)
  }

  // Pick best from each species (only sequence constraint in phase 1)
  for (const [species, items] of speciesGroups) {
    if (selected.length >= limit) break

    // Items are already sorted by score (from SQL ORDER BY)
    for (const candidate of items) {
      const sequenceId = candidate.sequenceID || null

      // Only check sequence constraint in phase 1 - no deployment/temporal limits
      if (sequenceId && (sequenceCount.get(sequenceId) || 0) >= maxPerSequence) continue

      // Select this candidate
      selected.push(candidate)
      selectedIds.add(candidate.mediaID)
      speciesCount.set(species, 1)

      // Update all tracking maps for phase 2
      const deployment = candidate.deploymentID || 'unknown'
      const bucket = getTemporalBucket(candidate.timestamp, temporalBucketDays)
      deploymentCount.set(deployment, (deploymentCount.get(deployment) || 0) + 1)
      temporalBucketCount.set(bucket, (temporalBucketCount.get(bucket) || 0) + 1)
      if (sequenceId) {
        sequenceCount.set(sequenceId, 1)
      }

      break // Only one per species in phase 1
    }
  }

  // ============================================================
  // PHASE 2: Fill remaining slots with full diversity constraints
  // Now apply all constraints including deployment and temporal
  // ============================================================

  for (const candidate of qualified) {
    if (selected.length >= limit) break
    if (selectedIds.has(candidate.mediaID)) continue

    const species = candidate.scientificName || 'unknown'
    const deployment = candidate.deploymentID || 'unknown'
    const bucket = getTemporalBucket(candidate.timestamp, temporalBucketDays)
    const sequenceId = candidate.sequenceID || null

    // Check ALL diversity constraints
    if ((speciesCount.get(species) || 0) >= maxPerSpecies) continue
    if ((deploymentCount.get(deployment) || 0) >= maxPerDeployment) continue
    if ((temporalBucketCount.get(bucket) || 0) >= maxPerTemporalBucket) continue
    if (sequenceId && (sequenceCount.get(sequenceId) || 0) >= maxPerSequence) continue

    // Select this candidate
    selected.push(candidate)
    selectedIds.add(candidate.mediaID)
    speciesCount.set(species, (speciesCount.get(species) || 0) + 1)
    deploymentCount.set(deployment, (deploymentCount.get(deployment) || 0) + 1)
    temporalBucketCount.set(bucket, (temporalBucketCount.get(bucket) || 0) + 1)
    if (sequenceId) {
      sequenceCount.set(sequenceId, (sequenceCount.get(sequenceId) || 0) + 1)
    }
  }

  // ============================================================
  // PHASE 3: Fallback - relax species/deployment/temporal constraints
  // but KEEP sequence constraint (to avoid duplicate burst images)
  // ============================================================

  if (selected.length < limit) {
    for (const candidate of qualified) {
      if (selected.length >= limit) break
      if (selectedIds.has(candidate.mediaID)) continue

      // Still respect sequence constraint in fallback - no duplicate bursts
      const sequenceId = candidate.sequenceID || null
      if (sequenceId && (sequenceCount.get(sequenceId) || 0) >= maxPerSequence) continue

      selected.push(candidate)
      selectedIds.add(candidate.mediaID)
      if (sequenceId) {
        sequenceCount.set(sequenceId, (sequenceCount.get(sequenceId) || 0) + 1)
      }
    }
  }

  return selected
}

/**
 * Get "best" media files using a hybrid approach:
 * 1. User-marked favorites first (sorted by timestamp descending)
 * 2. Auto-scored captures to fill remaining slots with diversity constraints
 *
 * Scoring formula for non-favorites (weights):
 * - 15%: Bbox area (sweet spot 10-60% of image)
 * - 20%: Fully visible (not cut off at edges)
 * - 15%: Padding (distance to nearest edge)
 * - 15%: Detection confidence
 * - 10%: Classification probability
 * - 15%: Rarity boost (rare species score higher, common species penalized)
 * - 10%: Daytime boost (favor daylight captures)
 *
 * Diversity constraints applied via post-processing:
 * - Max 2 images per species
 * - Max 3 images per deployment
 * - Max 4 images per weekly time bucket
 * - Max 1 image per event/sequence (if eventID exists)
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of media to return (default: 12)
 * @returns {Promise<Array>} - Media files with favorites first, then diverse scored captures
 */
export async function getBestMedia(dbPath, options = {}) {
  const { limit = 12 } = options
  const startTime = Date.now()
  log.info(`Querying best media (hybrid mode) from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    // Step 1: Get user-marked favorites first
    // Note: We need to join observations via both mediaID AND timestamp (for CamTrap DP datasets
    // where observations.mediaID is NULL and link is via eventStart = media.timestamp)
    const favoritesQuery = `
      SELECT
        m.mediaID,
        m.filePath,
        m.fileName,
        m.timestamp,
        m.deploymentID,
        m.fileMediatype,
        m.favorite,
        COALESCE(o1.observationID, o2.observationID) as observationID,
        COALESCE(o1.scientificName, o2.scientificName) as scientificName,
        COALESCE(o1.bboxX, o2.bboxX) as bboxX,
        COALESCE(o1.bboxY, o2.bboxY) as bboxY,
        COALESCE(o1.bboxWidth, o2.bboxWidth) as bboxWidth,
        COALESCE(o1.bboxHeight, o2.bboxHeight) as bboxHeight,
        COALESCE(o1.detectionConfidence, o2.detectionConfidence) as detectionConfidence,
        COALESCE(o1.classificationProbability, o2.classificationProbability) as classificationProbability,
        999.0 as compositeScore
      FROM media m
      -- Strategy 1: Join via mediaID (for ML runs, Wildlife Insights, Deepfaune)
      LEFT JOIN (
        SELECT
          mediaID,
          observationID,
          scientificName,
          bboxX, bboxY, bboxWidth, bboxHeight,
          detectionConfidence,
          classificationProbability,
          ROW_NUMBER() OVER (PARTITION BY mediaID ORDER BY detectionConfidence DESC) as rn
        FROM observations
        WHERE scientificName IS NOT NULL AND scientificName != ''
          AND mediaID IS NOT NULL
      ) o1 ON m.mediaID = o1.mediaID AND o1.rn = 1
      -- Strategy 2: Join via timestamp (for CamTrap DP datasets where mediaID is NULL)
      LEFT JOIN (
        SELECT
          eventStart,
          observationID,
          scientificName,
          bboxX, bboxY, bboxWidth, bboxHeight,
          detectionConfidence,
          classificationProbability,
          ROW_NUMBER() OVER (PARTITION BY eventStart ORDER BY detectionConfidence DESC) as rn
        FROM observations
        WHERE scientificName IS NOT NULL AND scientificName != ''
          AND mediaID IS NULL
      ) o2 ON m.timestamp = o2.eventStart AND o2.rn = 1
      WHERE m.favorite = 1
        AND COALESCE(o1.scientificName, o2.scientificName) IS NOT NULL
      ORDER BY m.timestamp DESC
      LIMIT ?
    `

    const favorites = await executeRawQuery(studyId, dbPath, favoritesQuery, [limit])
    log.info(`Found ${favorites.length} favorites`)

    // If we have enough favorites, return them
    if (favorites.length >= limit) {
      const elapsedTime = Date.now() - startTime
      log.info(`Retrieved ${favorites.length} best media (all favorites) in ${elapsedTime}ms`)
      return favorites
    }

    // Step 2: Get auto-scored non-favorites to fill remaining slots
    const remainingSlots = limit - favorites.length
    const favoriteMediaIDs = favorites.map((f) => f.mediaID)

    // Use stratified sampling: fetch top N candidates per species
    // This ensures every species has candidates for diversity selection,
    // not just the rare species that score higher with rarity boost
    const candidatesPerSpecies = 15

    // Build exclusion clause for already-fetched favorites
    const exclusionClause =
      favoriteMediaIDs.length > 0
        ? `AND m.mediaID NOT IN (${favoriteMediaIDs.map(() => '?').join(', ')})`
        : ''

    // Use raw SQL for complex scoring calculation with species rarity
    const query = `
      WITH
      -- Calculate species counts for rarity scoring
      species_counts AS (
        SELECT scientificName, COUNT(*) as species_total
        FROM observations
        WHERE scientificName IS NOT NULL AND scientificName != ''
          AND (observationType IS NULL OR observationType != 'blank')
        GROUP BY scientificName
      ),
      -- Get max species count for normalization
      max_species_count AS (
        SELECT MAX(species_total) as max_count FROM species_counts
      ),
      scored_observations AS (
        SELECT
          o.mediaID,
          o.observationID,
          o.scientificName,
          o.bboxX,
          o.bboxY,
          o.bboxWidth,
          o.bboxHeight,
          o.detectionConfidence,
          o.classificationProbability,
          o.eventID,
          m.deploymentID,
          m.timestamp,
          -- Calculate bbox area
          (o.bboxWidth * o.bboxHeight) as bboxArea,
          -- Check if fully visible (1 = yes, 0 = no)
          CASE WHEN o.bboxX >= 0 AND o.bboxY >= 0
               AND (o.bboxX + o.bboxWidth) <= 1.0
               AND (o.bboxY + o.bboxHeight) <= 1.0
          THEN 1.0 ELSE 0.0 END as isFullyVisible,
          -- Calculate padding (minimum distance to any edge)
          MIN(o.bboxX, o.bboxY, 1.0 - o.bboxX - o.bboxWidth, 1.0 - o.bboxY - o.bboxHeight) as padding,
          -- Calculate rarity score: rare species get higher scores, common species get lower scores
          -- Formula: 1 - log(species_count) / log(max_count), normalized to 0-1
          -- Common species (count ~= max) -> score ~= 0
          -- Rare species (count << max) -> score ~= 1
          COALESCE(
            CASE
              WHEN sc.species_total IS NULL THEN 0.5
              WHEN sc.species_total <= 1 THEN 1.0
              ELSE MAX(0.0, 1.0 - (LOG(sc.species_total + 1.0) / LOG(COALESCE((SELECT max_count FROM max_species_count), 100.0) + 1.0)))
            END,
            0.5
          ) as rarityScore,
          -- Calculate daytime score: favor captures during daylight hours (6am-6pm)
          -- Extract hour from timestamp and score based on typical daylight
          CASE
            WHEN m.timestamp IS NULL THEN 0.5
            WHEN CAST(strftime('%H', m.timestamp) AS INTEGER) BETWEEN 8 AND 16 THEN 1.0  -- Peak daylight (8am-4pm)
            WHEN CAST(strftime('%H', m.timestamp) AS INTEGER) BETWEEN 6 AND 18 THEN 0.7  -- Extended daylight (6am-6pm)
            ELSE 0.2  -- Night time
          END as daytimeScore
        FROM observations o
        INNER JOIN media m ON o.mediaID = m.mediaID
        LEFT JOIN species_counts sc ON o.scientificName = sc.scientificName
        WHERE o.bboxX IS NOT NULL
          AND o.bboxWidth IS NOT NULL
          AND o.bboxWidth > 0
          AND o.bboxHeight > 0
          AND o.scientificName IS NOT NULL
          AND o.scientificName != ''
          -- Exclude favorites (they're already included)
          AND (m.favorite IS NULL OR m.favorite = 0)
          -- Exclude videos (images only)
          AND (m.fileMediatype IS NULL OR m.fileMediatype NOT LIKE 'video/%')
          -- Exclude blanks
          AND (o.observationType IS NULL OR o.observationType != 'blank')
          -- Exclude humans/persons (case-insensitive)
          AND LOWER(o.scientificName) NOT IN ('homo sapiens', 'human', 'person', 'people')
          AND LOWER(o.scientificName) NOT LIKE '%human%'
          AND LOWER(o.scientificName) NOT LIKE '%person%'
          -- Exclude vehicles
          AND LOWER(o.scientificName) NOT IN ('vehicle', 'car', 'truck', 'motorcycle', 'bike', 'bicycle')
          AND LOWER(o.scientificName) NOT LIKE '%vehicle%'
          -- Exclude "other" class
          AND LOWER(o.scientificName) != 'other'
          ${exclusionClause}
      ),
      scored_with_formula AS (
        SELECT
          *,
          -- Final composite score with rarity and daytime boost
          (
            -- Area component (15%) - sweet spot 10-60%
            CASE
              WHEN bboxArea < 0.05 THEN bboxArea / 0.05 * 0.3
              WHEN bboxArea < 0.10 THEN 0.3 + (bboxArea - 0.05) / 0.05 * 0.3
              WHEN bboxArea <= 0.60 THEN 0.6 + (bboxArea - 0.10) / 0.50 * 0.4
              WHEN bboxArea <= 0.90 THEN 1.0 - (bboxArea - 0.60) / 0.30 * 0.3
              ELSE 0.7 - (bboxArea - 0.90) / 0.10 * 0.4
            END * 0.15
            -- Visibility component (20%)
            + isFullyVisible * 0.20
            -- Padding component (15%), capped at padding >= 0.20
            + MIN(MAX(padding, 0) * 5, 1.0) * 0.15
            -- Detection confidence (15%)
            + COALESCE(detectionConfidence, 0.5) * 0.15
            -- Classification probability (10%)
            + COALESCE(classificationProbability, 0.5) * 0.10
            -- Rarity boost (15%) - rare species get higher scores
            + rarityScore * 0.15
            -- Daytime boost (10%) - favor daylight captures
            + daytimeScore * 0.10
          ) as compositeScore
        FROM scored_observations
      ),
      -- Get best observation per media (avoid duplicates)
      best_per_media AS (
        SELECT
          mediaID,
          observationID,
          scientificName,
          bboxX, bboxY, bboxWidth, bboxHeight,
          detectionConfidence, classificationProbability,
          eventID,
          deploymentID, timestamp,
          compositeScore,
          ROW_NUMBER() OVER (PARTITION BY mediaID ORDER BY compositeScore DESC) as rn
        FROM scored_with_formula
      ),
      -- Filter to one observation per media
      unique_media AS (
        SELECT * FROM best_per_media WHERE rn = 1
      ),
      -- Stratified sampling: rank within each species to ensure all species are represented
      -- This prevents rare species from dominating due to rarity boost
      ranked_per_species AS (
        SELECT
          *,
          ROW_NUMBER() OVER (PARTITION BY scientificName ORDER BY compositeScore DESC) as species_rank
        FROM unique_media
      )
      SELECT
        m.mediaID,
        m.filePath,
        m.fileName,
        m.timestamp,
        m.deploymentID,
        m.fileMediatype,
        m.favorite,
        r.observationID,
        r.scientificName,
        r.bboxX,
        r.bboxY,
        r.bboxWidth,
        r.bboxHeight,
        r.detectionConfidence,
        r.classificationProbability,
        r.eventID,
        r.compositeScore
      FROM ranked_per_species r
      INNER JOIN media m ON r.mediaID = m.mediaID
      WHERE r.species_rank <= ?
      ORDER BY r.compositeScore DESC
    `

    // Build query parameters: favoriteMediaIDs (for exclusion) + candidatesPerSpecies (for stratified sampling)
    const queryParams = [...favoriteMediaIDs, candidatesPerSpecies]
    const scoredCandidates = await executeRawQuery(studyId, dbPath, query, queryParams)

    // Assign sequence IDs using 120s gap threshold (same as media tab)
    // This groups media by timestamp proximity within same deployment
    const candidatesWithSequences = assignSequenceIDs(scoredCandidates, 120)

    // Step 3: Apply diversity selection to scored candidates
    // This ensures variety in species, deployments, time periods, and sequences
    const diverseResults = selectDiverseMedia(candidatesWithSequences, remainingSlots, {
      maxPerSpecies: 2,
      maxPerDeployment: 3,
      maxPerTemporalBucket: 4,
      maxPerSequence: 1, // No duplicate images from same sequence/burst
      temporalBucketDays: 7,
      minQualityThreshold: 0.3
    })

    // Step 4: Combine favorites + diverse scored results
    const combinedResults = [...favorites, ...diverseResults]

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved ${combinedResults.length} best media (${favorites.length} favorites + ${diverseResults.length} diverse from ${scoredCandidates.length} candidates) in ${elapsedTime}ms`
    )

    return combinedResults
  } catch (error) {
    log.error(`Error querying best media: ${error.message}`)
    throw error
  }
}
