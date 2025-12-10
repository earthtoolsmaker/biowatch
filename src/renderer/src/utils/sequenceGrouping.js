/**
 * Groups media files into sequences based on timestamp proximity AND deployment.
 * Media from different deployments are NEVER grouped into the same sequence.
 * Items with null/undefined deploymentID are treated as unique (each becomes its own sequence).
 * Works correctly regardless of input sort order (ascending or descending).
 * Output sequences have items sorted by timestamp (ascending - oldest first).
 *
 * @param {Array} mediaFiles - Array of media files with mediaID, timestamp, and optionally deploymentID
 * @param {number} gapThresholdSeconds - Maximum gap in seconds to consider media as same sequence
 * @returns {Array} Array of sequence objects { id, items, startTime, endTime }
 */
export function groupMediaIntoSequences(mediaFiles, gapThresholdSeconds) {
  // Edge case: null, undefined, or empty array
  if (!mediaFiles || mediaFiles.length === 0) {
    return []
  }

  // Edge case: disabled (0 or negative threshold) - no grouping
  if (gapThresholdSeconds <= 0) {
    // Return each media as its own sequence (no grouping)
    return mediaFiles.map((media) => ({
      id: media.mediaID,
      items: [media],
      startTime: new Date(media.timestamp),
      endTime: new Date(media.timestamp)
    }))
  }

  const sequences = []
  let currentSequence = null
  const gapMs = gapThresholdSeconds * 1000

  for (const media of mediaFiles) {
    let mediaTime
    try {
      mediaTime = new Date(media.timestamp).getTime()
      if (isNaN(mediaTime)) {
        // Invalid timestamp - treat as separate item
        if (currentSequence) {
          sequences.push(currentSequence)
        }
        currentSequence = {
          id: media.mediaID,
          items: [media],
          startTime: new Date(media.timestamp),
          endTime: new Date(media.timestamp),
          _deploymentID: media.deploymentID
        }
        continue
      }
    } catch {
      // Invalid timestamp - treat as separate item
      if (currentSequence) {
        sequences.push(currentSequence)
      }
      currentSequence = {
        id: media.mediaID,
        items: [media],
        startTime: new Date(media.timestamp),
        endTime: new Date(media.timestamp),
        _deploymentID: media.deploymentID
      }
      continue
    }

    if (!currentSequence) {
      // Start first sequence
      currentSequence = {
        id: media.mediaID,
        items: [media],
        startTime: new Date(media.timestamp),
        endTime: new Date(media.timestamp),
        _minTime: mediaTime,
        _maxTime: mediaTime,
        _deploymentID: media.deploymentID
      }
    } else {
      // Check if same deployment (both must be non-null and equal)
      const sameDeployment =
        currentSequence._deploymentID != null &&
        media.deploymentID != null &&
        currentSequence._deploymentID === media.deploymentID

      // Use Math.abs to handle both ascending and descending order
      const gap = Math.abs(mediaTime - currentSequence._maxTime)
      const gapFromMin = Math.abs(mediaTime - currentSequence._minTime)
      const effectiveGap = Math.min(gap, gapFromMin)

      if (effectiveGap <= gapMs && sameDeployment) {
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
          _deploymentID: media.deploymentID
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
  return sequences.map((seq) => {
    const sortedItems = [...seq.items].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime()
      const timeB = new Date(b.timestamp).getTime()
      return timeA - timeB
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
  })
}

/**
 * Groups media files by their associated observation eventIDs.
 * Media without an eventID appear as individual items (not grouped).
 * Media sharing the same eventID are grouped together.
 * Used when the sequence slider is set to "Off" (0) for CamtrapDP datasets with imported events.
 *
 * @param {Array} mediaFiles - Array of media files with mediaID, timestamp, eventID
 * @returns {Array} Array of sequence objects { id, items, startTime, endTime }
 */
export function groupMediaByEventID(mediaFiles) {
  if (!mediaFiles || mediaFiles.length === 0) {
    return []
  }

  const eventGroups = new Map()
  const noEventItems = []

  for (const media of mediaFiles) {
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
      return timeA - timeB
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
  return sequences.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
}
