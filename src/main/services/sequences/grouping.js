/**
 * Sequence grouping utilities for the main process.
 *
 * Groups media files into sequences based on timestamp proximity and deployment.
 * This is the main-thread version of the sequence grouping logic.
 */

/**
 * Checks if a media item has a valid timestamp.
 * @param {Object} media - Media object with timestamp property
 * @returns {boolean} - True if timestamp is valid, false otherwise
 */
function hasValidTimestamp(media) {
  if (media.timestamp == null || media.timestamp === '') {
    return false
  }
  const time = new Date(media.timestamp).getTime()
  return !isNaN(time)
}

/**
 * Groups media files into sequences based on timestamp proximity AND deployment.
 * Media from different deployments are NEVER grouped into the same sequence.
 * Items with null/undefined deploymentID are treated as unique (each becomes its own sequence).
 * Videos (when isVideoFn is provided) are NEVER grouped - each video forms its own sequence.
 * Media with null/invalid timestamps are separated and returned in nullTimestampMedia array.
 * Works correctly regardless of input sort order (ascending or descending).
 * Output sequences have items sorted by timestamp (ascending - oldest first).
 *
 * @param {Array} mediaFiles - Array of media files with mediaID, timestamp, and optionally deploymentID
 * @param {number} gapThresholdSeconds - Maximum gap in seconds to consider media as same sequence
 * @param {Function} [isVideoFn] - Optional function to check if a media item is a video (videos are never grouped)
 * @returns {{ sequences: Array<{ id, items, startTime, endTime }>, nullTimestampMedia: Array }} Object with sequences array and nullTimestampMedia array
 */
export function groupMediaIntoSequences(mediaFiles, gapThresholdSeconds, isVideoFn) {
  // Edge case: null, undefined, or empty array
  if (!mediaFiles || mediaFiles.length === 0) {
    return { sequences: [], nullTimestampMedia: [] }
  }

  // Separate media with null/invalid timestamps upfront
  const validMedia = []
  const nullTimestampMedia = []

  for (const media of mediaFiles) {
    if (hasValidTimestamp(media)) {
      validMedia.push(media)
    } else {
      nullTimestampMedia.push(media)
    }
  }

  // Edge case: no valid media - return empty sequences with null-timestamp media
  if (validMedia.length === 0) {
    return { sequences: [], nullTimestampMedia }
  }

  // Edge case: disabled (0 or negative threshold) - no grouping
  if (gapThresholdSeconds <= 0) {
    // Return each media as its own sequence (no grouping)
    return {
      sequences: validMedia.map((media) => ({
        id: media.mediaID,
        items: [media],
        startTime: new Date(media.timestamp),
        endTime: new Date(media.timestamp)
      })),
      nullTimestampMedia
    }
  }

  const sequences = []
  let currentSequence = null
  const gapMs = gapThresholdSeconds * 1000

  for (const media of validMedia) {
    const mediaTime = new Date(media.timestamp).getTime()

    if (!currentSequence) {
      // Start first sequence
      currentSequence = {
        id: media.mediaID,
        items: [media],
        startTime: new Date(media.timestamp),
        endTime: new Date(media.timestamp),
        _minTime: mediaTime,
        _maxTime: mediaTime,
        _deploymentID: media.deploymentID,
        _hasVideo: isVideoFn && isVideoFn(media)
      }
    } else {
      // Check if same deployment (both must be non-null and equal)
      const sameDeployment =
        currentSequence._deploymentID != null &&
        media.deploymentID != null &&
        currentSequence._deploymentID === media.deploymentID

      // Check if current item is a video (videos are never grouped)
      const isCurrentVideo = isVideoFn && isVideoFn(media)
      // Check if current sequence contains a video (videos are never grouped with anything)
      const sequenceHasVideo = isVideoFn && currentSequence._hasVideo

      // Use Math.abs to handle both ascending and descending order
      const gap = Math.abs(mediaTime - currentSequence._maxTime)
      const gapFromMin = Math.abs(mediaTime - currentSequence._minTime)
      const effectiveGap = Math.min(gap, gapFromMin)

      if (effectiveGap <= gapMs && sameDeployment && !isCurrentVideo && !sequenceHasVideo) {
        // Same sequence - add to current
        currentSequence.items.push(media)
        // Update time bounds
        if (mediaTime < currentSequence._minTime) {
          currentSequence._minTime = mediaTime
          currentSequence.startTime = new Date(media.timestamp)
        }
        if (mediaTime > currentSequence._maxTime) {
          currentSequence._maxTime = mediaTime
          currentSequence.endTime = new Date(media.timestamp)
        }
      } else {
        // New sequence - save current and start new
        sequences.push(currentSequence)
        currentSequence = {
          id: media.mediaID,
          items: [media],
          startTime: new Date(media.timestamp),
          endTime: new Date(media.timestamp),
          _minTime: mediaTime,
          _maxTime: mediaTime,
          _deploymentID: media.deploymentID,
          _hasVideo: isVideoFn && isVideoFn(media)
        }
      }
    }
  }

  // Don't forget the last sequence
  if (currentSequence) {
    sequences.push(currentSequence)
  }

  // Sort items within each sequence by timestamp (ascending - oldest first)
  // and clean up internal tracking properties
  return {
    sequences: sequences.map((seq) => {
      const sortedItems = [...seq.items].sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime()
        const timeB = new Date(b.timestamp).getTime()
        if (timeA !== timeB) return timeA - timeB
        // Secondary sort by filePath for stable ordering when timestamps match
        const pathA = a.filePath || ''
        const pathB = b.filePath || ''
        return pathA.localeCompare(pathB)
      })

      // Update startTime/endTime based on sorted items
      const firstItem = sortedItems[0]
      const lastItem = sortedItems[sortedItems.length - 1]

      return {
        id: firstItem.mediaID, // Use first item's ID after sorting
        items: sortedItems,
        startTime: new Date(firstItem.timestamp),
        endTime: new Date(lastItem.timestamp)
      }
    }),
    nullTimestampMedia
  }
}

/**
 * Groups media files by their associated observation eventIDs.
 * Media without an eventID appear as individual items (not grouped).
 * Media sharing the same eventID are grouped together.
 * Media with null/invalid timestamps are separated and returned in nullTimestampMedia array.
 * Used when the sequence slider is set to "Off" (0) for CamtrapDP datasets with imported events.
 *
 * WARNING: This function assumes the dataset has meaningful eventIDs from CamtrapDP import.
 * If most media lack eventIDs or all share the same eventID, consider using timestamp-based
 * grouping (groupMediaIntoSequences) instead for more meaningful sequence boundaries.
 *
 * @param {Array} mediaFiles - Array of media files with mediaID, timestamp, eventID
 * @returns {{ sequences: Array<{ id, items, startTime, endTime }>, nullTimestampMedia: Array, warnings: Array<string> }} Object with sequences array, nullTimestampMedia array, and optional warnings
 */
export function groupMediaByEventID(mediaFiles) {
  if (!mediaFiles || mediaFiles.length === 0) {
    return { sequences: [], nullTimestampMedia: [] }
  }

  // Separate media with null/invalid timestamps upfront
  const validMedia = []
  const nullTimestampMedia = []

  for (const media of mediaFiles) {
    if (hasValidTimestamp(media)) {
      validMedia.push(media)
    } else {
      nullTimestampMedia.push(media)
    }
  }

  // If no valid media, return empty sequences with null-timestamp media
  if (validMedia.length === 0) {
    return { sequences: [], nullTimestampMedia }
  }

  const eventGroups = new Map()
  const noEventItems = []

  for (const media of validMedia) {
    if (media.eventID && media.eventID !== '') {
      if (!eventGroups.has(media.eventID)) {
        eventGroups.set(media.eventID, [])
      }
      eventGroups.get(media.eventID).push(media)
    } else {
      // Media without eventID becomes its own sequence
      noEventItems.push(media)
    }
  }

  const sequences = []

  // Convert event groups to sequences
  for (const [eventID, items] of eventGroups) {
    // Sort items by timestamp within each group (ascending - oldest first)
    const sortedItems = [...items].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime()
      const timeB = new Date(b.timestamp).getTime()
      if (timeA !== timeB) return timeA - timeB
      // Secondary sort by filePath for stable ordering when timestamps match
      const pathA = a.filePath || ''
      const pathB = b.filePath || ''
      return pathA.localeCompare(pathB)
    })

    sequences.push({
      id: eventID,
      items: sortedItems,
      startTime: new Date(sortedItems[0].timestamp),
      endTime: new Date(sortedItems[sortedItems.length - 1].timestamp)
    })
  }

  // Add individual items for media without eventID
  for (const media of noEventItems) {
    sequences.push({
      id: media.mediaID,
      items: [media],
      startTime: new Date(media.timestamp),
      endTime: new Date(media.timestamp)
    })
  }

  // Sort all sequences by startTime (descending to match gallery display)
  const sortedSequences = sequences.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())

  // Generate warnings for potentially problematic eventID usage
  const warnings = []
  const totalValidMedia = validMedia.length
  const mediaWithEventID = totalValidMedia - noEventItems.length

  // Warn if most media lack eventIDs (eventID-based grouping may not be useful)
  if (totalValidMedia > 0 && mediaWithEventID / totalValidMedia < 0.1) {
    warnings.push(
      `Only ${Math.round((mediaWithEventID / totalValidMedia) * 100)}% of media have eventIDs. ` +
        'Consider using timestamp-based grouping for more meaningful sequences.'
    )
  }

  // Warn if a single eventID contains most of the media (likely auto-generated or default value)
  const largestEventSize = Math.max(...Array.from(eventGroups.values()).map((g) => g.length), 0)
  if (mediaWithEventID > 10 && largestEventSize / mediaWithEventID > 0.5) {
    warnings.push(
      `A single eventID contains ${Math.round((largestEventSize / mediaWithEventID) * 100)}% of media. ` +
        'eventIDs may not represent meaningful event boundaries.'
    )
  }

  return {
    sequences: sortedSequences,
    nullTimestampMedia,
    warnings
  }
}
