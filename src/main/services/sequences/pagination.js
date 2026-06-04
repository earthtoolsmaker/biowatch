/**
 * Sequence pagination service
 *
 * Handles paginated sequence retrieval with two-phase cursor-based pagination:
 * 1. Timestamped media (grouped into sequences by timestamp proximity)
 * 2. Null-timestamp media (each item is its own sequence)
 */

import log from '../logger.js'
import { groupMediaIntoSequences, groupMediaByEventID } from './grouping.js'
import {
  getMediaForSequencePagination,
  hasTimestampedMedia
} from '../../database/queries/sequences.js'
import { BLANK_SENTINEL } from '../../../shared/constants.js'

/**
 * Default batch size for fetching media from DB
 * We fetch more than the sequence limit to ensure we can detect sequence boundaries
 */
const DEFAULT_BATCH_SIZE = 200

/**
 * Encode cursor to base64 string
 * @param {Object} cursor - Cursor object
 * @returns {string} Base64 encoded cursor
 */
function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64')
}

/**
 * Decode cursor from base64 string
 * @param {string} cursorStr - Base64 encoded cursor
 * @returns {Object|null} Decoded cursor object or null
 */
function decodeCursor(cursorStr) {
  if (!cursorStr) return null
  try {
    return JSON.parse(Buffer.from(cursorStr, 'base64').toString('utf-8'))
  } catch {
    log.warn('[Sequences] Invalid cursor format, starting from beginning')
    return null
  }
}

/**
 * Check if media is a video based on fileMediatype
 * @param {Object} media - Media object
 * @returns {boolean}
 */
function isVideoMedia(media) {
  if (!media.fileMediatype) return false
  return media.fileMediatype.startsWith('video/')
}

/**
 * Get paginated sequences from the database
 *
 * The pagination uses a two-phase approach:
 * 1. First, return all timestamped sequences (grouped by timestamp proximity or eventID)
 * 2. Then, return null-timestamp media (each as individual sequences)
 *
 * The look-ahead approach ensures sequence boundaries are correctly detected:
 * - We fetch more media than needed (batchSize > what we need for `limit` sequences)
 * - The last sequence in a batch might be incomplete (more media could belong to it)
 * - We only return sequences that we know are complete (have seen their boundary)
 *
 * @param {string} dbPath - Path to the study database
 * @param {Object} options - Pagination options
 * @param {number|null} options.gapSeconds - Gap threshold for grouping (null = eventID grouping)
 * @param {number} options.limit - Maximum number of sequences to return (default: 20)
 * @param {string|null} options.cursor - Opaque cursor string from previous response
 * @param {Object} options.filters - Filter options
 * @param {Array<string>} options.filters.species - Species to filter by
 * @param {Object} options.filters.dateRange - Date range { start, end }
 * @param {Object} options.filters.timeRange - Time range { start, end } (hours)
 * @returns {Promise<{ sequences: Array, nextCursor: string|null, hasMore: boolean }>}
 */
export async function getPaginatedSequences(dbPath, options = {}) {
  const {
    gapSeconds = 60,
    limit = 20,
    cursor: cursorStr = null,
    filters = {},
    sort = 'newest'
  } = options

  const {
    species = [],
    dateRange = {},
    timeRange = {},
    deploymentID = null,
    bbox = null,
    source = null,
    mediaTypes = [],
    favorite = false,
    hideBlank = false,
    onlyNullTimestamps = false
  } = filters

  // Bundle the quick-view, media-row filters so they thread through the fetch
  // helpers and into the DB query as a single unit.
  const quickView = { favorite }

  // Pure-Blank request: keep only whole no-detection sequences so "Blank"
  // matches the unfiltered table (see getMediaForSequencePagination).
  const blankSequenceMode =
    species.includes(BLANK_SENTINEL) && species.every((s) => s === BLANK_SENTINEL)
  // "Detections" (hide blank): the mirror — keep only sequences WITH a
  // detection. Only when no explicit species filter is set.
  const detectionSequenceMode = hideBlank === true && species.length === 0

  const startTime = Date.now()
  log.info(`[Sequences] Getting paginated sequences (limit: ${limit}, gapSeconds: ${gapSeconds})`)

  // Decode cursor
  const cursor = decodeCursor(cursorStr)
  let phase = cursor?.phase || 'timestamped'

  // The "No timestamp" quick view restricts to null-timestamp media only, so
  // skip the timestamped phase entirely.
  if (onlyNullTimestamps) {
    phase = 'null'
  } else if (!cursor) {
    // If no cursor, check if we should start in null phase (no timestamped media)
    const hasTimestamped = await hasTimestampedMedia(dbPath, {
      species,
      dateRange,
      timeRange,
      deploymentID,
      source,
      mediaTypes,
      ...quickView
    })
    if (!hasTimestamped) {
      log.info('[Sequences] No timestamped media, starting in null phase')
      phase = 'null'
    }
  }

  const sequences = []
  let nextCursor = null
  let hasMore = false

  // Phase 1: Timestamped sequences
  if (phase === 'timestamped') {
    const result = await fetchTimestampedSequences(dbPath, {
      gapSeconds,
      limit,
      cursor,
      species,
      dateRange,
      timeRange,
      deploymentID,
      bbox,
      source,
      mediaTypes,
      sort,
      quickView,
      blankSequenceMode,
      detectionSequenceMode
    })

    sequences.push(...result.sequences)

    if (result.nextCursor) {
      // More timestamped sequences available
      nextCursor = encodeCursor(result.nextCursor)
      hasMore = true
    } else if (result.hasMoreNull) {
      // Transition to null phase
      nextCursor = encodeCursor({ phase: 'null', offset: 0 })
      hasMore = true
    }
  }

  // Phase 2: Null-timestamp sequences (each item is its own sequence)
  if (phase === 'null') {
    const offset = cursor?.offset || 0
    const remainingLimit = limit - sequences.length

    if (remainingLimit > 0) {
      const result = await fetchNullTimestampSequences(dbPath, {
        limit: remainingLimit,
        offset,
        species,
        dateRange,
        timeRange,
        deploymentID,
        bbox,
        source,
        mediaTypes,
        quickView,
        detectionSequenceMode
      })

      sequences.push(...result.sequences)

      if (result.hasMore) {
        nextCursor = encodeCursor({
          phase: 'null',
          offset: offset + result.sequences.length
        })
        hasMore = true
      }
    }
  }

  const elapsedTime = Date.now() - startTime
  log.info(
    `[Sequences] Returned ${sequences.length} sequences in ${elapsedTime}ms (hasMore: ${hasMore})`
  )

  return {
    sequences,
    nextCursor,
    hasMore
  }
}

/**
 * Fetch timestamped sequences with look-ahead for boundary detection
 *
 * @param {string} dbPath - Path to database
 * @param {Object} options - Fetch options
 * @returns {Promise<{ sequences: Array, nextCursor: Object|null, hasMoreNull: boolean }>}
 */
async function fetchTimestampedSequences(dbPath, options) {
  const {
    gapSeconds,
    limit,
    cursor,
    species,
    dateRange,
    timeRange,
    deploymentID,
    bbox,
    source,
    mediaTypes,
    sort,
    quickView = {},
    blankSequenceMode = false,
    detectionSequenceMode = false
  } = options

  // Blank/Detections modes get ALL media tagged with isDetection; keep only the
  // sequences whose every item is non-detection (Blank) or that contain a
  // detection (Detections), so the result matches the unfiltered table instead
  // of regrouping the empty frames out of mixed bursts.
  const hasDetection = (seq) => seq.items.some((i) => Number(i.isDetection) === 1)
  const sequenceFilter = blankSequenceMode
    ? (seq) => !hasDetection(seq)
    : detectionSequenceMode
      ? hasDetection
      : null

  // Fetch a batch of media
  const batchSize = Math.max(DEFAULT_BATCH_SIZE, limit * 10) // Ensure we have enough for look-ahead
  const dbResult = await getMediaForSequencePagination(dbPath, {
    cursor,
    batchSize,
    species,
    dateRange,
    timeRange,
    deploymentID,
    bbox,
    source,
    mediaTypes,
    sort,
    hideBlank: detectionSequenceMode,
    ...quickView
  })

  const { media: mediaItems, hasMoreTimestamped, hasMoreNull } = dbResult

  if (mediaItems.length === 0) {
    return {
      sequences: [],
      nextCursor: null,
      hasMoreNull
    }
  }

  // Group media into sequences
  let groupingResult
  if (gapSeconds === null) {
    // EventID-based grouping
    groupingResult = groupMediaByEventID(mediaItems)
  } else {
    // Timestamp-based grouping
    groupingResult = groupMediaIntoSequences(mediaItems, gapSeconds, isVideoMedia)
  }

  const allSequences = groupingResult.sequences

  // If we got fewer items than batch size, all sequences are complete
  if (!hasMoreTimestamped) {
    // We've exhausted timestamped media, return all sequences
    const finalSequences = sequenceFilter ? allSequences.filter(sequenceFilter) : allSequences
    return {
      sequences: finalSequences.map(formatSequence),
      nextCursor: null,
      hasMoreNull
    }
  }

  // We have more media in DB - the last sequence might be incomplete
  // Return all but the last sequence (which might have more items)
  if (allSequences.length <= 1) {
    // Only one sequence and there's more data - need to fetch more to find boundary
    // This handles the edge case of a very large sequence spanning many items
    return await fetchMoreForLargeSequence(dbPath, {
      gapSeconds,
      limit,
      cursor,
      species,
      dateRange,
      timeRange,
      deploymentID,
      bbox,
      source,
      mediaTypes,
      sort,
      quickView,
      blankSequenceMode,
      detectionSequenceMode,
      existingMedia: mediaItems,
      batchSize
    })
  }

  // The trailing sequence may be incomplete (more media in the DB could belong
  // to it), so it's never returned from this batch. allSequences.length >= 2
  // here (the <= 1 case took the large-sequence path above), so this is non-empty.
  // `trailing` is kept (unfiltered) for cursor advancement even when a filter
  // drops it, so the next page resumes past everything we've already grouped.
  const allComplete = allSequences.slice(0, -1)
  const trailing = allSequences[allSequences.length - 1]
  const completeSequences = sequenceFilter ? allComplete.filter(sequenceFilter) : allComplete

  // Return at most `limit` complete sequences. The cursor must resume right
  // after the LAST RETURNED sequence — when we truncate to `limit`, that's
  // sequence #limit, NOT the trailing incomplete one. Pointing it at the
  // trailing sequence (the old bug) skipped every complete sequence between
  // #limit and the end of the batch.
  const sequencesToReturn = completeSequences.slice(0, limit)
  const truncated = completeSequences.length > limit
  const boundarySeq = truncated ? sequencesToReturn[sequencesToReturn.length - 1] : trailing

  // Cursor points at the boundary item we continue past. For 'newest'
  // (descending) that's the earliest item of the boundary sequence (next page
  // fetches older); for 'oldest' (ascending) it's the latest (next page fetches
  // newer).
  const sortedItems = [...boundarySeq.items].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  )
  const boundaryItem = sort === 'oldest' ? sortedItems[sortedItems.length - 1] : sortedItems[0]

  return {
    sequences: sequencesToReturn.map(formatSequence),
    nextCursor: {
      phase: 'timestamped',
      t: boundaryItem.timestamp,
      m: boundaryItem.mediaID
    },
    // When we truncated, more timestamped sequences remain so the next page
    // stays in the timestamped phase (this flag only matters once timestamped
    // media is exhausted, which truncation means it is not).
    hasMoreNull
  }
}

/**
 * Handle the edge case where a single sequence spans the entire batch
 * Keep fetching until we find the sequence boundary
 */
async function fetchMoreForLargeSequence(dbPath, options) {
  const {
    gapSeconds,
    limit,
    species,
    dateRange,
    timeRange,
    deploymentID,
    bbox,
    source,
    mediaTypes,
    sort,
    quickView = {},
    blankSequenceMode = false,
    detectionSequenceMode = false,
    existingMedia,
    batchSize
  } = options

  // See fetchTimestampedSequences: keep no-detection (Blank) or with-detection
  // (Detections) sequences.
  const hasDetection = (seq) => seq.items.some((i) => Number(i.isDetection) === 1)
  const sequenceFilter = blankSequenceMode
    ? (seq) => !hasDetection(seq)
    : detectionSequenceMode
      ? hasDetection
      : null
  const formatKept = (seqs) =>
    (sequenceFilter ? seqs.filter(sequenceFilter) : seqs).map(formatSequence)

  let allMedia = [...existingMedia]
  let lastItem = allMedia[allMedia.length - 1]
  let iterations = 0
  const maxIterations = 10 // Safety limit

  while (iterations < maxIterations) {
    iterations++

    // Fetch more media starting from the last item
    const dbResult = await getMediaForSequencePagination(dbPath, {
      cursor: {
        phase: 'timestamped',
        t: lastItem.timestamp,
        m: lastItem.mediaID
      },
      batchSize,
      species,
      dateRange,
      timeRange,
      deploymentID,
      bbox,
      source,
      mediaTypes,
      sort,
      hideBlank: detectionSequenceMode,
      ...quickView
    })

    if (dbResult.media.length === 0) {
      // No more media - the single sequence is complete
      break
    }

    allMedia = [...allMedia, ...dbResult.media]
    lastItem = dbResult.media[dbResult.media.length - 1]

    // Re-group to check if we now have multiple sequences
    let groupingResult
    if (gapSeconds === null) {
      groupingResult = groupMediaByEventID(allMedia)
    } else {
      groupingResult = groupMediaIntoSequences(allMedia, gapSeconds, isVideoMedia)
    }

    if (groupingResult.sequences.length > 1 || !dbResult.hasMoreTimestamped) {
      // Found boundary or exhausted data
      const allSequences = groupingResult.sequences
      const completeSequences = dbResult.hasMoreTimestamped
        ? allSequences.slice(0, -1)
        : allSequences

      const sequencesToReturn = completeSequences.slice(0, limit)

      if (sequencesToReturn.length === 0) {
        return {
          sequences: [],
          nextCursor: null,
          hasMoreNull: dbResult.hasMoreNull
        }
      }

      const hasMoreSeqs = completeSequences.length > limit || dbResult.hasMoreTimestamped

      if (hasMoreSeqs) {
        // Find earliest timestamp in the next sequence to use as cursor
        const sortedItems = [
          ...(completeSequences.length > limit
            ? completeSequences[limit].items
            : allSequences[allSequences.length - 1].items)
        ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        // See note above: descending → earliest boundary; ascending → latest.
        const boundaryItem =
          sort === 'oldest' ? sortedItems[sortedItems.length - 1] : sortedItems[0]

        return {
          sequences: formatKept(sequencesToReturn),
          nextCursor: {
            phase: 'timestamped',
            t: boundaryItem.timestamp,
            m: boundaryItem.mediaID
          },
          hasMoreNull: dbResult.hasMoreNull
        }
      }

      return {
        sequences: formatKept(sequencesToReturn),
        nextCursor: null,
        hasMoreNull: dbResult.hasMoreNull
      }
    }
  }

  // Max iterations reached or single sequence spans everything
  let groupingResult
  if (gapSeconds === null) {
    groupingResult = groupMediaByEventID(allMedia)
  } else {
    groupingResult = groupMediaIntoSequences(allMedia, gapSeconds, isVideoMedia)
  }

  const sequencesToReturn = groupingResult.sequences.slice(0, limit)

  return {
    sequences: formatKept(sequencesToReturn),
    nextCursor: null,
    hasMoreNull: false
  }
}

/**
 * Fetch null-timestamp media as individual sequences
 *
 * @param {string} dbPath - Path to database
 * @param {Object} options - Fetch options
 * @returns {Promise<{ sequences: Array, hasMore: boolean }>}
 */
async function fetchNullTimestampSequences(dbPath, options) {
  const {
    limit,
    offset,
    species,
    deploymentID,
    bbox,
    source,
    mediaTypes,
    quickView = {},
    detectionSequenceMode = false
  } = options

  const dbResult = await getMediaForSequencePagination(dbPath, {
    cursor: { phase: 'null', offset },
    batchSize: limit,
    species,
    dateRange: {}, // Date range doesn't apply to null-timestamp media
    timeRange: {}, // Time range doesn't apply to null-timestamp media
    deploymentID,
    bbox, // Location filter still applies to null-timestamp media
    source, // Source filter still applies to null-timestamp media
    mediaTypes, // Media-type filter applies to null-timestamp media too
    hideBlank: detectionSequenceMode, // Detections: only null media with a real obs
    ...quickView // favorite apply to null media too
  })

  const { media: mediaItems, hasMoreNull } = dbResult

  // Each null-timestamp item becomes its own sequence
  const sequences = mediaItems.map((item) => ({
    id: item.mediaID,
    startTime: null,
    endTime: null,
    items: [item]
  }))

  return {
    sequences,
    hasMore: hasMoreNull
  }
}

/**
 * Format a sequence for API response
 * Ensures consistent structure and converts dates to ISO strings
 *
 * @param {Object} seq - Raw sequence object
 * @returns {Object} Formatted sequence
 */
function formatSequence(seq) {
  return {
    id: seq.id,
    startTime: seq.startTime ? seq.startTime.toISOString() : null,
    endTime: seq.endTime ? seq.endTime.toISOString() : null,
    items: seq.items
  }
}
