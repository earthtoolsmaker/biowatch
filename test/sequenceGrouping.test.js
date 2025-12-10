import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupMediaIntoSequences,
  groupMediaByEventID
} from '../src/renderer/src/utils/sequenceGrouping.js'

// Helper: Create a media item with timestamp
function createMedia(id, timestamp) {
  return { mediaID: id, timestamp }
}

// Helper: Create media at offset from base time (with default deploymentID for grouping tests)
function createMediaAtOffset(id, baseTime, offsetSeconds, deploymentID = 'default-deployment') {
  const time = new Date(baseTime.getTime() + offsetSeconds * 1000)
  return { mediaID: id, timestamp: time.toISOString(), deploymentID }
}

// Helper: Create media at offset from base time with explicit deploymentID (including null/undefined)
function createMediaWithDeployment(id, baseTime, offsetSeconds, deploymentID) {
  const time = new Date(baseTime.getTime() + offsetSeconds * 1000)
  return { mediaID: id, timestamp: time.toISOString(), deploymentID }
}

// Helper: Assert two dates are equal
function assertDatesEqual(actual, expected, message) {
  assert.equal(actual.getTime(), expected.getTime(), message)
}

describe('groupMediaIntoSequences', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('edge cases', () => {
    test('empty array returns empty array', () => {
      const result = groupMediaIntoSequences([], 60)
      assert.deepEqual(result, [])
    })

    test('null input returns empty array', () => {
      const result = groupMediaIntoSequences(null, 60)
      assert.deepEqual(result, [])
    })

    test('undefined input returns empty array', () => {
      const result = groupMediaIntoSequences(undefined, 60)
      assert.deepEqual(result, [])
    })

    test('gap threshold = 0 disables grouping', () => {
      const media = [createMediaAtOffset('a', baseTime, 0), createMediaAtOffset('b', baseTime, 5)]
      const result = groupMediaIntoSequences(media, 0)

      assert.equal(result.length, 2)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[1].items.length, 1)
    })

    test('negative gap threshold disables grouping', () => {
      const media = [createMediaAtOffset('a', baseTime, 0), createMediaAtOffset('b', baseTime, 5)]
      const result = groupMediaIntoSequences(media, -10)

      assert.equal(result.length, 2)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[1].items.length, 1)
    })

    test('single item returns single sequence', () => {
      const media = [createMediaAtOffset('a', baseTime, 0)]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[0].id, 'a')
    })
  })

  describe('basic grouping', () => {
    test('two items within threshold are grouped', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30) // 30 seconds apart
      ]
      const result = groupMediaIntoSequences(media, 60) // 60 second threshold

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 2)
    })

    test('two items outside threshold are separate', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 120) // 120 seconds apart
      ]
      const result = groupMediaIntoSequences(media, 60) // 60 second threshold

      assert.equal(result.length, 2)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[1].items.length, 1)
    })

    test('three items: first two close, third far', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('c', baseTime, 200) // far from first two
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
      assert.equal(result[0].items.length, 2)
      assert.equal(result[1].items.length, 1)
      assert.equal(result[1].items[0].mediaID, 'c')
    })

    test('multiple sequences form correctly', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('c', baseTime, 200),
        createMediaAtOffset('d', baseTime, 210),
        createMediaAtOffset('e', baseTime, 500)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 3)
      assert.equal(result[0].items.length, 2) // a, b
      assert.equal(result[1].items.length, 2) // c, d
      assert.equal(result[2].items.length, 1) // e
    })
  })

  describe('sort order handling', () => {
    test('ascending order input works correctly', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('c', baseTime, 50)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 3)
    })

    test('descending order input works correctly', () => {
      const media = [
        createMediaAtOffset('c', baseTime, 50),
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('a', baseTime, 0)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 3)
    })

    test('random/mixed order input works correctly', () => {
      const media = [
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('c', baseTime, 50)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 3)
    })

    test('descending order with multiple sequences', () => {
      const media = [
        createMediaAtOffset('d', baseTime, 210),
        createMediaAtOffset('c', baseTime, 200),
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('a', baseTime, 0)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
      // First sequence should contain a, b (early times)
      // Second sequence should contain c, d (late times)
    })
  })

  describe('output validation', () => {
    test('items within sequence are sorted by timestamp ascending', () => {
      const media = [
        createMediaAtOffset('c', baseTime, 50),
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result[0].items[0].mediaID, 'a')
      assert.equal(result[0].items[1].mediaID, 'b')
      assert.equal(result[0].items[2].mediaID, 'c')
    })

    test('sequence id is first item mediaID after sorting', () => {
      const media = [
        createMediaAtOffset('c', baseTime, 50),
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30)
      ]
      const result = groupMediaIntoSequences(media, 60)

      // 'a' is earliest, so should be the id
      assert.equal(result[0].id, 'a')
    })

    test('startTime and endTime are correct Date objects', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 30),
        createMediaAtOffset('c', baseTime, 50)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.ok(result[0].startTime instanceof Date)
      assert.ok(result[0].endTime instanceof Date)
      assertDatesEqual(result[0].startTime, new Date(baseTime.getTime()))
      assertDatesEqual(result[0].endTime, new Date(baseTime.getTime() + 50000))
    })
  })

  describe('invalid timestamps', () => {
    test('item with invalid timestamp is treated as separate sequence', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMedia('b', 'invalid-timestamp'),
        createMediaAtOffset('c', baseTime, 30)
      ]
      const result = groupMediaIntoSequences(media, 60)

      // Should have at least 2 sequences (invalid breaks the chain)
      assert.ok(result.length >= 2)
    })

    test('all invalid timestamps still return sequences', () => {
      const media = [createMedia('a', 'invalid1'), createMedia('b', 'invalid2')]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[1].items.length, 1)
    })
  })

  describe('boundary conditions', () => {
    test('gap exactly equal to threshold is grouped', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 60) // exactly 60 seconds
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 2)
    })

    test('gap 1 second over threshold is NOT grouped', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 61) // 61 seconds
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
    })

    test('gap 1ms over threshold is NOT grouped', () => {
      // Create items exactly threshold + 1ms apart
      const time1 = baseTime
      const time2 = new Date(baseTime.getTime() + 60001) // 60.001 seconds
      const media = [createMedia('a', time1.toISOString()), createMedia('b', time2.toISOString())]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
    })
  })

  describe('real-world scenarios', () => {
    test('camera trap burst mode (3 rapid shots)', () => {
      const media = [
        createMediaAtOffset('a', baseTime, 0),
        createMediaAtOffset('b', baseTime, 1),
        createMediaAtOffset('c', baseTime, 2)
      ]
      const result = groupMediaIntoSequences(media, 10)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 3)
    })

    test('multiple animal visits throughout day', () => {
      const media = [
        // Morning visit
        createMediaAtOffset('m1', baseTime, 0),
        createMediaAtOffset('m2', baseTime, 5),
        // Noon visit (4 hours later)
        createMediaAtOffset('n1', baseTime, 14400),
        createMediaAtOffset('n2', baseTime, 14405),
        // Evening visit (8 hours later)
        createMediaAtOffset('e1', baseTime, 28800)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 3)
      assert.equal(result[0].items.length, 2) // morning
      assert.equal(result[1].items.length, 2) // noon
      assert.equal(result[2].items.length, 1) // evening
    })

    test('large sequence with many items', () => {
      const media = []
      for (let i = 0; i < 50; i++) {
        media.push(createMediaAtOffset(`item${i}`, baseTime, i * 5)) // 5 second intervals
      }
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 50)
    })
  })

  describe('deployment-based grouping', () => {
    test('media from same deployment within threshold are grouped', () => {
      const media = [
        createMediaWithDeployment('a', baseTime, 0, 'dep1'),
        createMediaWithDeployment('b', baseTime, 30, 'dep1')
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 2)
    })

    test('media from different deployments within threshold are NOT grouped', () => {
      const media = [
        createMediaWithDeployment('a', baseTime, 0, 'dep1'),
        createMediaWithDeployment('b', baseTime, 5, 'dep2')
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[1].items.length, 1)
    })

    test('interleaved deployments by timestamp create separate sequences', () => {
      const media = [
        createMediaWithDeployment('a1', baseTime, 0, 'dep1'),
        createMediaWithDeployment('b1', baseTime, 5, 'dep2'),
        createMediaWithDeployment('a2', baseTime, 10, 'dep1'),
        createMediaWithDeployment('b2', baseTime, 15, 'dep2')
      ]
      const result = groupMediaIntoSequences(media, 60)

      // Each deployment change starts a new sequence
      assert.equal(result.length, 4)
    })

    test('media with null deploymentID are treated as separate sequences', () => {
      const media = [
        createMediaWithDeployment('a', baseTime, 0, null),
        createMediaWithDeployment('b', baseTime, 5, null)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
    })

    test('media with undefined deploymentID are treated as separate sequences', () => {
      const media = [
        { mediaID: 'a', timestamp: baseTime.toISOString() }, // no deploymentID property
        { mediaID: 'b', timestamp: new Date(baseTime.getTime() + 5000).toISOString() }
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
    })

    test('media with null deploymentID not grouped with valid deploymentID', () => {
      const media = [
        createMediaWithDeployment('a', baseTime, 0, 'dep1'),
        createMediaWithDeployment('b', baseTime, 5, null)
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
    })

    test('cameras side by side with simultaneous triggers create separate sequences', () => {
      const media = [
        createMediaWithDeployment('cam_a_1', baseTime, 0, 'camera_A'),
        createMediaWithDeployment('cam_a_2', baseTime, 1, 'camera_A'),
        createMediaWithDeployment('cam_b_1', baseTime, 2, 'camera_B'),
        createMediaWithDeployment('cam_b_2', baseTime, 3, 'camera_B')
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
      assert.equal(result[0].items.length, 2)
      assert.equal(result[0].items[0].deploymentID, 'camera_A')
      assert.equal(result[1].items.length, 2)
      assert.equal(result[1].items[0].deploymentID, 'camera_B')
    })

    test('multiple sequences per deployment are created correctly', () => {
      const media = [
        // Morning visit at camera A
        createMediaWithDeployment('a1', baseTime, 0, 'dep1'),
        createMediaWithDeployment('a2', baseTime, 5, 'dep1'),
        // Later visit at camera A (2 hours later)
        createMediaWithDeployment('a3', baseTime, 7200, 'dep1'),
        createMediaWithDeployment('a4', baseTime, 7205, 'dep1')
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 2)
      assert.equal(result[0].items.length, 2)
      assert.equal(result[1].items.length, 2)
    })

    test('same deployment in descending order groups correctly', () => {
      const media = [
        createMediaWithDeployment('c', baseTime, 50, 'dep1'),
        createMediaWithDeployment('b', baseTime, 30, 'dep1'),
        createMediaWithDeployment('a', baseTime, 0, 'dep1')
      ]
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 3)
      // Items should be sorted ascending
      assert.equal(result[0].items[0].mediaID, 'a')
      assert.equal(result[0].items[1].mediaID, 'b')
      assert.equal(result[0].items[2].mediaID, 'c')
    })
  })
})

// Helper: Create media with eventID
function createMediaWithEventID(id, timestamp, eventID) {
  return { mediaID: id, timestamp, eventID }
}

describe('groupMediaByEventID', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('edge cases', () => {
    test('empty array returns empty array', () => {
      const result = groupMediaByEventID([])
      assert.deepEqual(result, [])
    })

    test('null input returns empty array', () => {
      const result = groupMediaByEventID(null)
      assert.deepEqual(result, [])
    })

    test('undefined input returns empty array', () => {
      const result = groupMediaByEventID(undefined)
      assert.deepEqual(result, [])
    })

    test('single item with eventID returns single sequence', () => {
      const media = [createMediaWithEventID('a', baseTime.toISOString(), 'event1')]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[0].id, 'event1')
    })

    test('single item without eventID returns single sequence with mediaID as id', () => {
      const media = [{ mediaID: 'a', timestamp: baseTime.toISOString() }]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[0].id, 'a')
    })
  })

  describe('grouping by eventID', () => {
    test('media with same eventID are grouped together', () => {
      const media = [
        createMediaWithEventID('a', baseTime.toISOString(), 'event1'),
        createMediaWithEventID('b', new Date(baseTime.getTime() + 5000).toISOString(), 'event1'),
        createMediaWithEventID('c', new Date(baseTime.getTime() + 10000).toISOString(), 'event1')
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 3)
      assert.equal(result[0].id, 'event1')
    })

    test('media with different eventIDs create separate sequences', () => {
      const media = [
        createMediaWithEventID('a', baseTime.toISOString(), 'event1'),
        createMediaWithEventID('b', new Date(baseTime.getTime() + 5000).toISOString(), 'event2'),
        createMediaWithEventID('c', new Date(baseTime.getTime() + 10000).toISOString(), 'event3')
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 3)
      assert.ok(result.some((seq) => seq.id === 'event1'))
      assert.ok(result.some((seq) => seq.id === 'event2'))
      assert.ok(result.some((seq) => seq.id === 'event3'))
    })

    test('media without eventID become individual sequences', () => {
      const media = [
        { mediaID: 'a', timestamp: baseTime.toISOString() },
        { mediaID: 'b', timestamp: new Date(baseTime.getTime() + 5000).toISOString() }
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 2)
      assert.ok(result.some((seq) => seq.id === 'a'))
      assert.ok(result.some((seq) => seq.id === 'b'))
    })

    test('empty string eventID is treated as no eventID', () => {
      const media = [
        createMediaWithEventID('a', baseTime.toISOString(), ''),
        createMediaWithEventID('b', new Date(baseTime.getTime() + 5000).toISOString(), '')
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 2)
      assert.ok(result.some((seq) => seq.id === 'a'))
      assert.ok(result.some((seq) => seq.id === 'b'))
    })

    test('mixed media with and without eventIDs are handled correctly', () => {
      const media = [
        createMediaWithEventID('a', baseTime.toISOString(), 'event1'),
        createMediaWithEventID('b', new Date(baseTime.getTime() + 5000).toISOString(), 'event1'),
        { mediaID: 'c', timestamp: new Date(baseTime.getTime() + 10000).toISOString() },
        createMediaWithEventID('d', new Date(baseTime.getTime() + 15000).toISOString(), 'event2'),
        { mediaID: 'e', timestamp: new Date(baseTime.getTime() + 20000).toISOString() }
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 4) // event1 group + event2 group + 2 individual items
      const event1Seq = result.find((seq) => seq.id === 'event1')
      assert.equal(event1Seq.items.length, 2)
      const event2Seq = result.find((seq) => seq.id === 'event2')
      assert.equal(event2Seq.items.length, 1)
    })
  })

  describe('sorting within sequences', () => {
    test('items within sequence are sorted by timestamp ascending', () => {
      const media = [
        createMediaWithEventID('c', new Date(baseTime.getTime() + 10000).toISOString(), 'event1'),
        createMediaWithEventID('a', baseTime.toISOString(), 'event1'),
        createMediaWithEventID('b', new Date(baseTime.getTime() + 5000).toISOString(), 'event1')
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result[0].items[0].mediaID, 'a')
      assert.equal(result[0].items[1].mediaID, 'b')
      assert.equal(result[0].items[2].mediaID, 'c')
    })

    test('startTime and endTime reflect sorted order', () => {
      const time1 = baseTime.toISOString()
      const time2 = new Date(baseTime.getTime() + 5000).toISOString()
      const time3 = new Date(baseTime.getTime() + 10000).toISOString()
      const media = [
        createMediaWithEventID('c', time3, 'event1'),
        createMediaWithEventID('a', time1, 'event1'),
        createMediaWithEventID('b', time2, 'event1')
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result[0].startTime.toISOString(), time1)
      assert.equal(result[0].endTime.toISOString(), time3)
    })
  })

  describe('output sorting', () => {
    test('sequences are sorted by startTime descending', () => {
      const media = [
        createMediaWithEventID('a', baseTime.toISOString(), 'event1'),
        createMediaWithEventID('b', new Date(baseTime.getTime() + 100000).toISOString(), 'event2'),
        createMediaWithEventID('c', new Date(baseTime.getTime() + 50000).toISOString(), 'event3')
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 3)
      // Most recent first (descending)
      assert.equal(result[0].id, 'event2') // 100 seconds from base
      assert.equal(result[1].id, 'event3') // 50 seconds from base
      assert.equal(result[2].id, 'event1') // base time
    })

    test('individual items (no eventID) are also sorted by startTime descending', () => {
      const media = [
        { mediaID: 'a', timestamp: baseTime.toISOString() },
        { mediaID: 'b', timestamp: new Date(baseTime.getTime() + 100000).toISOString() },
        { mediaID: 'c', timestamp: new Date(baseTime.getTime() + 50000).toISOString() }
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 3)
      // Most recent first
      assert.equal(result[0].id, 'b')
      assert.equal(result[1].id, 'c')
      assert.equal(result[2].id, 'a')
    })
  })

  describe('real-world scenarios', () => {
    test('CamtrapDP import with multiple events', () => {
      // Simulates importing a CamtrapDP dataset where events were already defined
      const media = [
        // Event 1: Fox visit (3 images)
        createMediaWithEventID('img001', '2024-01-15T08:00:00Z', 'evt-fox-morning'),
        createMediaWithEventID('img002', '2024-01-15T08:00:02Z', 'evt-fox-morning'),
        createMediaWithEventID('img003', '2024-01-15T08:00:05Z', 'evt-fox-morning'),
        // Event 2: Deer visit (2 images)
        createMediaWithEventID('img004', '2024-01-15T14:30:00Z', 'evt-deer-afternoon'),
        createMediaWithEventID('img005', '2024-01-15T14:30:03Z', 'evt-deer-afternoon'),
        // Standalone image (no event)
        { mediaID: 'img006', timestamp: '2024-01-15T12:00:00Z' }
      ]
      const result = groupMediaByEventID(media)

      assert.equal(result.length, 3)

      const foxEvent = result.find((seq) => seq.id === 'evt-fox-morning')
      assert.equal(foxEvent.items.length, 3)

      const deerEvent = result.find((seq) => seq.id === 'evt-deer-afternoon')
      assert.equal(deerEvent.items.length, 2)

      const standalone = result.find((seq) => seq.id === 'img006')
      assert.equal(standalone.items.length, 1)
    })

    test('handles large number of events', () => {
      const media = []
      for (let i = 0; i < 100; i++) {
        const eventID = `event${Math.floor(i / 3)}` // 3 items per event
        const timestamp = new Date(baseTime.getTime() + i * 1000).toISOString()
        media.push(createMediaWithEventID(`img${i}`, timestamp, eventID))
      }
      const result = groupMediaByEventID(media)

      // Should have ~34 events (100 items / 3 items per event, with rounding)
      assert.equal(result.length, 34)
      // Most events should have 3 items, last might have 1
      assert.equal(result.filter((seq) => seq.items.length === 3).length, 33)
    })

    test('mixed dataset with some media having events and some not', () => {
      const media = []
      for (let i = 0; i < 20; i++) {
        const timestamp = new Date(baseTime.getTime() + i * 1000).toISOString()
        if (i % 2 === 0) {
          // Even items belong to events
          media.push(createMediaWithEventID(`img${i}`, timestamp, `event${Math.floor(i / 4)}`))
        } else {
          // Odd items have no event
          media.push({ mediaID: `img${i}`, timestamp })
        }
      }
      const result = groupMediaByEventID(media)

      // Should have event groups + individual items
      const eventGroups = result.filter((seq) => seq.id.startsWith('event'))
      const individualItems = result.filter((seq) => seq.id.startsWith('img'))

      assert.equal(eventGroups.length, 5) // events 0-4
      assert.equal(individualItems.length, 10) // odd numbered items
    })
  })
})
