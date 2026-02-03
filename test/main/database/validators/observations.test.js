import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

// Import validators
import {
  lifeStageValues,
  sexValues,
  suggestedBehaviorValues,
  lifeStageSchema,
  sexSchema,
  behaviorSchema
} from '../../../../src/main/database/validators.js'

// Import sanitizers
import {
  convertBehaviorToString,
  mapLifeStage,
  mapSex
} from '../../../../src/main/services/export/sanitizers.js'

describe('Observation Field Validators and Sanitizers', () => {
  describe('Vocabulary Constants', () => {
    test('lifeStageValues should contain Camtrap DP standard values', () => {
      assert.deepEqual(lifeStageValues, ['adult', 'subadult', 'juvenile'])
    })

    test('sexValues should contain standard values plus unknown', () => {
      assert.deepEqual(sexValues, ['female', 'male', 'unknown'])
    })

    test('suggestedBehaviorValues should contain expected behaviors', () => {
      assert(suggestedBehaviorValues.includes('running'))
      assert(suggestedBehaviorValues.includes('grazing'))
      assert(suggestedBehaviorValues.includes('hunting'))
      assert(suggestedBehaviorValues.includes('mating'))
      assert(Array.isArray(suggestedBehaviorValues))
      assert(suggestedBehaviorValues.length > 10) // Should have many suggestions
    })
  })

  describe('lifeStageSchema', () => {
    test('should accept valid lifeStage values', () => {
      assert.doesNotThrow(() => lifeStageSchema.parse('adult'))
      assert.doesNotThrow(() => lifeStageSchema.parse('subadult'))
      assert.doesNotThrow(() => lifeStageSchema.parse('juvenile'))
    })

    test('should accept null and undefined', () => {
      assert.doesNotThrow(() => lifeStageSchema.parse(null))
      assert.doesNotThrow(() => lifeStageSchema.parse(undefined))
    })

    test('should reject invalid values', () => {
      assert.throws(() => lifeStageSchema.parse('baby'))
      assert.throws(() => lifeStageSchema.parse('old'))
      assert.throws(() => lifeStageSchema.parse(''))
    })
  })

  describe('sexSchema', () => {
    test('should accept valid sex values', () => {
      assert.doesNotThrow(() => sexSchema.parse('female'))
      assert.doesNotThrow(() => sexSchema.parse('male'))
      assert.doesNotThrow(() => sexSchema.parse('unknown'))
    })

    test('should accept null and undefined', () => {
      assert.doesNotThrow(() => sexSchema.parse(null))
      assert.doesNotThrow(() => sexSchema.parse(undefined))
    })

    test('should reject invalid values', () => {
      assert.throws(() => sexSchema.parse('m'))
      assert.throws(() => sexSchema.parse('f'))
      assert.throws(() => sexSchema.parse(''))
    })
  })

  describe('behaviorSchema', () => {
    test('should accept array of strings', () => {
      assert.doesNotThrow(() => behaviorSchema.parse(['running']))
      assert.doesNotThrow(() => behaviorSchema.parse(['running', 'alert']))
      assert.doesNotThrow(() => behaviorSchema.parse(['custom-behavior']))
    })

    test('should accept null and undefined', () => {
      assert.doesNotThrow(() => behaviorSchema.parse(null))
      assert.doesNotThrow(() => behaviorSchema.parse(undefined))
    })

    test('should accept empty array', () => {
      assert.doesNotThrow(() => behaviorSchema.parse([]))
    })

    test('should reject non-array values', () => {
      assert.throws(() => behaviorSchema.parse('running'))
      assert.throws(() => behaviorSchema.parse('running|alert'))
    })
  })

  describe('convertBehaviorToString (export sanitizer)', () => {
    test('should convert array to pipe-separated string', () => {
      assert.equal(convertBehaviorToString(['running']), 'running')
      assert.equal(convertBehaviorToString(['running', 'alert']), 'running|alert')
      assert.equal(
        convertBehaviorToString(['hunting', 'stalking', 'chasing']),
        'hunting|stalking|chasing'
      )
    })

    test('should return null for null/undefined input', () => {
      assert.equal(convertBehaviorToString(null), null)
      assert.equal(convertBehaviorToString(undefined), null)
    })

    test('should return null for empty array', () => {
      assert.equal(convertBehaviorToString([]), null)
    })

    test('should pass through string values (legacy support)', () => {
      assert.equal(convertBehaviorToString('running'), 'running')
      assert.equal(convertBehaviorToString('running|alert'), 'running|alert')
    })

    test('should return null for empty string', () => {
      assert.equal(convertBehaviorToString(''), null)
      assert.equal(convertBehaviorToString('  '), null)
    })

    test('should filter out empty strings in array', () => {
      assert.equal(convertBehaviorToString(['running', '', 'alert']), 'running|alert')
      assert.equal(convertBehaviorToString(['', '', '']), null)
    })
  })

  describe('mapLifeStage (export sanitizer)', () => {
    test('should map standard values', () => {
      assert.equal(mapLifeStage('adult'), 'adult')
      assert.equal(mapLifeStage('subadult'), 'subadult')
      assert.equal(mapLifeStage('juvenile'), 'juvenile')
    })

    test('should map alternative names to standard values', () => {
      assert.equal(mapLifeStage('sub-adult'), 'subadult')
      assert.equal(mapLifeStage('young'), 'juvenile')
      assert.equal(mapLifeStage('immature'), 'juvenile')
      assert.equal(mapLifeStage('baby'), 'juvenile')
      assert.equal(mapLifeStage('cub'), 'juvenile')
    })

    test('should be case-insensitive', () => {
      assert.equal(mapLifeStage('ADULT'), 'adult')
      assert.equal(mapLifeStage('Adult'), 'adult')
      assert.equal(mapLifeStage('JUVENILE'), 'juvenile')
    })

    test('should return null for invalid values', () => {
      assert.equal(mapLifeStage('old'), null)
      assert.equal(mapLifeStage('senior'), null)
      assert.equal(mapLifeStage(''), null)
      assert.equal(mapLifeStage(null), null)
    })
  })

  describe('mapSex (export sanitizer)', () => {
    test('should map standard values', () => {
      assert.equal(mapSex('female'), 'female')
      assert.equal(mapSex('male'), 'male')
    })

    test('should map abbreviations to standard values', () => {
      assert.equal(mapSex('f'), 'female')
      assert.equal(mapSex('m'), 'male')
    })

    test('should be case-insensitive', () => {
      assert.equal(mapSex('FEMALE'), 'female')
      assert.equal(mapSex('Male'), 'male')
      assert.equal(mapSex('F'), 'female')
      assert.equal(mapSex('M'), 'male')
    })

    test('should return null for unknown/invalid values', () => {
      // Note: 'unknown' is valid in our internal schema but not in Camtrap DP spec
      // so mapSex returns null for it (export will omit it)
      assert.equal(mapSex('unknown'), null)
      assert.equal(mapSex('other'), null)
      assert.equal(mapSex(''), null)
      assert.equal(mapSex(null), null)
    })
  })
})
