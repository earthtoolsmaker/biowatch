import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { mapObservationType } from '../../../../src/main/services/export/observationType.js'

describe('mapObservationType — Camtrap DP vocabulary', () => {
  test('MegaDetector "homo sapiens" exports as "human"', () => {
    // Regression test: previously the early-return `if (scientificName) return 'animal'`
    // shadowed MD's homo sapiens label, exporting humans as animals.
    assert.equal(mapObservationType('machine', 'homo sapiens'), 'human')
    assert.equal(mapObservationType(null, 'homo sapiens'), 'human')
  })

  test('MegaDetector "vehicle" exports as "vehicle"', () => {
    // Same regression as homo sapiens — vehicles were silently mapped to animal.
    assert.equal(mapObservationType('machine', 'vehicle'), 'vehicle')
    assert.equal(mapObservationType(null, 'vehicle'), 'vehicle')
  })

  test('MegaDetector "animal" exports as "animal"', () => {
    // MD's literal animal label still maps to animal (was coincidentally correct).
    assert.equal(mapObservationType('machine', 'animal'), 'animal')
    assert.equal(mapObservationType(null, 'animal'), 'animal')
  })

  test('real binomial scientific names still export as "animal"', () => {
    // Locks pre-existing behavior for true classifier output.
    assert.equal(mapObservationType('machine', 'Vulpes vulpes'), 'animal')
    assert.equal(mapObservationType('machine', 'Panthera leo'), 'animal')
    assert.equal(mapObservationType('machine', 'sciurus vulgaris'), 'animal')
  })

  test('null scientificName falls through to dbType branches', () => {
    assert.equal(mapObservationType(null, null), 'blank')
    assert.equal(mapObservationType('blank', null), 'blank')
    assert.equal(mapObservationType('machine', null), 'animal')
    assert.equal(mapObservationType('human', null), 'human')
    assert.equal(mapObservationType('vehicle', null), 'vehicle')
    assert.equal(mapObservationType('unclassified', null), 'unclassified')
    assert.equal(mapObservationType('something-unexpected', null), 'unknown')
  })
})
