import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupMediaIntoSequences } from '../src/renderer/src/utils/sequenceGrouping.js'

// Helper: Create a media item with timestamp
function createMedia(id, timestamp) {
  return { mediaID: id, timestamp }
}

// Helper: Create media at offset from base time
function createMediaAtOffset(id, baseTime, offsetSeconds) {
  const time = new Date(baseTime.getTime() + offsetSeconds * 1000)
  return { mediaID: id, timestamp: time.toISOString() }
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
})
