import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  calculateSequenceAwareDailyActivity
} from '../../../../src/main/services/sequences/speciesCounts.js'

// Helper: Create an observation record
function createObservation(
  scientificName,
  mediaID,
  timestamp,
  count = 1,
  deploymentID = 'dep1',
  eventID = null
) {
  return {
    scientificName,
    mediaID,
    timestamp,
    count,
    deploymentID,
    eventID,
    fileMediatype: 'image/jpeg'
  }
}

// Helper: Create observation at offset from base time
function createObservationAtOffset(
  scientificName,
  mediaID,
  baseTime,
  offsetSeconds,
  count = 1,
  deploymentID = 'dep1'
) {
  const time = new Date(baseTime.getTime() + offsetSeconds * 1000)
  return createObservation(scientificName, mediaID, time.toISOString(), count, deploymentID)
}

describe('calculateSequenceAwareSpeciesCounts', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('edge cases', () => {
    test('empty array returns empty result', () => {
      const result = calculateSequenceAwareSpeciesCounts([], 60)
      assert.deepEqual(result, [])
    })

    test('null input returns empty result', () => {
      const result = calculateSequenceAwareSpeciesCounts(null, 60)
      assert.deepEqual(result, [])
    })

    test('undefined input returns empty result', () => {
      const result = calculateSequenceAwareSpeciesCounts(undefined, 60)
      assert.deepEqual(result, [])
    })
  })

  describe('basic counting', () => {
    test('single observation returns correct count', () => {
      const observations = [createObservationAtOffset('Deer', 'media1', baseTime, 0, 3)]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 3)
    })

    test('multiple species are counted separately', () => {
      const observations = [
        createObservationAtOffset('Deer', 'media1', baseTime, 0, 2),
        createObservationAtOffset('Fox', 'media2', baseTime, 5, 1)
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 2)
      const deer = result.find((r) => r.scientificName === 'Deer')
      const fox = result.find((r) => r.scientificName === 'Fox')
      assert.equal(deer.count, 2)
      assert.equal(fox.count, 1)
    })

    test('results are sorted by count descending', () => {
      const observations = [
        createObservationAtOffset('Fox', 'media1', baseTime, 0, 1),
        createObservationAtOffset('Deer', 'media2', baseTime, 100, 5),
        createObservationAtOffset('Bear', 'media3', baseTime, 200, 3)
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[1].scientificName, 'Bear')
      assert.equal(result[2].scientificName, 'Fox')
    })
  })

  describe('sequence-aware max counting', () => {
    test('takes max count within sequence, not sum', () => {
      // Three photos of deer in same sequence: 2, 5, 3 deer
      // Should return 5 (max), not 10 (sum)
      const observations = [
        createObservationAtOffset('Deer', 'media1', baseTime, 0, 2),
        createObservationAtOffset('Deer', 'media2', baseTime, 10, 5),
        createObservationAtOffset('Deer', 'media3', baseTime, 20, 3)
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 5)
    })

    test('sums max counts across different sequences', () => {
      // Sequence 1: 2, 5 deer -> max = 5
      // Sequence 2: 3, 4 deer -> max = 4
      // Total should be 9
      const observations = [
        createObservationAtOffset('Deer', 'media1', baseTime, 0, 2),
        createObservationAtOffset('Deer', 'media2', baseTime, 10, 5),
        createObservationAtOffset('Deer', 'media3', baseTime, 200, 3), // new sequence
        createObservationAtOffset('Deer', 'media4', baseTime, 210, 4)
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 9) // 5 + 4
    })

    test('handles multiple species in same sequence correctly', () => {
      // Same sequence, different species
      const observations = [
        createObservationAtOffset('Deer', 'media1', baseTime, 0, 3),
        createObservationAtOffset('Fox', 'media1', baseTime, 0, 1),
        createObservationAtOffset('Deer', 'media2', baseTime, 10, 2),
        createObservationAtOffset('Fox', 'media2', baseTime, 10, 2)
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      const deer = result.find((r) => r.scientificName === 'Deer')
      const fox = result.find((r) => r.scientificName === 'Fox')
      assert.equal(deer.count, 3) // max(3, 2)
      assert.equal(fox.count, 2) // max(1, 2)
    })
  })

  describe('null timestamp handling', () => {
    test('null timestamp media are treated as individual sequences', () => {
      const observations = [
        createObservation('Deer', 'media1', null, 3),
        createObservation('Deer', 'media2', null, 2)
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      // Each null-timestamp media is its own sequence, so counts add up
      assert.equal(result[0].count, 5) // 3 + 2
    })

    test('mixed null and valid timestamps work correctly', () => {
      const observations = [
        createObservationAtOffset('Deer', 'media1', baseTime, 0, 2),
        createObservationAtOffset('Deer', 'media2', baseTime, 10, 3), // same sequence, max = 3
        createObservation('Deer', 'media3', null, 4) // separate sequence
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result[0].count, 7) // 3 (max of sequence) + 4 (null timestamp)
    })
  })

  describe('eventID-based grouping (gapSeconds = 0)', () => {
    test('groups by eventID when gapSeconds is 0', () => {
      const observations = [
        createObservation('Deer', 'media1', baseTime.toISOString(), 2, 'dep1', 'event1'),
        createObservation('Deer', 'media2', baseTime.toISOString(), 5, 'dep1', 'event1'),
        createObservation('Deer', 'media3', baseTime.toISOString(), 3, 'dep1', 'event2')
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 0)

      // event1: max(2, 5) = 5, event2: 3
      assert.equal(result[0].count, 8) // 5 + 3
    })
  })
})

describe('calculateSequenceAwareTimeseries', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('edge cases', () => {
    test('empty array returns empty result', () => {
      const result = calculateSequenceAwareTimeseries([], 60)
      assert.deepEqual(result.timeseries, [])
      assert.deepEqual(result.allSpecies, [])
    })

    test('null input returns empty result', () => {
      const result = calculateSequenceAwareTimeseries(null, 60)
      assert.deepEqual(result.timeseries, [])
      assert.deepEqual(result.allSpecies, [])
    })
  })

  describe('weekly aggregation', () => {
    test('groups observations by week', () => {
      const week1 = new Date('2024-01-15T10:00:00Z')
      const week2 = new Date('2024-01-22T10:00:00Z')

      const observations = [
        { ...createObservationAtOffset('Deer', 'media1', week1, 0, 3), weekStart: '2024-01-15' },
        { ...createObservationAtOffset('Deer', 'media2', week2, 0, 2), weekStart: '2024-01-22' }
      ]
      const result = calculateSequenceAwareTimeseries(observations, 60)

      assert.equal(result.timeseries.length, 2)
      assert.equal(result.timeseries[0].date, '2024-01-15')
      assert.equal(result.timeseries[0].Deer, 3)
      assert.equal(result.timeseries[1].date, '2024-01-22')
      assert.equal(result.timeseries[1].Deer, 2)
    })

    test('computes weekStart from timestamp if weekStart is null', () => {
      const observations = [
        createObservationAtOffset('Deer', 'media1', baseTime, 0, 3) // weekStart not set
      ]
      const result = calculateSequenceAwareTimeseries(observations, 60)

      assert.equal(result.timeseries.length, 1)
      // Should compute Monday of that week
      assert.ok(result.timeseries[0].date)
    })

    test('returns allSpecies sorted by total count', () => {
      const observations = [
        { ...createObservationAtOffset('Fox', 'media1', baseTime, 0, 1), weekStart: '2024-01-15' },
        {
          ...createObservationAtOffset('Deer', 'media2', baseTime, 100, 5),
          weekStart: '2024-01-15'
        }
      ]
      const result = calculateSequenceAwareTimeseries(observations, 60)

      assert.equal(result.allSpecies[0].scientificName, 'Deer')
      assert.equal(result.allSpecies[1].scientificName, 'Fox')
    })
  })
})

describe('calculateSequenceAwareHeatmap', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('edge cases', () => {
    test('empty array returns empty object', () => {
      const result = calculateSequenceAwareHeatmap([], 60)
      assert.deepEqual(result, {})
    })

    test('null input returns empty object', () => {
      const result = calculateSequenceAwareHeatmap(null, 60)
      assert.deepEqual(result, {})
    })
  })

  describe('location grouping', () => {
    test('groups by lat/lng and applies sequence-aware counting', () => {
      const observations = [
        {
          ...createObservationAtOffset('Deer', 'media1', baseTime, 0, 3),
          latitude: 45.5,
          longitude: -122.5,
          locationName: 'Site A'
        },
        {
          ...createObservationAtOffset('Deer', 'media2', baseTime, 10, 5),
          latitude: 45.5,
          longitude: -122.5,
          locationName: 'Site A'
        }
      ]
      const result = calculateSequenceAwareHeatmap(observations, 60)

      assert.ok(result.Deer)
      assert.equal(result.Deer.length, 1)
      assert.equal(result.Deer[0].count, 5) // max within sequence
      assert.equal(result.Deer[0].lat, 45.5)
      assert.equal(result.Deer[0].lng, -122.5)
    })

    test('skips observations without coordinates', () => {
      const observations = [
        createObservationAtOffset('Deer', 'media1', baseTime, 0, 3) // no lat/lng
      ]
      const result = calculateSequenceAwareHeatmap(observations, 60)

      assert.deepEqual(result, {})
    })
  })
})

describe('calculateSequenceAwareDailyActivity', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('edge cases', () => {
    test('empty array returns hourly structure with zeros', () => {
      const result = calculateSequenceAwareDailyActivity([], 60, ['Deer'])
      assert.equal(result.length, 24)
      assert.equal(result[0].hour, 0)
      assert.equal(result[0].Deer, 0)
    })

    test('null input returns hourly structure with zeros', () => {
      const result = calculateSequenceAwareDailyActivity(null, 60, ['Deer'])
      assert.equal(result.length, 24)
    })
  })

  describe('hourly aggregation', () => {
    test('groups observations by hour and applies sequence-aware counting', () => {
      const observations = [
        { ...createObservationAtOffset('Deer', 'media1', baseTime, 0, 3), hour: 10 },
        { ...createObservationAtOffset('Deer', 'media2', baseTime, 10, 5), hour: 10 }
      ]
      const result = calculateSequenceAwareDailyActivity(observations, 60, ['Deer'])

      assert.equal(result[10].Deer, 5) // max within sequence at hour 10
    })

    test('only includes selected species', () => {
      const observations = [
        { ...createObservationAtOffset('Deer', 'media1', baseTime, 0, 3), hour: 10 },
        { ...createObservationAtOffset('Fox', 'media2', baseTime, 100, 5), hour: 11 }
      ]
      const result = calculateSequenceAwareDailyActivity(observations, 60, ['Deer'])

      assert.equal(result[10].Deer, 3)
      assert.equal(result[11].Fox, undefined) // Fox not in selected species
    })

    test('skips invalid hours', () => {
      const observations = [
        { ...createObservationAtOffset('Deer', 'media1', baseTime, 0, 3), hour: 25 }, // invalid
        { ...createObservationAtOffset('Deer', 'media2', baseTime, 100, 5), hour: -1 } // invalid
      ]
      const result = calculateSequenceAwareDailyActivity(observations, 60, ['Deer'])

      // All hours should be 0 since observations had invalid hours
      assert.ok(result.every((h) => h.Deer === 0))
    })
  })
})
