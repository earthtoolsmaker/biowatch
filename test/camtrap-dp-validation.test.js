import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// Import the schemas and sanitizers
import { observationSchema } from '../src/main/export/camtrapDPSchemas.js'
import {
  sanitizeObservation,
  ensureTimezone,
  clampBboxDimension,
  clampBboxCoordinate,
  mapLifeStage,
  mapSex,
  mapClassificationMethod,
  sanitizeCount,
  sanitizeClassificationProbability
} from '../src/main/export/sanitizers.js'

/**
 * Helper to create a valid observation row for testing
 */
function createValidObservation(overrides = {}) {
  return {
    observationID: 'obs-001',
    deploymentID: 'dep-001',
    eventStart: '2024-01-15T10:30:00Z',
    eventEnd: '2024-01-15T10:31:00Z',
    observationLevel: 'media',
    observationType: 'animal',
    mediaID: null,
    eventID: null,
    scientificName: 'Canis lupus',
    count: 1,
    lifeStage: null,
    sex: null,
    behavior: null,
    bboxX: null,
    bboxY: null,
    bboxWidth: null,
    bboxHeight: null,
    classificationMethod: null,
    classifiedBy: null,
    classificationTimestamp: null,
    classificationProbability: null,
    ...overrides
  }
}

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe('CamtrapDP Observation Schema', () => {
  describe('required fields', () => {
    test('accepts valid observation with all required fields', () => {
      const obs = createValidObservation()
      const result = observationSchema.safeParse(obs)
      assert.equal(
        result.success,
        true,
        `Validation failed: ${JSON.stringify(result.error?.issues)}`
      )
    })

    test('rejects missing observationID', () => {
      const obs = createValidObservation({ observationID: '' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
      assert.ok(result.error.issues.some((i) => i.path.includes('observationID')))
    })

    test('rejects missing deploymentID', () => {
      const obs = createValidObservation({ deploymentID: '' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
      assert.ok(result.error.issues.some((i) => i.path.includes('deploymentID')))
    })

    test('rejects missing eventStart', () => {
      const obs = createValidObservation({ eventStart: null })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })

    test('rejects missing eventEnd', () => {
      const obs = createValidObservation({ eventEnd: null })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })

  describe('datetime format', () => {
    test('accepts ISO 8601 with Z timezone', () => {
      const obs = createValidObservation({ eventStart: '2024-01-15T10:30:00Z' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts ISO 8601 with +HH:MM timezone', () => {
      const obs = createValidObservation({ eventStart: '2024-01-15T10:30:00+02:00' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts ISO 8601 with -HH:MM timezone', () => {
      const obs = createValidObservation({ eventStart: '2024-01-15T10:30:00-05:00' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts ISO 8601 with milliseconds', () => {
      const obs = createValidObservation({ eventStart: '2024-01-15T10:30:00.123Z' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('rejects datetime without timezone', () => {
      const obs = createValidObservation({ eventStart: '2024-01-15T10:30:00' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })

  describe('observationType enum', () => {
    const validTypes = ['animal', 'human', 'vehicle', 'blank', 'unknown', 'unclassified']

    for (const type of validTypes) {
      test(`accepts observationType: ${type}`, () => {
        const obs = createValidObservation({ observationType: type })
        const result = observationSchema.safeParse(obs)
        assert.equal(result.success, true, `Should accept ${type}`)
      })
    }

    test('rejects invalid observationType', () => {
      const obs = createValidObservation({ observationType: 'invalid' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })

  describe('observationLevel enum', () => {
    test('accepts observationLevel: media', () => {
      const obs = createValidObservation({ observationLevel: 'media' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts observationLevel: event', () => {
      const obs = createValidObservation({ observationLevel: 'event' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('rejects invalid observationLevel', () => {
      const obs = createValidObservation({ observationLevel: 'invalid' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })

  describe('count constraints', () => {
    test('accepts count >= 1', () => {
      const obs = createValidObservation({ count: 5 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts count = 1', () => {
      const obs = createValidObservation({ count: 1 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts count = null', () => {
      const obs = createValidObservation({ count: null })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('rejects count = 0', () => {
      const obs = createValidObservation({ count: 0 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })

    test('rejects negative count', () => {
      const obs = createValidObservation({ count: -1 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })

  describe('bounding box constraints', () => {
    test('accepts bboxX/bboxY in 0-1 range', () => {
      const obs = createValidObservation({ bboxX: 0.5, bboxY: 0.5 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts bboxX = 0', () => {
      const obs = createValidObservation({ bboxX: 0 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts bboxX = 1', () => {
      const obs = createValidObservation({ bboxX: 1 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('rejects bboxX > 1', () => {
      const obs = createValidObservation({ bboxX: 1.5 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })

    test('rejects bboxX < 0', () => {
      const obs = createValidObservation({ bboxX: -0.1 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })

    test('accepts bboxWidth/bboxHeight in valid range', () => {
      const obs = createValidObservation({ bboxWidth: 0.5, bboxHeight: 0.5 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts bboxWidth = 1e-15 (minimum)', () => {
      const obs = createValidObservation({ bboxWidth: 1e-15 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('rejects bboxWidth = 0', () => {
      const obs = createValidObservation({ bboxWidth: 0 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })

  describe('lifeStage enum', () => {
    const validStages = ['adult', 'subadult', 'juvenile']

    for (const stage of validStages) {
      test(`accepts lifeStage: ${stage}`, () => {
        const obs = createValidObservation({ lifeStage: stage })
        const result = observationSchema.safeParse(obs)
        assert.equal(result.success, true)
      })
    }

    test('accepts lifeStage = null', () => {
      const obs = createValidObservation({ lifeStage: null })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('rejects invalid lifeStage', () => {
      const obs = createValidObservation({ lifeStage: 'baby' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })

  describe('sex enum', () => {
    test('accepts sex: female', () => {
      const obs = createValidObservation({ sex: 'female' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts sex: male', () => {
      const obs = createValidObservation({ sex: 'male' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts sex = null', () => {
      const obs = createValidObservation({ sex: null })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('rejects invalid sex', () => {
      const obs = createValidObservation({ sex: 'unknown' })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })

  describe('classificationProbability constraints', () => {
    test('accepts probability in 0-1 range', () => {
      const obs = createValidObservation({ classificationProbability: 0.95 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts probability = 0', () => {
      const obs = createValidObservation({ classificationProbability: 0 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('accepts probability = 1', () => {
      const obs = createValidObservation({ classificationProbability: 1 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, true)
    })

    test('rejects probability > 1', () => {
      const obs = createValidObservation({ classificationProbability: 1.5 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })

    test('rejects probability < 0', () => {
      const obs = createValidObservation({ classificationProbability: -0.1 })
      const result = observationSchema.safeParse(obs)
      assert.equal(result.success, false)
    })
  })
})

// =============================================================================
// Sanitizer Tests
// =============================================================================

describe('CamtrapDP Sanitizers', () => {
  describe('ensureTimezone', () => {
    test('returns null for null input', () => {
      assert.equal(ensureTimezone(null), null)
    })

    test('returns null for undefined input', () => {
      assert.equal(ensureTimezone(undefined), null)
    })

    test('returns null for empty string', () => {
      assert.equal(ensureTimezone(''), null)
    })

    test('preserves Z timezone', () => {
      assert.equal(ensureTimezone('2024-01-15T10:30:00Z'), '2024-01-15T10:30:00Z')
    })

    test('preserves +HH:MM timezone', () => {
      assert.equal(ensureTimezone('2024-01-15T10:30:00+02:00'), '2024-01-15T10:30:00+02:00')
    })

    test('preserves -HH:MM timezone', () => {
      assert.equal(ensureTimezone('2024-01-15T10:30:00-05:00'), '2024-01-15T10:30:00-05:00')
    })

    test('appends Z to datetime without timezone', () => {
      assert.equal(ensureTimezone('2024-01-15T10:30:00'), '2024-01-15T10:30:00Z')
    })

    test('appends Z to datetime with milliseconds but no timezone', () => {
      assert.equal(ensureTimezone('2024-01-15T10:30:00.123'), '2024-01-15T10:30:00.123Z')
    })
  })

  describe('clampBboxDimension', () => {
    test('returns null for null input', () => {
      assert.equal(clampBboxDimension(null), null)
    })

    test('returns null for undefined input', () => {
      assert.equal(clampBboxDimension(undefined), null)
    })

    test('returns 1e-15 for 0', () => {
      assert.equal(clampBboxDimension(0), 1e-15)
    })

    test('returns 1e-15 for negative values', () => {
      assert.equal(clampBboxDimension(-0.5), 1e-15)
    })

    test('returns 1 for values > 1', () => {
      assert.equal(clampBboxDimension(1.5), 1)
    })

    test('preserves valid values', () => {
      assert.equal(clampBboxDimension(0.5), 0.5)
    })

    test('preserves small positive values', () => {
      assert.equal(clampBboxDimension(0.001), 0.001)
    })
  })

  describe('clampBboxCoordinate', () => {
    test('returns null for null input', () => {
      assert.equal(clampBboxCoordinate(null), null)
    })

    test('returns 0 for negative values', () => {
      assert.equal(clampBboxCoordinate(-0.1), 0)
    })

    test('returns 1 for values > 1', () => {
      assert.equal(clampBboxCoordinate(1.5), 1)
    })

    test('preserves 0', () => {
      assert.equal(clampBboxCoordinate(0), 0)
    })

    test('preserves 1', () => {
      assert.equal(clampBboxCoordinate(1), 1)
    })

    test('preserves valid values', () => {
      assert.equal(clampBboxCoordinate(0.5), 0.5)
    })
  })

  describe('mapLifeStage', () => {
    test('returns null for null input', () => {
      assert.equal(mapLifeStage(null), null)
    })

    test('returns null for empty string', () => {
      assert.equal(mapLifeStage(''), null)
    })

    test('maps adult correctly', () => {
      assert.equal(mapLifeStage('adult'), 'adult')
      assert.equal(mapLifeStage('Adult'), 'adult')
      assert.equal(mapLifeStage('ADULT'), 'adult')
    })

    test('maps subadult correctly', () => {
      assert.equal(mapLifeStage('subadult'), 'subadult')
      assert.equal(mapLifeStage('sub-adult'), 'subadult')
    })

    test('maps juvenile correctly', () => {
      assert.equal(mapLifeStage('juvenile'), 'juvenile')
      assert.equal(mapLifeStage('young'), 'juvenile')
      assert.equal(mapLifeStage('immature'), 'juvenile')
      assert.equal(mapLifeStage('baby'), 'juvenile')
      assert.equal(mapLifeStage('cub'), 'juvenile')
    })

    test('returns null for unknown values', () => {
      assert.equal(mapLifeStage('unknown'), null)
      assert.equal(mapLifeStage('senior'), null)
    })
  })

  describe('mapSex', () => {
    test('returns null for null input', () => {
      assert.equal(mapSex(null), null)
    })

    test('maps female correctly', () => {
      assert.equal(mapSex('female'), 'female')
      assert.equal(mapSex('Female'), 'female')
      assert.equal(mapSex('f'), 'female')
      assert.equal(mapSex('F'), 'female')
    })

    test('maps male correctly', () => {
      assert.equal(mapSex('male'), 'male')
      assert.equal(mapSex('Male'), 'male')
      assert.equal(mapSex('m'), 'male')
      assert.equal(mapSex('M'), 'male')
    })

    test('returns null for unknown values', () => {
      assert.equal(mapSex('unknown'), null)
      assert.equal(mapSex('other'), null)
    })
  })

  describe('mapClassificationMethod', () => {
    test('returns null for null input', () => {
      assert.equal(mapClassificationMethod(null), null)
    })

    test('maps human correctly', () => {
      assert.equal(mapClassificationMethod('human'), 'human')
      assert.equal(mapClassificationMethod('manual'), 'human')
    })

    test('maps machine correctly', () => {
      assert.equal(mapClassificationMethod('machine'), 'machine')
      assert.equal(mapClassificationMethod('auto'), 'machine')
      assert.equal(mapClassificationMethod('automatic'), 'machine')
      assert.equal(mapClassificationMethod('ai'), 'machine')
      assert.equal(mapClassificationMethod('ml'), 'machine')
    })

    test('returns null for unknown values', () => {
      assert.equal(mapClassificationMethod('unknown'), null)
    })
  })

  describe('sanitizeCount', () => {
    test('returns null for null input', () => {
      assert.equal(sanitizeCount(null), null)
    })

    test('returns null for 0', () => {
      assert.equal(sanitizeCount(0), null)
    })

    test('returns null for negative values', () => {
      assert.equal(sanitizeCount(-1), null)
    })

    test('preserves positive integers', () => {
      assert.equal(sanitizeCount(5), 5)
    })

    test('floors decimal values', () => {
      assert.equal(sanitizeCount(5.7), 5)
    })
  })

  describe('sanitizeClassificationProbability', () => {
    test('returns null for null input', () => {
      assert.equal(sanitizeClassificationProbability(null), null)
    })

    test('clamps to 0 for negative values', () => {
      assert.equal(sanitizeClassificationProbability(-0.5), 0)
    })

    test('clamps to 1 for values > 1', () => {
      assert.equal(sanitizeClassificationProbability(1.5), 1)
    })

    test('preserves valid values', () => {
      assert.equal(sanitizeClassificationProbability(0.95), 0.95)
    })
  })

  describe('sanitizeObservation', () => {
    test('sanitizes all fields correctly', () => {
      const raw = {
        observationID: 'obs-001',
        deploymentID: 'dep-001',
        eventStart: '2024-01-15T10:30:00', // no timezone
        eventEnd: '2024-01-15T10:31:00Z',
        observationLevel: 'media',
        observationType: 'animal',
        count: 0, // invalid, should become null
        lifeStage: 'baby', // should map to juvenile
        sex: 'F', // should map to female
        bboxWidth: 0, // should clamp to 1e-15
        bboxX: -0.1, // should clamp to 0
        classificationMethod: 'ai', // should map to machine
        classificationProbability: 1.5 // should clamp to 1
      }

      const sanitized = sanitizeObservation(raw)

      assert.equal(sanitized.eventStart, '2024-01-15T10:30:00Z')
      assert.equal(sanitized.count, null)
      assert.equal(sanitized.lifeStage, 'juvenile')
      assert.equal(sanitized.sex, 'female')
      assert.equal(sanitized.bboxWidth, 1e-15)
      assert.equal(sanitized.bboxX, 0)
      assert.equal(sanitized.classificationMethod, 'machine')
      assert.equal(sanitized.classificationProbability, 1)
    })

    test('produces schema-valid output for typical input', () => {
      const raw = {
        observationID: 'obs-001',
        deploymentID: 'dep-001',
        eventStart: '2024-01-15T10:30:00',
        eventEnd: '2024-01-15T10:31:00',
        observationLevel: 'media',
        observationType: 'animal',
        scientificName: 'Canis lupus',
        count: 2,
        lifeStage: 'adult',
        sex: 'male',
        bboxX: 0.2,
        bboxY: 0.3,
        bboxWidth: 0.4,
        bboxHeight: 0.5,
        classificationMethod: 'machine',
        classificationProbability: 0.95
      }

      const sanitized = sanitizeObservation(raw)
      const result = observationSchema.safeParse(sanitized)

      assert.equal(
        result.success,
        true,
        `Validation failed: ${JSON.stringify(result.error?.issues)}`
      )
    })
  })
})
