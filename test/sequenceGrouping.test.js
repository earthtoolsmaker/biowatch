import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupMediaIntoSequences } from '../src/renderer/src/utils/sequenceGrouping.js'

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

  describe('video exclusion', () => {
    // Helper: Create media with video flag
    function createMediaWithVideo(
      id,
      baseTime,
      offsetSeconds,
      isVideo,
      deploymentID = 'default-deployment'
    ) {
      const time = new Date(baseTime.getTime() + offsetSeconds * 1000)
      return { mediaID: id, timestamp: time.toISOString(), deploymentID, isVideo }
    }

    // Video detection function for tests
    const isVideoFn = (media) => media.isVideo === true

    test('videos are never grouped with images', () => {
      const media = [
        createMediaWithVideo('img1', baseTime, 0, false),
        createMediaWithVideo('vid1', baseTime, 5, true),
        createMediaWithVideo('img2', baseTime, 10, false)
      ]
      const result = groupMediaIntoSequences(media, 60, isVideoFn)

      // Should have 3 sequences: img1+img2 grouped, vid1 separate
      // Actually since vid1 breaks the chain, we get: img1, vid1, img2 as separate
      // Wait - img1 and img2 are 10 seconds apart but vid1 in between breaks them
      assert.equal(result.length, 3)
      assert.equal(result[0].items[0].mediaID, 'img1')
      assert.equal(result[1].items[0].mediaID, 'vid1')
      assert.equal(result[2].items[0].mediaID, 'img2')
    })

    test('videos are never grouped with other videos', () => {
      const media = [
        createMediaWithVideo('vid1', baseTime, 0, true),
        createMediaWithVideo('vid2', baseTime, 5, true),
        createMediaWithVideo('vid3', baseTime, 10, true)
      ]
      const result = groupMediaIntoSequences(media, 60, isVideoFn)

      // Each video should be its own sequence
      assert.equal(result.length, 3)
      assert.equal(result[0].items.length, 1)
      assert.equal(result[1].items.length, 1)
      assert.equal(result[2].items.length, 1)
    })

    test('images still group normally when no videos present', () => {
      const media = [
        createMediaWithVideo('img1', baseTime, 0, false),
        createMediaWithVideo('img2', baseTime, 5, false),
        createMediaWithVideo('img3', baseTime, 10, false)
      ]
      const result = groupMediaIntoSequences(media, 60, isVideoFn)

      // All images should be grouped together
      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 3)
    })

    test('images group correctly around isolated videos', () => {
      const media = [
        createMediaWithVideo('img1', baseTime, 0, false),
        createMediaWithVideo('img2', baseTime, 5, false),
        createMediaWithVideo('vid1', baseTime, 100, true),
        createMediaWithVideo('img3', baseTime, 200, false),
        createMediaWithVideo('img4', baseTime, 205, false)
      ]
      const result = groupMediaIntoSequences(media, 60, isVideoFn)

      // img1+img2 grouped, vid1 alone, img3+img4 grouped
      assert.equal(result.length, 3)
      assert.equal(result[0].items.length, 2) // img1, img2
      assert.equal(result[1].items.length, 1) // vid1
      assert.equal(result[2].items.length, 2) // img3, img4
    })

    test('without isVideoFn, videos group normally (backwards compatible)', () => {
      const media = [
        createMediaWithVideo('vid1', baseTime, 0, true),
        createMediaWithVideo('vid2', baseTime, 5, true)
      ]
      // No isVideoFn passed - should group normally
      const result = groupMediaIntoSequences(media, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].items.length, 2)
    })

    test('video at start of sequence prevents grouping', () => {
      const media = [
        createMediaWithVideo('vid1', baseTime, 0, true),
        createMediaWithVideo('img1', baseTime, 5, false)
      ]
      const result = groupMediaIntoSequences(media, 60, isVideoFn)

      assert.equal(result.length, 2)
      assert.equal(result[0].items[0].mediaID, 'vid1')
      assert.equal(result[1].items[0].mediaID, 'img1')
    })

    test('video at end prevents being added to sequence', () => {
      const media = [
        createMediaWithVideo('img1', baseTime, 0, false),
        createMediaWithVideo('vid1', baseTime, 5, true)
      ]
      const result = groupMediaIntoSequences(media, 60, isVideoFn)

      assert.equal(result.length, 2)
      assert.equal(result[0].items[0].mediaID, 'img1')
      assert.equal(result[1].items[0].mediaID, 'vid1')
    })
  })
})
