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
  const { gapSeconds = 60, limit = 20, cursor: cursorStr = null, filters = {} } = options

  const { species = [], dateRange = {}, timeRange = {} } = filters

  const startTime = Date.now()
  log.info(`[Sequences] Getting paginated sequences (limit: ${limit}, gapSeconds: ${gapSeconds})`)

  // Decode cursor
  const cursor = decodeCursor(cursorStr)
  let phase = cursor?.phase || 'timestamped'

  // If no cursor, check if we should start in null phase (no timestamped media)
  if (!cursor) {
    const hasTimestamped = await hasTimestampedMedia(dbPath, { species, dateRange, timeRange })
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
      timeRange
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
        timeRange
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
  const { gapSeconds, limit, cursor, species, dateRange, timeRange } = options

  // Fetch a batch of media
  const batchSize = Math.max(DEFAULT_BATCH_SIZE, limit * 10) // Ensure we have enough for look-ahead
  const dbResult = await getMediaForSequencePagination(dbPath, {
    cursor,
    batchSize,
    species,
    dateRange,
    timeRange
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
    return {
      sequences: allSequences.map(formatSequence),
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
      existingMedia: mediaItems,
      batchSize
    })
  }

  // Return sequences up to limit, keeping last one for next page
  const completeSequences = allSequences.slice(0, -1)
  const sequencesToReturn = completeSequences.slice(0, limit)

  if (sequencesToReturn.length < limit && completeSequences.length > limit) {
    // We have enough complete sequences
    const lastReturnedSeq = sequencesToReturn[sequencesToReturn.length - 1]
    const lastItem = lastReturnedSeq.items[lastReturnedSeq.items.length - 1]

    return {
      sequences: sequencesToReturn.map(formatSequence),
      nextCursor: {
        phase: 'timestamped',
        t: lastItem.timestamp,
        m: lastItem.mediaID
      },
      hasMoreNull
    }
  }

  // We're returning all complete sequences
  if (sequencesToReturn.length > 0) {
    // Find the earliest timestamp in the incomplete sequence to use as cursor
    const incompleteSeq = allSequences[allSequences.length - 1]
    const sortedItems = [...incompleteSeq.items].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    )
    const earliestInIncomplete = sortedItems[0]

    return {
      sequences: sequencesToReturn.map(formatSequence),
      nextCursor: {
        phase: 'timestamped',
        t: earliestInIncomplete.timestamp,
        m: earliestInIncomplete.mediaID
      },
      hasMoreNull: hasMoreNull || allSequences.length > sequencesToReturn.length
    }
  }

  return {
    sequences: [],
    nextCursor: null,
    hasMoreNull
  }
}

/**
 * Handle the edge case where a single sequence spans the entire batch
 * Keep fetching until we find the sequence boundary
 */
async function fetchMoreForLargeSequence(dbPath, options) {
  const { gapSeconds, limit, species, dateRange, timeRange, existingMedia, batchSize } = options

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
      timeRange
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

        return {
          sequences: sequencesToReturn.map(formatSequence),
          nextCursor: {
            phase: 'timestamped',
            t: sortedItems[0].timestamp,
            m: sortedItems[0].mediaID
          },
          hasMoreNull: dbResult.hasMoreNull
        }
      }

      return {
        sequences: sequencesToReturn.map(formatSequence),
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
    sequences: sequencesToReturn.map(formatSequence),
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
  const { limit, offset, species } = options

  const dbResult = await getMediaForSequencePagination(dbPath, {
    cursor: { phase: 'null', offset },
    batchSize: limit,
    species,
    dateRange: {}, // Date range doesn't apply to null-timestamp media
    timeRange: {} // Time range doesn't apply to null-timestamp media
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
