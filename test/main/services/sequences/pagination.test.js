import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupMediaIntoSequences,
  groupMediaByEventID
} from '../../../../src/main/services/sequences/grouping.js'

/**
 * Tests for the pagination logic concepts.
 *
 * Since the actual pagination service requires database access, we test the
 * underlying grouping logic that pagination depends on, focusing on scenarios
 * specific to pagination: cursor boundaries, phase transitions, and sequence
 * completeness.
 */

// Helper: Create a media item with timestamp and deploymentID
function createMedia(id, timestamp, deploymentID = 'default-deployment') {
  return {
    mediaID: id,
    timestamp,
    deploymentID,
    filePath: `/path/to/${id}.jpg`,
    fileName: `${id}.jpg`,
    fileMediatype: 'image/jpeg'
  }
}

// Helper: Create media at offset from base time
function createMediaAtOffset(id, baseTime, offsetSeconds, deploymentID = 'default-deployment') {
  const time = new Date(baseTime.getTime() + offsetSeconds * 1000)
  return createMedia(id, time.toISOString(), deploymentID)
}

// Helper: Create media without timestamp
function createNullTimestampMedia(id) {
  return {
    mediaID: id,
    timestamp: null,
    deploymentID: null,
    filePath: `/path/to/${id}.jpg`,
    fileName: `${id}.jpg`,
    fileMediatype: 'image/jpeg'
  }
}

// Helper: Check if media is a video
function isVideoMedia(media) {
  return media.fileMediatype?.startsWith('video/')
}

describe('Pagination boundary detection', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('sequence boundary detection with look-ahead', () => {
    test('detects sequence boundary when gap exceeds threshold', () => {
      // Simulates fetching a batch: first sequence is complete when we see gap
      const batch = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('c', baseTime, 50), // End of sequence 1
        createMediaAtOffset('d', baseTime, 200) // Start of sequence 2 - boundary found!
      ]

      const { sequences } = groupMediaIntoSequences(batch, 60)

      assert.equal(sequences.length, 2)
      // First sequence is COMPLETE because we saw 'd' which proves 'c' was the last
      assert.equal(sequences[0].items.length, 3) // a, b, c
    })

    test('last sequence may be incomplete without look-ahead', () => {
      // Without item 'd', we wouldn't know if sequence 1 is complete
      const batch = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('c', baseTime, 50)
        // No item 'd' - is this sequence complete or will more items arrive?
      ]

      const { sequences } = groupMediaIntoSequences(batch, 60)

      assert.equal(sequences.length, 1)
      assert.equal(sequences[0].items.length, 3)
      // This sequence MIGHT be incomplete if there are more items < 60s after 'c'
    })

    test('multiple complete sequences detected correctly', () => {
      const batch = [
        // Sequence 1
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30),
        // Sequence 2 (boundary at 200s gap)
        createMediaAtOffset('c', baseTime, 200),
        createMediaAtOffset('d', baseTime, 230),
        // Sequence 3 (boundary at 200s gap)
        createMediaAtOffset('e', baseTime, 500)
      ]

      const { sequences } = groupMediaIntoSequences(batch, 60)

      assert.equal(sequences.length, 3)
      assert.equal(sequences[0].items.length, 2) // a, b - COMPLETE (saw 'c')
      assert.equal(sequences[1].items.length, 2) // c, d - COMPLETE (saw 'e')
      assert.equal(sequences[2].items.length, 1) // e - might be incomplete
    })
  })

  describe('pagination with limit', () => {
    test('can stop at sequence boundary for clean pagination', () => {
      // Create clear sequence boundaries
      const batch = []
      for (let seq = 0; seq < 5; seq++) {
        batch.push(createMediaAtOffset(`seq${seq}_a`, baseTime, seq * 200))
        batch.push(createMediaAtOffset(`seq${seq}_b`, baseTime, seq * 200 + 30))
      }

      const { sequences } = groupMediaIntoSequences(batch, 60)

      assert.equal(sequences.length, 5)

      // For pagination with limit=3, we would return first 3 sequences
      // and use sequence 4's start time as cursor
      const firstThree = sequences.slice(0, 3)
      assert.equal(firstThree.length, 3)

      // The cursor would be the timestamp of the first item in sequence 4
      const nextCursorTime = sequences[3].items[0].timestamp
      assert.ok(nextCursorTime)
    })
  })

  describe('phase transition: timestamped to null-timestamp', () => {
    test('null-timestamp media are separated', () => {
      const batch = [
        createMediaAtOffset('ts1', baseTime, 0),
        createMediaAtOffset('ts2', baseTime, 30),
        createNullTimestampMedia('null1'),
        createNullTimestampMedia('null2')
      ]

      const { sequences, nullTimestampMedia } = groupMediaIntoSequences(batch, 60)

      assert.equal(sequences.length, 1) // ts1, ts2 grouped
      assert.equal(sequences[0].items.length, 2)
      assert.equal(nullTimestampMedia.length, 2) // null1, null2 separate
    })

    test('null-timestamp media displayed after all timestamped sequences', () => {
      // In pagination, after exhausting timestamped media, we return null-timestamp
      const timestamped = [
        createMediaAtOffset('ts1', baseTime, 0),
        createMediaAtOffset('ts2', baseTime, 30)
      ]

      const nullTimestamp = [createNullTimestampMedia('null1'), createNullTimestampMedia('null2')]

      const tsResult = groupMediaIntoSequences(timestamped, 60)
      assert.equal(tsResult.sequences.length, 1)

      // Each null-timestamp item becomes its own "sequence" for display
      const nullSequences = nullTimestamp.map((media) => ({
        id: media.mediaID,
        items: [media],
        startTime: null,
        endTime: null
      }))

      assert.equal(nullSequences.length, 2)
      assert.equal(nullSequences[0].startTime, null)
    })

    test('handles study with only null-timestamp media', () => {
      const batch = [
        createNullTimestampMedia('null1'),
        createNullTimestampMedia('null2'),
        createNullTimestampMedia('null3')
      ]

      const { sequences, nullTimestampMedia } = groupMediaIntoSequences(batch, 60)

      assert.equal(sequences.length, 0) // No timestamped sequences
      assert.equal(nullTimestampMedia.length, 3) // All in null-timestamp array
    })

    test('handles study with only timestamped media', () => {
      const batch = [
        createMediaAtOffset('ts1', baseTime, 0),
        createMediaAtOffset('ts2', baseTime, 30),
        createMediaAtOffset('ts3', baseTime, 200)
      ]

      const { sequences, nullTimestampMedia } = groupMediaIntoSequences(batch, 60)

      assert.equal(sequences.length, 2)
      assert.equal(nullTimestampMedia.length, 0)
    })
  })

  describe('cursor encoding/decoding', () => {
    test('cursor can encode timestamped phase position', () => {
      // Cursor format for timestamped phase: { phase: 'timestamped', t: timestamp, m: mediaID }
      const cursor = {
        phase: 'timestamped',
        t: '2024-01-15T10:03:20Z',
        m: 'seq1_last'
      }

      const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64')
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))

      assert.equal(decoded.phase, 'timestamped')
      assert.equal(decoded.t, '2024-01-15T10:03:20Z')
      assert.equal(decoded.m, 'seq1_last')
    })

    test('cursor can encode null-timestamp phase position', () => {
      // Cursor format for null phase: { phase: 'null', offset: number }
      const cursor = {
        phase: 'null',
        offset: 40
      }

      const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64')
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))

      assert.equal(decoded.phase, 'null')
      assert.equal(decoded.offset, 40)
    })
  })

  describe('video handling in pagination', () => {
    test('videos break sequences even within gap threshold', () => {
      const batch = [
        createMediaAtOffset('img1', baseTime, 0),
        { ...createMediaAtOffset('vid1', baseTime, 5), fileMediatype: 'video/mp4' },
        createMediaAtOffset('img2', baseTime, 10)
      ]

      const { sequences } = groupMediaIntoSequences(batch, 60, isVideoMedia)

      // Video breaks the sequence: img1 alone, vid1 alone, img2 alone
      assert.equal(sequences.length, 3)
      assert.equal(sequences[0].items[0].mediaID, 'img1')
      assert.equal(sequences[1].items[0].mediaID, 'vid1')
      assert.equal(sequences[2].items[0].mediaID, 'img2')
    })
  })

  describe('eventID-based grouping for pagination', () => {
    test('groups by eventID ignoring timestamp gaps', () => {
      const batch = [
        { ...createMediaAtOffset('a', baseTime, 0), eventID: 'event1' },
        { ...createMediaAtOffset('b', baseTime, 5000), eventID: 'event1' }, // 5000s gap but same event
        { ...createMediaAtOffset('c', baseTime, 100), eventID: 'event2' }
      ]

      const { sequences } = groupMediaByEventID(batch)

      assert.equal(sequences.length, 2)
      const event1 = sequences.find((s) => s.id === 'event1')
      assert.equal(event1.items.length, 2) // a, b grouped by eventID
    })
  })

  describe('deployment-based sequence separation', () => {
    test('different deployments create separate sequences', () => {
      const batch = [
        createMediaAtOffset('dep1_a', baseTime, 0, 'camera_north'),
        createMediaAtOffset('dep1_b', baseTime, 5, 'camera_north'),
        createMediaAtOffset('dep2_a', baseTime, 10, 'camera_south'),
        createMediaAtOffset('dep2_b', baseTime, 15, 'camera_south')
      ]

      const { sequences } = groupMediaIntoSequences(batch, 60)

      // Even though all within 60s, different deployments = separate sequences
      assert.equal(sequences.length, 2)

      const northSeq = sequences.find((s) => s.items[0].deploymentID === 'camera_north')
      const southSeq = sequences.find((s) => s.items[0].deploymentID === 'camera_south')

      assert.equal(northSeq.items.length, 2)
      assert.equal(southSeq.items.length, 2)
    })
  })
})

describe('Large dataset scenarios', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  test('handles large batch efficiently', () => {
    const batch = []
    // 500 items, 50 sequences of 10 items each (items 30s apart, sequences 200s apart)
    for (let seq = 0; seq < 50; seq++) {
      for (let item = 0; item < 10; item++) {
        batch.push(createMediaAtOffset(`seq${seq}_item${item}`, baseTime, seq * 200 + item * 30))
      }
    }

    const startTime = Date.now()
    const { sequences } = groupMediaIntoSequences(batch, 60)
    const elapsedMs = Date.now() - startTime

    assert.equal(sequences.length, 50)
    assert.equal(sequences[0].items.length, 10)

    // Should be fast (well under 100ms for 500 items)
    assert.ok(elapsedMs < 100, `Grouping took ${elapsedMs}ms, expected < 100ms`)
  })

  test('handles sequence spanning entire batch', () => {
    // All 100 items within 60s of each other
    const batch = []
    for (let i = 0; i < 100; i++) {
      batch.push(createMediaAtOffset(`item${i}`, baseTime, i * 0.5)) // 0.5s apart
    }

    const { sequences } = groupMediaIntoSequences(batch, 60)

    assert.equal(sequences.length, 1)
    assert.equal(sequences[0].items.length, 100)
  })
})

describe('Sequence output ordering', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  test('items within sequence are sorted by timestamp ascending', () => {
    // Input in random order
    const batch = [
      createMediaAtOffset('c', baseTime, 100),
      createMediaAtOffset('a', baseTime, 0),
      createMediaAtOffset('e', baseTime, 200),
      createMediaAtOffset('b', baseTime, 50),
      createMediaAtOffset('d', baseTime, 150)
    ]

    const { sequences } = groupMediaIntoSequences(batch, 300) // Group all together

    assert.equal(sequences.length, 1)

    // Items should be sorted ascending (oldest first)
    const items = sequences[0].items
    assert.equal(items[0].mediaID, 'a') // 0s
    assert.equal(items[1].mediaID, 'b') // 50s
    assert.equal(items[2].mediaID, 'c') // 100s
    assert.equal(items[3].mediaID, 'd') // 150s
    assert.equal(items[4].mediaID, 'e') // 200s
  })

  test('sequence id is first item mediaID after sorting', () => {
    const batch = [
      createMediaAtOffset('z', baseTime, 50),
      createMediaAtOffset('a', baseTime, 0), // Earliest - should be sequence ID
      createMediaAtOffset('m', baseTime, 25)
    ]

    const { sequences } = groupMediaIntoSequences(batch, 60)

    assert.equal(sequences[0].id, 'a')
  })

  test('startTime and endTime reflect sorted bounds', () => {
    const batch = [
      createMediaAtOffset('c', baseTime, 100),
      createMediaAtOffset('a', baseTime, 0),
      createMediaAtOffset('b', baseTime, 50)
    ]

    const { sequences } = groupMediaIntoSequences(batch, 150)

    const seq = sequences[0]

    // startTime = earliest
    assert.equal(seq.startTime.toISOString(), baseTime.toISOString())
    // endTime = latest (100s after base)
    assert.equal(seq.endTime.toISOString(), new Date(baseTime.getTime() + 100000).toISOString())
  })
})
