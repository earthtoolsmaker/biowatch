import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  getSpeciesListFromBboxes,
  getSpeciesListFromSequence,
  getSpeciesCountsFromSequence
} from '../../src/renderer/src/utils/speciesFromBboxes.js'

describe('getSpeciesListFromBboxes', () => {
  test('returns deduped species list from bboxes', () => {
    const bboxes = [
      { scientificName: 'Panthera leo' },
      { scientificName: 'Panthera leo' },
      { scientificName: 'Loxodonta africana' }
    ]
    assert.deepEqual(getSpeciesListFromBboxes(bboxes), ['Panthera leo', 'Loxodonta africana'])
  })

  test('filters out null/undefined/empty scientificNames', () => {
    const bboxes = [
      { scientificName: 'Panthera leo' },
      { scientificName: null },
      { scientificName: undefined },
      { scientificName: '' }
    ]
    assert.deepEqual(getSpeciesListFromBboxes(bboxes), ['Panthera leo'])
  })

  test('returns [fallback] when bboxes have no species', () => {
    const bboxes = [{ scientificName: null }]
    assert.deepEqual(getSpeciesListFromBboxes(bboxes, 'Fallback species'), ['Fallback species'])
  })

  test('returns [fallback] when bboxes array is empty', () => {
    assert.deepEqual(getSpeciesListFromBboxes([], 'Fallback species'), ['Fallback species'])
  })

  test('returns [] when no bboxes species and no fallback', () => {
    assert.deepEqual(getSpeciesListFromBboxes([]), [])
    assert.deepEqual(getSpeciesListFromBboxes([], null), [])
    assert.deepEqual(getSpeciesListFromBboxes([{ scientificName: null }], null), [])
  })
})

describe('getSpeciesListFromSequence', () => {
  test('aggregates deduped species across sequence items', () => {
    const items = [{ mediaID: '1' }, { mediaID: '2' }, { mediaID: '3' }]
    const bboxesByMedia = {
      1: [{ scientificName: 'Panthera leo' }],
      2: [{ scientificName: 'Panthera leo' }, { scientificName: 'Loxodonta africana' }],
      3: [{ scientificName: 'Loxodonta africana' }]
    }
    assert.deepEqual(getSpeciesListFromSequence(items, bboxesByMedia), [
      'Panthera leo',
      'Loxodonta africana'
    ])
  })

  test('falls back to deduped item scientificNames when no bbox species', () => {
    const items = [
      { mediaID: '1', scientificName: 'Panthera leo' },
      { mediaID: '2', scientificName: 'Panthera leo' }
    ]
    assert.deepEqual(getSpeciesListFromSequence(items, {}), ['Panthera leo'])
  })

  test('filters null/undefined from fallback item scientificNames', () => {
    const items = [
      { mediaID: '1', scientificName: null },
      { mediaID: '2', scientificName: 'Panthera leo' },
      { mediaID: '3', scientificName: undefined }
    ]
    assert.deepEqual(getSpeciesListFromSequence(items, {}), ['Panthera leo'])
  })

  test('returns [] when nothing found', () => {
    const items = [{ mediaID: '1' }, { mediaID: '2' }]
    assert.deepEqual(getSpeciesListFromSequence(items, {}), [])
  })
})

describe('getSpeciesCountsFromSequence', () => {
  test('takes the max per-species count across frames (does not sum)', () => {
    // Burst of 3 frames: same 2 lions in frames 1 and 2, then 1 elephant joins in frame 3.
    // Sum would over-count (4 lions, 1 elephant); max gives the realistic individuals.
    const items = [{ mediaID: '1' }, { mediaID: '2' }, { mediaID: '3' }]
    const bboxesByMedia = {
      1: [{ scientificName: 'Panthera leo' }, { scientificName: 'Panthera leo' }],
      2: [{ scientificName: 'Panthera leo' }, { scientificName: 'Panthera leo' }],
      3: [{ scientificName: 'Panthera leo' }, { scientificName: 'Loxodonta africana' }]
    }
    assert.deepEqual(getSpeciesCountsFromSequence(items, bboxesByMedia), [
      { scientificName: 'Panthera leo', count: 2 },
      { scientificName: 'Loxodonta africana', count: 1 }
    ])
  })

  test('returns the per-frame max even when a species is absent in some frames', () => {
    const items = [{ mediaID: '1' }, { mediaID: '2' }]
    const bboxesByMedia = {
      1: [{ scientificName: 'Panthera leo' }],
      2: [{ scientificName: 'Loxodonta africana' }]
    }
    assert.deepEqual(getSpeciesCountsFromSequence(items, bboxesByMedia), [
      { scientificName: 'Panthera leo', count: 1 },
      { scientificName: 'Loxodonta africana', count: 1 }
    ])
  })

  test('falls back to deduped item scientificNames with count = 1', () => {
    const items = [
      { mediaID: '1', scientificName: 'Panthera leo' },
      { mediaID: '2', scientificName: 'Panthera leo' }
    ]
    assert.deepEqual(getSpeciesCountsFromSequence(items, {}), [
      { scientificName: 'Panthera leo', count: 1 }
    ])
  })

  test('filters null/undefined item scientificNames in fallback', () => {
    const items = [
      { mediaID: '1', scientificName: null },
      { mediaID: '2', scientificName: 'Panthera leo' },
      { mediaID: '3', scientificName: undefined }
    ]
    assert.deepEqual(getSpeciesCountsFromSequence(items, {}), [
      { scientificName: 'Panthera leo', count: 1 }
    ])
  })

  test('returns [] when nothing found', () => {
    assert.deepEqual(getSpeciesCountsFromSequence([{ mediaID: '1' }], {}), [])
  })
})
