import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  calculateSequenceAwareDailyActivity
} from '../../src/renderer/src/utils/sequenceAwareSpeciesCount.js'

// Helper: Create an observation by media record
function createObservation(
  scientificName,
  mediaID,
  timestamp,
  deploymentID = 'default-deployment',
  eventID = null,
  fileMediatype = 'image/jpeg',
  count = 1
) {
  return {
    scientificName,
    mediaID,
    timestamp,
    deploymentID,
    eventID,
    fileMediatype,
    count
  }
}

// Helper: Create observation with week info
function createObservationWithWeek(
  scientificName,
  mediaID,
  timestamp,
  weekStart,
  deploymentID = 'default-deployment',
  count = 1
) {
  return {
    scientificName,
    mediaID,
    timestamp,
    deploymentID,
    eventID: null,
    fileMediatype: 'image/jpeg',
    weekStart,
    count
  }
}

// Helper: Create observation with location info
function createObservationWithLocation(
  scientificName,
  mediaID,
  timestamp,
  latitude,
  longitude,
  locationName,
  deploymentID = 'default-deployment',
  count = 1
) {
  return {
    scientificName,
    mediaID,
    timestamp,
    deploymentID,
    eventID: null,
    fileMediatype: 'image/jpeg',
    latitude,
    longitude,
    locationName,
    count
  }
}

// Helper: Create observation with hour info
function createObservationWithHour(
  scientificName,
  mediaID,
  timestamp,
  hour,
  deploymentID = 'default-deployment',
  count = 1
) {
  return {
    scientificName,
    mediaID,
    timestamp,
    deploymentID,
    eventID: null,
    fileMediatype: 'image/jpeg',
    hour,
    count
  }
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

  describe('single sequence with multiple media', () => {
    test('takes max count within sequence', () => {
      // Sequence: Photo A (2 deer), Photo B (3 deer), Photo C (1 deer) → max deer = 3
      const observations = [
        createObservation(
          'Deer',
          'a',
          new Date(baseTime.getTime()).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          2
        ),
        createObservation(
          'Deer',
          'b',
          new Date(baseTime.getTime() + 5000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          3
        ),
        createObservation(
          'Deer',
          'c',
          new Date(baseTime.getTime() + 10000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          1
        )
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 3) // Max of 2, 3, 1
    })

    test('multiple species in same sequence - takes max of each', () => {
      const observations = [
        createObservation(
          'Deer',
          'a',
          new Date(baseTime.getTime()).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          2
        ),
        createObservation(
          'Fox',
          'a',
          new Date(baseTime.getTime()).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          1
        ),
        createObservation(
          'Deer',
          'b',
          new Date(baseTime.getTime() + 5000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          1
        ),
        createObservation(
          'Fox',
          'b',
          new Date(baseTime.getTime() + 5000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          2
        )
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 2)
      const deer = result.find((s) => s.scientificName === 'Deer')
      const fox = result.find((s) => s.scientificName === 'Fox')
      assert.equal(deer.count, 2) // Max of 2, 1
      assert.equal(fox.count, 2) // Max of 1, 2
    })
  })

  describe('multiple sequences', () => {
    test('sums max counts across sequences', () => {
      // Sequence 1: Photo A (2 deer), Photo B (3 deer) → max deer = 3
      // Sequence 2: Photo D (5 deer), Photo E (2 deer) → max deer = 5
      // Total deer = 3 + 5 = 8
      const observations = [
        // Sequence 1
        createObservation(
          'Deer',
          'a',
          new Date(baseTime.getTime()).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          2
        ),
        createObservation(
          'Deer',
          'b',
          new Date(baseTime.getTime() + 5000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          3
        ),
        // Sequence 2 (120+ seconds later)
        createObservation(
          'Deer',
          'd',
          new Date(baseTime.getTime() + 200000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          5
        ),
        createObservation(
          'Deer',
          'e',
          new Date(baseTime.getTime() + 205000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          2
        )
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 8) // 3 + 5
    })

    test('different deployments create separate sequences', () => {
      const observations = [
        createObservation(
          'Deer',
          'a',
          new Date(baseTime.getTime()).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          3
        ),
        createObservation(
          'Deer',
          'b',
          new Date(baseTime.getTime() + 5000).toISOString(),
          'dep2',
          null,
          'image/jpeg',
          2
        )
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 5) // 3 + 2 (different deployments = different sequences)
    })
  })

  describe('gap = 0 (eventID grouping)', () => {
    test('groups by eventID when gap is 0', () => {
      const observations = [
        createObservation(
          'Deer',
          'a',
          new Date(baseTime.getTime()).toISOString(),
          'dep1',
          'event1',
          'image/jpeg',
          2
        ),
        createObservation(
          'Deer',
          'b',
          new Date(baseTime.getTime() + 5000).toISOString(),
          'dep1',
          'event1',
          'image/jpeg',
          4
        ),
        createObservation(
          'Deer',
          'c',
          new Date(baseTime.getTime() + 100000).toISOString(),
          'dep1',
          'event2',
          'image/jpeg',
          3
        )
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 0)

      assert.equal(result.length, 1)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 7) // max(2,4) + 3 = 4 + 3 = 7
    })
  })

  describe('videos (not grouped)', () => {
    test('videos form individual sequences', () => {
      const observations = [
        createObservation(
          'Deer',
          'vid1',
          new Date(baseTime.getTime()).toISOString(),
          'dep1',
          null,
          'video/mp4',
          3
        ),
        createObservation(
          'Deer',
          'vid2',
          new Date(baseTime.getTime() + 5000).toISOString(),
          'dep1',
          null,
          'video/mp4',
          2
        )
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 5) // 3 + 2 (videos not grouped)
    })
  })

  describe('null timestamps', () => {
    test('null timestamp media form individual sequences', () => {
      const observations = [
        createObservation('Deer', 'a', null, 'dep1', null, 'image/jpeg', 3),
        createObservation('Deer', 'b', null, 'dep1', null, 'image/jpeg', 2)
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 1)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 5) // 3 + 2 (null timestamps = individual sequences)
    })
  })

  describe('sorting', () => {
    test('results sorted by count descending', () => {
      const observations = [
        createObservation(
          'Fox',
          'a',
          new Date(baseTime.getTime()).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          1
        ),
        createObservation(
          'Deer',
          'b',
          new Date(baseTime.getTime() + 200000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          5
        ),
        createObservation(
          'Bear',
          'c',
          new Date(baseTime.getTime() + 400000).toISOString(),
          'dep1',
          null,
          'image/jpeg',
          3
        )
      ]
      const result = calculateSequenceAwareSpeciesCounts(observations, 60)

      assert.equal(result.length, 3)
      assert.equal(result[0].scientificName, 'Deer')
      assert.equal(result[0].count, 5)
      assert.equal(result[1].scientificName, 'Bear')
      assert.equal(result[1].count, 3)
      assert.equal(result[2].scientificName, 'Fox')
      assert.equal(result[2].count, 1)
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
    test('groups counts by week', () => {
      const observations = [
        createObservationWithWeek('Deer', 'a', baseTime.toISOString(), '2024-01-08', 'dep1', 2),
        createObservationWithWeek('Deer', 'b', baseTime.toISOString(), '2024-01-08', 'dep1', 3),
        createObservationWithWeek(
          'Deer',
          'c',
          new Date(baseTime.getTime() + 1000000000).toISOString(),
          '2024-01-22',
          'dep1',
          4
        )
      ]
      const result = calculateSequenceAwareTimeseries(observations, 60)

      assert.equal(result.timeseries.length, 2)
      const week1 = result.timeseries.find((w) => w.date === '2024-01-08')
      const week2 = result.timeseries.find((w) => w.date === '2024-01-22')

      assert.equal(week1.Deer, 3) // max(2, 3) in same sequence
      assert.equal(week2.Deer, 4)
    })
  })
})

describe('calculateSequenceAwareHeatmap', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('edge cases', () => {
    test('empty array returns empty result', () => {
      const result = calculateSequenceAwareHeatmap([], 60)
      assert.deepEqual(result, {})
    })
  })

  describe('location aggregation', () => {
    test('groups counts by location', () => {
      const observations = [
        createObservationWithLocation(
          'Deer',
          'a',
          baseTime.toISOString(),
          45.5,
          -122.5,
          'Location A',
          'dep1',
          2
        ),
        createObservationWithLocation(
          'Deer',
          'b',
          new Date(baseTime.getTime() + 5000).toISOString(),
          45.5,
          -122.5,
          'Location A',
          'dep1',
          3
        ),
        createObservationWithLocation(
          'Deer',
          'c',
          new Date(baseTime.getTime() + 200000).toISOString(),
          46.0,
          -123.0,
          'Location B',
          'dep2',
          5
        )
      ]
      const result = calculateSequenceAwareHeatmap(observations, 60)

      assert.ok(result.Deer)
      assert.equal(result.Deer.length, 2)

      const locationA = result.Deer.find((l) => l.locationName === 'Location A')
      const locationB = result.Deer.find((l) => l.locationName === 'Location B')

      assert.equal(locationA.count, 3) // max(2, 3) in same sequence
      assert.equal(locationB.count, 5)
    })
  })
})

describe('calculateSequenceAwareDailyActivity', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('edge cases', () => {
    test('empty array returns array of zeros', () => {
      const result = calculateSequenceAwareDailyActivity([], 60, ['Deer'])
      assert.equal(result.length, 24)
      assert.equal(result[0].hour, 0)
      assert.equal(result[0].Deer, 0)
    })
  })

  describe('hourly aggregation', () => {
    test('groups counts by hour', () => {
      const observations = [
        createObservationWithHour('Deer', 'a', baseTime.toISOString(), 10, 'dep1', 2),
        createObservationWithHour(
          'Deer',
          'b',
          new Date(baseTime.getTime() + 5000).toISOString(),
          10,
          'dep1',
          3
        ),
        createObservationWithHour(
          'Deer',
          'c',
          new Date(baseTime.getTime() + 200000).toISOString(),
          14,
          'dep1',
          5
        )
      ]
      const result = calculateSequenceAwareDailyActivity(observations, 60, ['Deer'])

      assert.equal(result.length, 24)
      assert.equal(result[10].Deer, 3) // max(2, 3) in same hour/sequence
      assert.equal(result[14].Deer, 5)
      assert.equal(result[0].Deer, 0) // No observations at hour 0
    })

    test('multiple species tracked separately', () => {
      const observations = [
        createObservationWithHour('Deer', 'a', baseTime.toISOString(), 10, 'dep1', 2),
        createObservationWithHour('Fox', 'a', baseTime.toISOString(), 10, 'dep1', 1)
      ]
      const result = calculateSequenceAwareDailyActivity(observations, 60, ['Deer', 'Fox'])

      assert.equal(result[10].Deer, 2)
      assert.equal(result[10].Fox, 1)
    })
  })
})
