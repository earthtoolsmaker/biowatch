import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// Since the function is not exported, we'll recreate it here for testing
// This mirrors the implementation in src/main/export.js

/**
 * Group observations into sequences based on deployment and timestamp gap.
 * When gapThresholdSeconds <= 0, returns null to signal that existing eventIDs should be preserved.
 *
 * @param {Array} observations - Observations with eventStart/timestamp and deploymentID
 * @param {number} gapThresholdSeconds - Maximum gap in seconds for grouping (0 = preserve existing)
 * @returns {Map|null} Map of observationID -> {eventID, eventStart, eventEnd}, or null to preserve existing
 */
function groupObservationsIntoSequences(observations, gapThresholdSeconds) {
  if (gapThresholdSeconds <= 0) {
    // No grouping - preserve existing eventID/eventStart/eventEnd from database
    return null
  }

  // Group observations by deployment first
  const byDeployment = {}
  for (const obs of observations) {
    const depId = obs.deploymentID || '__none__'
    if (!byDeployment[depId]) byDeployment[depId] = []
    byDeployment[depId].push(obs)
  }

  // Build mapping of observationID -> sequence data
  const eventMapping = new Map()

  for (const [depId, depObs] of Object.entries(byDeployment)) {
    // Sort by timestamp (using eventStart or fallback to timestamp field)
    depObs.sort((a, b) => {
      const timeA = new Date(a.eventStart || a.timestamp || 0).getTime()
      const timeB = new Date(b.eventStart || b.timestamp || 0).getTime()
      return timeA - timeB
    })

    let currentSeq = null
    let seqCounter = 0
    const gapMs = gapThresholdSeconds * 1000

    for (const obs of depObs) {
      const obsTime = new Date(obs.eventStart || obs.timestamp || 0).getTime()

      // Check if we should start a new sequence
      const shouldStartNew = !currentSeq || isNaN(obsTime) || obsTime - currentSeq.maxTime > gapMs

      if (shouldStartNew) {
        // Save previous sequence
        if (currentSeq) {
          finalizeSequence(currentSeq, eventMapping)
        }

        seqCounter++
        const sanitizedDepId = depId === '__none__' ? 'unknown' : depId
        currentSeq = {
          eventID: `${sanitizedDepId}_seq_${String(seqCounter).padStart(4, '0')}`,
          minTime: isNaN(obsTime) ? null : obsTime,
          maxTime: isNaN(obsTime) ? null : obsTime,
          observations: [obs]
        }
      } else {
        // Add to current sequence
        currentSeq.observations.push(obs)
        if (!isNaN(obsTime)) {
          if (currentSeq.minTime === null || obsTime < currentSeq.minTime) {
            currentSeq.minTime = obsTime
          }
          if (currentSeq.maxTime === null || obsTime > currentSeq.maxTime) {
            currentSeq.maxTime = obsTime
          }
        }
      }
    }

    // Don't forget the last sequence
    if (currentSeq) {
      finalizeSequence(currentSeq, eventMapping)
    }
  }

  return eventMapping
}

/**
 * Helper to finalize a sequence and add all its observations to the mapping
 */
function finalizeSequence(seq, eventMapping) {
  const eventStart = seq.minTime ? new Date(seq.minTime).toISOString() : null
  const eventEnd = seq.maxTime ? new Date(seq.maxTime).toISOString() : null

  for (const obs of seq.observations) {
    eventMapping.set(obs.observationID, {
      eventID: seq.eventID,
      eventStart,
      eventEnd
    })
  }
}

// Helper: Create observation at offset from base time
function createObsAtOffset(id, deploymentID, baseTime, offsetSeconds) {
  const time = new Date(baseTime.getTime() + offsetSeconds * 1000)
  return { observationID: id, deploymentID, eventStart: time.toISOString() }
}

describe('groupObservationsIntoSequences (export)', () => {
  const baseTime = new Date('2024-01-15T10:00:00Z')

  describe('preserve existing behavior', () => {
    test('gap threshold = 0 returns null (preserve existing)', () => {
      const observations = [createObsAtOffset('obs1', 'dep1', baseTime, 0)]
      const result = groupObservationsIntoSequences(observations, 0)

      assert.equal(result, null)
    })

    test('negative gap threshold returns null (preserve existing)', () => {
      const observations = [createObsAtOffset('obs1', 'dep1', baseTime, 0)]
      const result = groupObservationsIntoSequences(observations, -10)

      assert.equal(result, null)
    })
  })

  describe('basic grouping', () => {
    test('observations within threshold are grouped', () => {
      const observations = [
        createObsAtOffset('obs1', 'dep1', baseTime, 0),
        createObsAtOffset('obs2', 'dep1', baseTime, 30) // 30 seconds apart
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      assert.ok(result instanceof Map)
      assert.equal(result.size, 2)

      // Both should have the same eventID
      const event1 = result.get('obs1')
      const event2 = result.get('obs2')
      assert.equal(event1.eventID, event2.eventID)
      assert.equal(event1.eventID, 'dep1_seq_0001')
    })

    test('observations outside threshold are separate sequences', () => {
      const observations = [
        createObsAtOffset('obs1', 'dep1', baseTime, 0),
        createObsAtOffset('obs2', 'dep1', baseTime, 120) // 120 seconds apart
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      const event1 = result.get('obs1')
      const event2 = result.get('obs2')
      assert.notEqual(event1.eventID, event2.eventID)
      assert.equal(event1.eventID, 'dep1_seq_0001')
      assert.equal(event2.eventID, 'dep1_seq_0002')
    })

    test('multiple sequences form correctly', () => {
      const observations = [
        createObsAtOffset('a', 'dep1', baseTime, 0),
        createObsAtOffset('b', 'dep1', baseTime, 30),
        createObsAtOffset('c', 'dep1', baseTime, 200),
        createObsAtOffset('d', 'dep1', baseTime, 210),
        createObsAtOffset('e', 'dep1', baseTime, 500)
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      const eventA = result.get('a')
      const eventB = result.get('b')
      const eventC = result.get('c')
      const eventD = result.get('d')
      const eventE = result.get('e')

      // a and b in same sequence
      assert.equal(eventA.eventID, eventB.eventID)
      // c and d in same sequence
      assert.equal(eventC.eventID, eventD.eventID)
      // e in its own sequence
      assert.notEqual(eventE.eventID, eventD.eventID)

      // Check sequence numbering
      assert.equal(eventA.eventID, 'dep1_seq_0001')
      assert.equal(eventC.eventID, 'dep1_seq_0002')
      assert.equal(eventE.eventID, 'dep1_seq_0003')
    })
  })

  describe('deployment-based grouping', () => {
    test('different deployments create separate sequences even within threshold', () => {
      const observations = [
        createObsAtOffset('obs1', 'dep1', baseTime, 0),
        createObsAtOffset('obs2', 'dep2', baseTime, 5) // 5 seconds apart but different deployment
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      const event1 = result.get('obs1')
      const event2 = result.get('obs2')
      assert.notEqual(event1.eventID, event2.eventID)
      assert.equal(event1.eventID, 'dep1_seq_0001')
      assert.equal(event2.eventID, 'dep2_seq_0001')
    })

    test('null deploymentID creates unknown sequences', () => {
      const observations = [
        createObsAtOffset('obs1', null, baseTime, 0),
        createObsAtOffset('obs2', null, baseTime, 30)
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      const event1 = result.get('obs1')
      const event2 = result.get('obs2')
      // Null deployments are grouped together when within threshold
      assert.equal(event1.eventID, event2.eventID)
      assert.equal(event1.eventID, 'unknown_seq_0001')
    })

    test('multiple sequences per deployment', () => {
      const observations = [
        createObsAtOffset('a1', 'dep1', baseTime, 0),
        createObsAtOffset('a2', 'dep1', baseTime, 5),
        createObsAtOffset('a3', 'dep1', baseTime, 7200), // 2 hours later
        createObsAtOffset('a4', 'dep1', baseTime, 7205)
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      const eventA1 = result.get('a1')
      const eventA2 = result.get('a2')
      const eventA3 = result.get('a3')
      const eventA4 = result.get('a4')

      assert.equal(eventA1.eventID, eventA2.eventID)
      assert.equal(eventA3.eventID, eventA4.eventID)
      assert.notEqual(eventA1.eventID, eventA3.eventID)
    })
  })

  describe('event times', () => {
    test('eventStart and eventEnd are set correctly for single item', () => {
      const observations = [createObsAtOffset('obs1', 'dep1', baseTime, 0)]
      const result = groupObservationsIntoSequences(observations, 60)

      const event1 = result.get('obs1')
      assert.equal(event1.eventStart, baseTime.toISOString())
      assert.equal(event1.eventEnd, baseTime.toISOString())
    })

    test('eventStart and eventEnd span the sequence', () => {
      const observations = [
        createObsAtOffset('obs1', 'dep1', baseTime, 0),
        createObsAtOffset('obs2', 'dep1', baseTime, 30),
        createObsAtOffset('obs3', 'dep1', baseTime, 50)
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      const event1 = result.get('obs1')
      assert.equal(event1.eventStart, baseTime.toISOString())
      assert.equal(event1.eventEnd, new Date(baseTime.getTime() + 50000).toISOString())
    })
  })

  describe('eventID format', () => {
    test('eventID follows expected format', () => {
      const observations = [createObsAtOffset('obs1', 'camera_trap_01', baseTime, 0)]
      const result = groupObservationsIntoSequences(observations, 60)

      const event1 = result.get('obs1')
      assert.equal(event1.eventID, 'camera_trap_01_seq_0001')
    })

    test('eventID uses zero-padded counter', () => {
      // Create 11 separate sequences
      const observations = []
      for (let i = 0; i < 11; i++) {
        observations.push(createObsAtOffset(`obs${i}`, 'dep1', baseTime, i * 1000)) // 1000 seconds apart
      }
      const result = groupObservationsIntoSequences(observations, 60)

      assert.equal(result.get('obs0').eventID, 'dep1_seq_0001')
      assert.equal(result.get('obs9').eventID, 'dep1_seq_0010')
      assert.equal(result.get('obs10').eventID, 'dep1_seq_0011')
    })
  })

  describe('edge cases', () => {
    test('empty observations array', () => {
      const result = groupObservationsIntoSequences([], 60)
      assert.ok(result instanceof Map)
      assert.equal(result.size, 0)
    })

    test('observations with missing eventStart uses timestamp field', () => {
      const obs = { observationID: 'obs1', deploymentID: 'dep1', timestamp: baseTime.toISOString() }
      const result = groupObservationsIntoSequences([obs], 60)

      const event = result.get('obs1')
      assert.equal(event.eventStart, baseTime.toISOString())
    })

    test('boundary: gap exactly equal to threshold stays grouped', () => {
      const observations = [
        createObsAtOffset('obs1', 'dep1', baseTime, 0),
        createObsAtOffset('obs2', 'dep1', baseTime, 60) // exactly 60 seconds
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      const event1 = result.get('obs1')
      const event2 = result.get('obs2')
      assert.equal(event1.eventID, event2.eventID)
    })

    test('boundary: gap 1 second over threshold creates new sequence', () => {
      const observations = [
        createObsAtOffset('obs1', 'dep1', baseTime, 0),
        createObsAtOffset('obs2', 'dep1', baseTime, 61) // 61 seconds
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      const event1 = result.get('obs1')
      const event2 = result.get('obs2')
      assert.notEqual(event1.eventID, event2.eventID)
    })

    test('unsorted observations are sorted by timestamp', () => {
      const observations = [
        createObsAtOffset('obs3', 'dep1', baseTime, 50),
        createObsAtOffset('obs1', 'dep1', baseTime, 0),
        createObsAtOffset('obs2', 'dep1', baseTime, 30)
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      // All should be in same sequence since they're within 60 seconds
      const event1 = result.get('obs1')
      const event2 = result.get('obs2')
      const event3 = result.get('obs3')
      assert.equal(event1.eventID, event2.eventID)
      assert.equal(event2.eventID, event3.eventID)

      // Event times should span the full range
      assert.equal(event1.eventStart, baseTime.toISOString())
      assert.equal(event1.eventEnd, new Date(baseTime.getTime() + 50000).toISOString())
    })
  })

  describe('real-world scenarios', () => {
    test('camera trap burst mode (rapid shots)', () => {
      const observations = [
        createObsAtOffset('obs1', 'cam1', baseTime, 0),
        createObsAtOffset('obs2', 'cam1', baseTime, 1),
        createObsAtOffset('obs3', 'cam1', baseTime, 2)
      ]
      const result = groupObservationsIntoSequences(observations, 10)

      // All in one sequence
      const event1 = result.get('obs1')
      const event2 = result.get('obs2')
      const event3 = result.get('obs3')
      assert.equal(event1.eventID, event2.eventID)
      assert.equal(event2.eventID, event3.eventID)
    })

    test('multiple animal visits throughout day', () => {
      const observations = [
        // Morning visit
        createObsAtOffset('m1', 'cam1', baseTime, 0),
        createObsAtOffset('m2', 'cam1', baseTime, 5),
        // Noon visit (4 hours later)
        createObsAtOffset('n1', 'cam1', baseTime, 14400),
        createObsAtOffset('n2', 'cam1', baseTime, 14405),
        // Evening visit (8 hours later)
        createObsAtOffset('e1', 'cam1', baseTime, 28800)
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      assert.equal(result.get('m1').eventID, result.get('m2').eventID) // morning
      assert.equal(result.get('n1').eventID, result.get('n2').eventID) // noon
      assert.notEqual(result.get('m1').eventID, result.get('n1').eventID)
      assert.notEqual(result.get('n1').eventID, result.get('e1').eventID)
    })

    test('multi-camera setup with simultaneous triggers', () => {
      const observations = [
        createObsAtOffset('cam_a_1', 'camera_A', baseTime, 0),
        createObsAtOffset('cam_a_2', 'camera_A', baseTime, 1),
        createObsAtOffset('cam_b_1', 'camera_B', baseTime, 2),
        createObsAtOffset('cam_b_2', 'camera_B', baseTime, 3)
      ]
      const result = groupObservationsIntoSequences(observations, 60)

      // Camera A observations in one sequence
      assert.equal(result.get('cam_a_1').eventID, result.get('cam_a_2').eventID)
      // Camera B observations in another sequence
      assert.equal(result.get('cam_b_1').eventID, result.get('cam_b_2').eventID)
      // Different cameras have different sequences
      assert.notEqual(result.get('cam_a_1').eventID, result.get('cam_b_1').eventID)
    })
  })
})
