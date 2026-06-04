/**
 * Sequence-related database queries
 *
 * Provides cursor-based pagination for sequence grouping in the main process.
 */

import { getDrizzleDb } from '../manager.js'
import { deployments, media, observations } from '../models.js'
import {
  eq,
  and,
  sql,
  isNotNull,
  ne,
  inArray,
  gte,
  gt,
  lte,
  lt,
  isNull,
  or,
  like,
  exists,
  notExists
} from 'drizzle-orm'
import { union } from 'drizzle-orm/sqlite-core'
import log from '../../services/logger.js'
import { isAreaBboxApplicable } from './bbox.js'
import { getStudyIdFromPath } from './utils.js'
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'

/**
 * Normalize the timeRange filter into an array of {start, end} ranges.
 * Accepts:
 *   - undefined / null / {} → no filter, returns []
 *   - { start, end }        → legacy single-range shape, returns [{start, end}]
 *   - { ranges: [...] }     → new multi-range shape, passed through
 *
 * Empty ranges means "no time-of-day filter".
 */
export function normalizeTimeRange(timeRange) {
  if (!timeRange) return []
  if (Array.isArray(timeRange.ranges)) return timeRange.ranges
  if (timeRange.start !== undefined && timeRange.end !== undefined) {
    return [{ start: timeRange.start, end: timeRange.end }]
  }
  return []
}

/**
 * Build a SQL condition for a single {start, end} hour range against
 * media.timestamp. Half-open [start, end). Returns null when start === end
 * (zero-width range, no rows match — caller should drop it).
 *
 * Wrap-around (start > end) is OR'd: hour >= start OR hour < end.
 */
export function buildHourRangeCondition(range) {
  const { start, end } = range
  if (start === end) return null
  if (start < end) {
    return and(
      sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${start}`,
      sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${end}`
    )
  }
  return or(
    sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${start}`,
    sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${end}`
  )
}

/**
 * Build an equality / IN condition for a column that accepts either a single
 * value or an array of values. Returns null when there's nothing to filter
 * (null/undefined, or an empty array), so callers can skip pushing it.
 */
export function eqOrIn(column, value) {
  if (value == null) return null
  if (Array.isArray(value)) return value.length ? inArray(column, value) : null
  return eq(column, value)
}

// Condition matching media.fileMediatype against the selected high-level types
// ('image' → 'image/%', 'video' → 'video/%'). Empty / all-selected → null (no
// filter). Returns an OR when more than one prefix is active.
export function buildMediaTypeCondition(mediaTypes) {
  const prefixes = (Array.isArray(mediaTypes) ? mediaTypes : [])
    .map((t) => (t === 'video' ? 'video/%' : t === 'image' ? 'image/%' : null))
    .filter(Boolean)
  if (prefixes.length === 0) return null
  if (prefixes.length === 1) return like(media.fileMediatype, prefixes[0])
  return or(...prefixes.map((p) => like(media.fileMediatype, p)))
}

/**
 * Build WHERE conditions for the Media tab "quick view" filters that act on a
 * media row via correlated subqueries over its observations. Returns an array
 * of drizzle conditions to AND into a phase's condition list (works for both
 * the timestamped and null-timestamp phases — none of these reference the
 * timestamp). Used by getMediaForSequencePagination and hasTimestampedMedia.
 *
 * @param {object} opts
 * @param {boolean} [opts.favorite] - only favorited media
 * @returns {Array} drizzle conditions
 */
export function buildQuickViewConditions(opts = {}) {
  const { favorite = false } = opts
  const conditions = []

  if (favorite) {
    conditions.push(eq(media.favorite, true))
  }

  return conditions
}

/**
 * Get media for sequence pagination with cursor support.
 * Returns media ordered by timestamp DESC, filtered by species/date/time.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} options - Query options
 * @param {Object} options.cursor - Cursor object (null for first page)
 * @param {string} options.cursor.phase - 'timestamped' or 'null'
 * @param {string} options.cursor.t - Timestamp for cursor position (timestamped phase)
 * @param {string} options.cursor.m - Media ID for cursor position (timestamped phase)
 * @param {number} options.cursor.offset - Offset for null-timestamp phase
 * @param {number} options.batchSize - Number of media items to fetch
 * @param {Array<string>} options.species - Species filter (optional)
 * @param {Object} options.dateRange - Date range filter (optional)
 * @param {Object} options.timeRange - Time of day range filter (optional)
 * @param {string} [options.deploymentID] - If set, only media for this deploymentID
 * @returns {Promise<{ media: Array, hasMoreTimestamped: boolean, hasMoreNull: boolean }>}
 */
export async function getMediaForSequencePagination(dbPath, options = {}) {
  const {
    cursor = null,
    batchSize = 200,
    species = [],
    dateRange = {},
    timeRange = {},
    deploymentID = null,
    bbox = null,
    source = null,
    mediaTypes = [],
    sort = 'newest',
    favorite = false,
    hideBlank = false
  } = options

  // Timestamped phase ordering: 'newest' (default) walks time descending;
  // 'oldest' walks ascending. The cursor comparison flips to match so
  // pagination continues in the chosen direction.
  const isOldest = sort === 'oldest'
  const cursorCmp = isOldest ? gt : lt
  const orderClause = isOldest
    ? sql`${media.timestamp} ASC, ${media.mediaID} ASC`
    : sql`${media.timestamp} DESC, ${media.mediaID} DESC`
  const orderClauseAliased = isOldest
    ? sql`timestamp ASC, mediaID ASC`
    : sql`timestamp DESC, mediaID DESC`

  const startTime = Date.now()
  const phase = cursor?.phase || 'timestamped'
  log.info(`[Sequences] Fetching media for pagination (phase: ${phase}, batchSize: ${batchSize})`)

  // Optional area filter on the joined deployments row (lat/lng BETWEEN the
  // box). Deployments without coordinates fail the BETWEEN and drop out, which
  // matches the map (coordinate-less deployments have no marker). Every query
  // arm below joins `deployments`, so this condition is always resolvable.
  const bboxCondition = isAreaBboxApplicable(bbox)
    ? and(
        gte(deployments.latitude, bbox.south),
        lte(deployments.latitude, bbox.north),
        gte(deployments.longitude, bbox.west),
        lte(deployments.longitude, bbox.east)
      )
    : null

  // Deployment / source filters accept a single value or an array; build the
  // condition once and reuse across the timestamped and null-phase arms.
  const deploymentCond = eqOrIn(media.deploymentID, deploymentID)
  const sourceCond = eqOrIn(media.importFolder, source)
  const mediaTypeCond = buildMediaTypeCondition(mediaTypes)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    // Check if requesting pseudo-species buckets. "Blank" now means "media
    // without any animal/human/vehicle observation" (covers zero-obs media
    // AND media whose only observations are blank/unclassified/unknown-typed
    // empty-species rows). "Vehicle" is media with at least one
    // observationType='vehicle' observation.
    const requestingBlanks = species.includes(BLANK_SENTINEL)
    const requestingVehicle = species.includes(VEHICLE_SENTINEL)
    const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL && s !== VEHICLE_SENTINEL)

    // "Blank" must mean the SAME thing as the unfiltered table: a whole
    // sequence with NO detection. So for a pure-Blank request we fetch ALL
    // timestamped media (each tagged with isDetection) and group them normally;
    // the pagination layer then keeps only the no-detection sequences. Filtering
    // to blank MEDIA first would instead regroup just the empty frames and split
    // mixed bursts into extra "blank" sequences (over-counting vs the table).
    const blankSequenceMode = requestingBlanks && !requestingVehicle && regularSpecies.length === 0

    // "Detections" (hide blank) is the mirror of Blank: fetch ALL media tagged
    // with isDetection and let the pagination layer keep only the sequences that
    // DO contain a detection. Only meaningful with no explicit species filter.
    const detectionSequenceMode =
      hideBlank === true && !requestingBlanks && !requestingVehicle && regularSpecies.length === 0
    // Both modes need the isDetection flag on every row.
    const wantDetectionFlag = blankSequenceMode || detectionSequenceMode

    // Date range filter (only applies to timestamped phase)
    let startDate, endDate
    if (dateRange.start && dateRange.end) {
      startDate = dateRange.start instanceof Date ? dateRange.start.toISOString() : dateRange.start
      endDate = dateRange.end instanceof Date ? dateRange.end.toISOString() : dateRange.end
      log.info(`[Sequences] Date range: ${startDate} to ${endDate}`)
    }

    // Time of day filter (only applies to timestamped media). Empty array
    // means no filter; multiple ranges are unioned with OR.
    const timeRanges = normalizeTimeRange(timeRange)
    const hasTimeFilter = timeRanges.length > 0

    // Pick one observation's eventID for a media via correlated subquery —
    // needed by sequence grouping when the dataset uses eventID-based
    // grouping (sequenceGap === null). Cheap: indexed mediaID lookup +
    // LIMIT 1. Returns NULL when the media has no observations (e.g.
    // blanks).
    const eventIDPicker = db
      .select({ value: observations.eventID })
      .from(observations)
      .where(eq(observations.mediaID, media.mediaID))
      .orderBy(observations.observationID)
      .limit(1)

    // Select fields for all queries
    const selectFields = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      locationID: deployments.locationID,
      locationName: deployments.locationName,
      scientificName: sql`NULL`.as('scientificName'),
      fileMediatype: media.fileMediatype,
      eventID: sql`(${eventIDPicker})`.as('eventID'),
      favorite: media.favorite
    }

    // Vehicle arm: same shape as selectFields but tags rows with the
    // VEHICLE_SENTINEL so renderers can label them "Vehicle" instead of
    // falling back to "Blank" (the default for null scientificName).
    const selectFieldsVehicle = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      locationID: deployments.locationID,
      locationName: deployments.locationName,
      scientificName: sql`${VEHICLE_SENTINEL}`.as('scientificName'),
      fileMediatype: media.fileMediatype,
      eventID: sql`(${eventIDPicker})`.as('eventID'),
      favorite: media.favorite
    }

    const selectFieldsWithObs = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      locationID: deployments.locationID,
      locationName: deployments.locationName,
      scientificName: observations.scientificName,
      fileMediatype: media.fileMediatype,
      eventID: observations.eventID,
      favorite: media.favorite
    }

    // Correlated subquery: returns 1 when the media has any "real"
    // observation (animal/human with a species name, OR vehicle). The
    // `notExists(realObservations)` pattern below identifies blank media.
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

    // All-media projection plus an isDetection flag (0/1) — used by the
    // Blank-sequence path so the pagination layer can drop sequences that
    // contain any detection.
    const selectFieldsWithDetection = {
      ...selectFields,
      isDetection: sql`(CASE WHEN ${exists(realObservations)} THEN 1 ELSE 0 END)`.as('isDetection')
    }

    // Correlated subquery: returns 1 when the media has any vehicle
    // observation. Used by the Vehicle pseudo-species filter.
    const vehicleObservations = db
      .select({ one: sql`1` })
      .from(observations)
      .where(
        and(eq(observations.mediaID, media.mediaID), eq(observations.observationType, 'vehicle'))
      )

    // Arm-builders for the union pattern. Used when a request mixes regular
    // species with the Blank/Vehicle pseudo-species. Each arm produces rows
    // shaped to match `selectFields` so they can be unioned together.
    // Pure regular-species requests (no Blank/Vehicle) take the optimized
    // semi-join path below instead — the union path doesn't get the same
    // index short-circuit.
    const buildSpeciesArm = (extraConds) =>
      db
        .selectDistinct(selectFieldsWithObs)
        .from(media)
        .innerJoin(observations, eq(media.mediaID, observations.mediaID))
        .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
        .where(
          and(
            ...extraConds,
            isNotNull(observations.scientificName),
            ne(observations.scientificName, ''),
            inArray(observations.scientificName, regularSpecies)
          )
        )

    const buildBlankArm = (extraConds) =>
      db
        .selectDistinct(selectFields)
        .from(media)
        .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
        .where(and(...extraConds, notExists(realObservations)))

    const buildVehicleArm = (extraConds) =>
      db
        .selectDistinct(selectFieldsVehicle)
        .from(media)
        .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
        .where(and(...extraConds, exists(vehicleObservations)))

    // Returns an array of arm queries for the requested filter combination.
    // Caller is responsible for unioning + ordering + limiting.
    const collectArms = (extraConds) => {
      const arms = []
      if (regularSpecies.length > 0) arms.push(buildSpeciesArm(extraConds))
      if (requestingBlanks) arms.push(buildBlankArm(extraConds))
      if (requestingVehicle) arms.push(buildVehicleArm(extraConds))
      return arms
    }

    // Drizzle's union dedups on full-row equality, but the species arm
    // emits selectFieldsWithObs (real scientificName) while blank/vehicle
    // arms emit selectFields (NULL or VEHICLE_SENTINEL) — so a media that
    // matches both arms produces two non-equal rows. We dedup by mediaID
    // post-fetch with an explicit priority so the species-arm row wins
    // over the vehicle-arm row when both exist for the same media (giving
    // the gallery card a real species label, not "Vehicle").
    //
    // SQLite UNION + ORDER BY does NOT guarantee per-arm ordering, so a
    // first-seen-wins dedup based on row order is implementation-defined.
    // Hence the explicit priority below.
    const armPriority = (row) => {
      if (row.scientificName === VEHICLE_SENTINEL) return 1
      if (row.scientificName == null) return 2 // blank arm — NULL scientificName
      return 0 // species arm — real scientificName wins
    }
    const dedupByMediaID = (rows) => {
      const byID = new Map()
      for (const r of rows) {
        const existing = byID.get(r.mediaID)
        if (!existing || armPriority(r) < armPriority(existing)) {
          byID.set(r.mediaID, r)
        }
      }
      return [...byID.values()]
    }

    // Oversample factor for the union path: when 2+ arms are active a
    // single media can produce N rows in the raw fetch, eating LIMIT
    // slots before JS-side dedup runs. Oversampling by `arms.length` is
    // the worst-case bound — every media in the page has the maximum
    // possible duplicate count. Single-arm calls (the common case)
    // skip oversampling entirely.
    const oversampleFactor = (armsLen) => Math.max(1, armsLen)

    // Phase 1: Timestamped media
    if (phase === 'timestamped') {
      const timestampedConditions = [isNotNull(media.timestamp)]

      // Apply deployment filter (covers all species variants below via shared and(...))
      if (deploymentCond) timestampedConditions.push(deploymentCond)

      // Apply source (importFolder) filter
      if (sourceCond) timestampedConditions.push(sourceCond)

      // Apply media-type filter (image / video)
      if (mediaTypeCond) timestampedConditions.push(mediaTypeCond)

      // Apply quick-view filters (favorite)
      timestampedConditions.push(...buildQuickViewConditions({ favorite }))

      // Apply area (bbox) filter on the joined deployment location
      if (bboxCondition) {
        timestampedConditions.push(bboxCondition)
      }

      // Apply date range filter
      if (startDate && endDate) {
        timestampedConditions.push(gte(media.timestamp, startDate))
        timestampedConditions.push(lte(media.timestamp, endDate))
      }

      // Apply time of day filter — OR of per-range conditions.
      if (hasTimeFilter) {
        const rangeConditions = timeRanges.map(buildHourRangeCondition).filter(Boolean)
        if (rangeConditions.length === 1) {
          timestampedConditions.push(rangeConditions[0])
        } else if (rangeConditions.length > 1) {
          timestampedConditions.push(or(...rangeConditions))
        }
      }

      // Apply cursor position. Comparison direction follows the sort: for
      // 'newest' (descending) we fetch items strictly before the cursor; for
      // 'oldest' (ascending) we fetch items strictly after it.
      if (cursor?.t) {
        timestampedConditions.push(
          or(
            cursorCmp(media.timestamp, cursor.t),
            and(eq(media.timestamp, cursor.t), cursorCmp(media.mediaID, cursor.m))
          )
        )
      }

      let timestampedMedia = []

      // Build query based on species filter
      if (species.length === 0 || blankSequenceMode) {
        // No species filter (or pure-Blank / Detections): get all media. Blank
        // and Detections modes also tag each row with isDetection so the caller
        // can keep only the no-detection (Blank) or with-detection (Detections)
        // sequences.
        timestampedMedia = await db
          .selectDistinct(wantDetectionFlag ? selectFieldsWithDetection : selectFields)
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(and(...timestampedConditions))
          .orderBy(orderClause)
          .limit(batchSize)
      } else if (requestingBlanks || requestingVehicle) {
        // Mix of regular species + Blank/Vehicle pseudo-species, or
        // pure pseudo-species request. Union the appropriate arms.
        const arms = collectArms(timestampedConditions)
        const unioned = arms.length === 1 ? arms[0] : union(...arms)
        // Oversample to absorb cross-arm duplicates (a media matching both
        // the species and vehicle arms shows up twice in the raw union).
        // Without this, dedup undercounts the page and hasMoreTimestamped
        // can falsely report exhaustion.
        const fetchLimit = batchSize * oversampleFactor(arms.length)
        const raw = await unioned.orderBy(orderClauseAliased).limit(fetchLimit)
        timestampedMedia = dedupByMediaID(raw).slice(0, batchSize)
      } else {
        // Regular species query — rewritten as a semi-join (EXISTS).
        //
        // Previous INNER JOIN + SELECT DISTINCT + ORDER BY + LIMIT forced SQLite
        // to materialise the entire species×media cross-product (e.g. 758k rows
        // for "Sus scrofa" on gmu8_leuven), sort it via a temp b-tree, and only
        // then apply LIMIT — ~2.7s per page.
        //
        // With EXISTS the planner walks media in (timestamp, mediaID) order via
        // idx_media_timestamp, checks the observation predicate per row, and
        // can short-circuit at LIMIT — ~12ms on the same study.
        //
        // scientificName / eventID used to come from the joined observation.
        // Here we pick one matching observation per media via correlated
        // subqueries, so the shape of the returned row is unchanged.
        // Deterministic ORDER BY ensures scientificName and eventID come
        // from the same observation row on a media with multiple matching
        // observations. Without this, two independent LIMIT-1 subqueries
        // can silently return fields from different rows.
        const speciesPicker = (column) =>
          db
            .select({ value: column })
            .from(observations)
            .where(
              and(
                eq(observations.mediaID, media.mediaID),
                inArray(observations.scientificName, regularSpecies)
              )
            )
            .orderBy(observations.observationID)
            .limit(1)

        timestampedMedia = await db
          .select({
            mediaID: media.mediaID,
            filePath: media.filePath,
            fileName: media.fileName,
            timestamp: media.timestamp,
            deploymentID: media.deploymentID,
            locationID: deployments.locationID,
            locationName: deployments.locationName,
            scientificName: sql`(${speciesPicker(observations.scientificName)})`.as(
              'scientificName'
            ),
            fileMediatype: media.fileMediatype,
            eventID: sql`(${speciesPicker(observations.eventID)})`.as('eventID'),
            favorite: media.favorite
          })
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(
            and(
              ...timestampedConditions,
              exists(
                db
                  .select({ one: sql`1` })
                  .from(observations)
                  .where(
                    and(
                      eq(observations.mediaID, media.mediaID),
                      inArray(observations.scientificName, regularSpecies)
                    )
                  )
              )
            )
          )
          .orderBy(orderClause)
          .limit(batchSize)
      }

      // Check if there's more timestamped media
      const hasMoreTimestamped = timestampedMedia.length === batchSize

      // Check if there's any null-timestamp media (for phase transition)
      let hasMoreNull = false
      if (timestampedMedia.length < batchSize) {
        // We've exhausted timestamped media, check for null-timestamp media
        const nullConditions = [isNull(media.timestamp)]
        if (deploymentCond) nullConditions.push(deploymentCond)
        if (sourceCond) nullConditions.push(sourceCond)
        if (mediaTypeCond) nullConditions.push(mediaTypeCond)
        nullConditions.push(...buildQuickViewConditions({ favorite }))
        if (bboxCondition) {
          nullConditions.push(bboxCondition)
        }

        let nullCountResult
        if (detectionSequenceMode) {
          // Detections: a null-timestamp media is its own sequence, kept only
          // if it has a real observation.
          nullCountResult = await db
            .select({ count: sql`COUNT(DISTINCT ${media.mediaID})`.as('count') })
            .from(media)
            .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
            .where(and(...nullConditions, exists(realObservations)))
        } else if (species.length === 0) {
          nullCountResult = await db
            .select({ count: sql`COUNT(DISTINCT ${media.mediaID})`.as('count') })
            .from(media)
            // join needed when bboxCondition references deployment columns
            .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
            .where(and(...nullConditions))
        } else if (requestingBlanks || requestingVehicle) {
          // hasMoreNull only needs "any match?" so probe each arm with
          // LIMIT 1 instead of materializing the full union (which would
          // pull millions of null-timestamp rows on image-only studies
          // like 1378cb43 just to take .length).
          const arms = collectArms(nullConditions)
          const probes = await Promise.all(arms.map((arm) => arm.limit(1)))
          const anyMatch = probes.some((rows) => rows.length > 0)
          nullCountResult = [{ count: anyMatch ? 1 : 0 }]
        } else {
          nullCountResult = await db
            .select({ count: sql`COUNT(DISTINCT ${media.mediaID})`.as('count') })
            .from(media)
            .innerJoin(observations, eq(media.mediaID, observations.mediaID))
            // join needed when bboxCondition references deployment columns
            .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
            .where(
              and(
                ...nullConditions,
                isNotNull(observations.scientificName),
                ne(observations.scientificName, ''),
                inArray(observations.scientificName, regularSpecies)
              )
            )
        }

        hasMoreNull = (nullCountResult[0]?.count || 0) > 0
      }

      const elapsedTime = Date.now() - startTime
      log.info(
        `[Sequences] Retrieved ${timestampedMedia.length} timestamped media in ${elapsedTime}ms`
      )

      return {
        media: timestampedMedia,
        hasMoreTimestamped,
        hasMoreNull
      }
    }

    // Phase 2: Null-timestamp media
    if (phase === 'null') {
      const offset = cursor?.offset || 0
      const nullConditions = [isNull(media.timestamp)]

      // Apply deployment filter (covers all species variants below via shared and(...))
      if (deploymentCond) nullConditions.push(deploymentCond)

      // Apply source (importFolder) filter
      if (sourceCond) nullConditions.push(sourceCond)

      // Apply media-type filter (image / video)
      if (mediaTypeCond) nullConditions.push(mediaTypeCond)

      // Apply quick-view filters (favorite)
      nullConditions.push(...buildQuickViewConditions({ favorite }))

      // Apply area (bbox) filter on the joined deployment location
      if (bboxCondition) {
        nullConditions.push(bboxCondition)
      }

      let nullMedia = []

      if (detectionSequenceMode) {
        // Detections: null-timestamp media that have a real observation (each
        // is its own single-item detection sequence).
        nullMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(and(...nullConditions, exists(realObservations)))
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
      } else if (species.length === 0) {
        nullMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(and(...nullConditions))
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
      } else if (requestingBlanks || requestingVehicle) {
        const arms = collectArms(nullConditions)
        const unioned = arms.length === 1 ? arms[0] : union(...arms)
        const fetchLimit = batchSize * oversampleFactor(arms.length)
        const raw = await unioned
          .orderBy(sql`mediaID DESC`)
          .limit(fetchLimit)
          .offset(offset)
        nullMedia = dedupByMediaID(raw).slice(0, batchSize)
      } else {
        // Regular species query — semi-join rewrite (see timestamped phase
        // for rationale and expected speedup).
        // Deterministic ORDER BY ensures scientificName and eventID come
        // from the same observation row on a media with multiple matching
        // observations. Without this, two independent LIMIT-1 subqueries
        // can silently return fields from different rows.
        const speciesPicker = (column) =>
          db
            .select({ value: column })
            .from(observations)
            .where(
              and(
                eq(observations.mediaID, media.mediaID),
                inArray(observations.scientificName, regularSpecies)
              )
            )
            .orderBy(observations.observationID)
            .limit(1)

        nullMedia = await db
          .select({
            mediaID: media.mediaID,
            filePath: media.filePath,
            fileName: media.fileName,
            timestamp: media.timestamp,
            deploymentID: media.deploymentID,
            locationID: deployments.locationID,
            locationName: deployments.locationName,
            scientificName: sql`(${speciesPicker(observations.scientificName)})`.as(
              'scientificName'
            ),
            fileMediatype: media.fileMediatype,
            eventID: sql`(${speciesPicker(observations.eventID)})`.as('eventID'),
            favorite: media.favorite
          })
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(
            and(
              ...nullConditions,
              exists(
                db
                  .select({ one: sql`1` })
                  .from(observations)
                  .where(
                    and(
                      eq(observations.mediaID, media.mediaID),
                      inArray(observations.scientificName, regularSpecies)
                    )
                  )
              )
            )
          )
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
      }

      const hasMoreNull = nullMedia.length === batchSize

      const elapsedTime = Date.now() - startTime
      log.info(
        `[Sequences] Retrieved ${nullMedia.length} null-timestamp media (offset: ${offset}) in ${elapsedTime}ms`
      )

      return {
        media: nullMedia,
        hasMoreTimestamped: false,
        hasMoreNull
      }
    }

    // Invalid phase
    throw new Error(`Invalid cursor phase: ${phase}`)
  } catch (error) {
    log.error(`[Sequences] Error fetching media for pagination: ${error.message}`)
    throw error
  }
}

/**
 * Check if there are any timestamped media matching the filters
 * Used to determine initial phase
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} options - Filter options
 * @returns {Promise<boolean>}
 */
export async function hasTimestampedMedia(dbPath, options = {}) {
  const {
    species = [],
    dateRange = {},
    timeRange = {},
    deploymentID = null,
    source = null,
    mediaTypes = [],
    favorite = false
  } = options

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    const requestingBlanks = species.includes(BLANK_SENTINEL)
    const requestingVehicle = species.includes(VEHICLE_SENTINEL)
    const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL && s !== VEHICLE_SENTINEL)

    const conditions = [isNotNull(media.timestamp)]

    const deploymentCond = eqOrIn(media.deploymentID, deploymentID)
    if (deploymentCond) conditions.push(deploymentCond)

    const sourceCond = eqOrIn(media.importFolder, source)
    if (sourceCond) conditions.push(sourceCond)

    const mediaTypeCond = buildMediaTypeCondition(mediaTypes)
    if (mediaTypeCond) conditions.push(mediaTypeCond)

    conditions.push(...buildQuickViewConditions({ favorite }))

    // Apply date range
    if (dateRange.start && dateRange.end) {
      const startDate =
        dateRange.start instanceof Date ? dateRange.start.toISOString() : dateRange.start
      const endDate = dateRange.end instanceof Date ? dateRange.end.toISOString() : dateRange.end
      conditions.push(gte(media.timestamp, startDate))
      conditions.push(lte(media.timestamp, endDate))
    }

    // Apply time range — same OR-of-ranges semantics as the paginated query.
    const timeRanges = normalizeTimeRange(timeRange)
    if (timeRanges.length > 0) {
      const rangeConditions = timeRanges.map(buildHourRangeCondition).filter(Boolean)
      if (rangeConditions.length === 1) {
        conditions.push(rangeConditions[0])
      } else if (rangeConditions.length > 1) {
        conditions.push(or(...rangeConditions))
      }
    }

    // Correlated subquery: returns 1 when the media has any "real"
    // observation (animal/human with a species name, OR vehicle).
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

    // Correlated subquery: returns 1 when the media has any vehicle observation.
    const vehicleObservations = db
      .select({ one: sql`1` })
      .from(observations)
      .where(
        and(eq(observations.mediaID, media.mediaID), eq(observations.observationType, 'vehicle'))
      )

    // Existence check per arm. Short-circuit: any arm hit → true.
    const speciesArmExists = async () =>
      (
        await db
          .select({ exists: sql`1` })
          .from(media)
          .innerJoin(observations, eq(media.mediaID, observations.mediaID))
          .where(
            and(
              ...conditions,
              isNotNull(observations.scientificName),
              ne(observations.scientificName, ''),
              inArray(observations.scientificName, regularSpecies)
            )
          )
          .limit(1)
      ).length > 0

    const blankArmExists = async () =>
      (
        await db
          .select({ exists: sql`1` })
          .from(media)
          .where(and(...conditions, notExists(realObservations)))
          .limit(1)
      ).length > 0

    const vehicleArmExists = async () =>
      (
        await db
          .select({ exists: sql`1` })
          .from(media)
          .where(and(...conditions, exists(vehicleObservations)))
          .limit(1)
      ).length > 0

    if (species.length === 0) {
      const result = await db
        .select({ exists: sql`1` })
        .from(media)
        .where(and(...conditions))
        .limit(1)
      return result.length > 0
    }

    if (regularSpecies.length > 0 && (await speciesArmExists())) return true
    if (requestingBlanks && (await blankArmExists())) return true
    if (requestingVehicle && (await vehicleArmExists())) return true
    return false
  } catch (error) {
    log.error(`[Sequences] Error checking for timestamped media: ${error.message}`)
    throw error
  }
}
