import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  getSpeciesFromBboxes,
  getSpeciesFromSequence,
  getSpeciesListFromBboxes,
  getSpeciesListFromSequence
} from '../../src/renderer/src/utils/speciesFromBboxes.js'

describe('getSpeciesFromBboxes', () => {
  test('returns species from bboxes when available', () => {
    const bboxes = [{ scientificName: 'Panthera leo' }, { scientificName: 'Loxodonta africana' }]
    assert.equal(getSpeciesFromBboxes(bboxes), 'Panthera leo, Loxodonta africana')
  })

  test('returns unique species (deduplicates)', () => {
    const bboxes = [
      { scientificName: 'Panthera leo' },
      { scientificName: 'Panthera leo' },
      { scientificName: 'Loxodonta africana' }
    ]
    assert.equal(getSpeciesFromBboxes(bboxes), 'Panthera leo, Loxodonta africana')
  })

  test('filters out null/undefined scientificNames', () => {
    const bboxes = [
      { scientificName: 'Panthera leo' },
      { scientificName: null },
      { scientificName: undefined },
      { scientificName: '' }
    ]
    assert.equal(getSpeciesFromBboxes(bboxes), 'Panthera leo')
  })

  test('returns fallback when bboxes have no species', () => {
    const bboxes = [{ scientificName: null }, { scientificName: undefined }]
    assert.equal(getSpeciesFromBboxes(bboxes, 'Fallback species'), 'Fallback species')
  })

  test('returns fallback when bboxes array is empty', () => {
    assert.equal(getSpeciesFromBboxes([], 'Fallback species'), 'Fallback species')
  })

  test('returns "No species" when no bboxes and no fallback', () => {
    assert.equal(getSpeciesFromBboxes([]), 'No species')
    assert.equal(getSpeciesFromBboxes([], null), 'No species')
  })
})

describe('getSpeciesFromSequence', () => {
  test('aggregates species from all items in sequence', () => {
    const items = [{ mediaID: '1' }, { mediaID: '2' }]
    const bboxesByMedia = {
      1: [{ scientificName: 'Panthera leo' }],
      2: [{ scientificName: 'Loxodonta africana' }]
    }
    assert.equal(getSpeciesFromSequence(items, bboxesByMedia), 'Panthera leo, Loxodonta africana')
  })

  test('deduplicates species across all items', () => {
    const items = [{ mediaID: '1' }, { mediaID: '2' }, { mediaID: '3' }]
    const bboxesByMedia = {
      1: [{ scientificName: 'Panthera leo' }],
      2: [{ scientificName: 'Panthera leo' }, { scientificName: 'Loxodonta africana' }],
      3: [{ scientificName: 'Loxodonta africana' }]
    }
    assert.equal(getSpeciesFromSequence(items, bboxesByMedia), 'Panthera leo, Loxodonta africana')
  })

  test('handles items with no bboxes in bboxesByMedia', () => {
    const items = [{ mediaID: '1' }, { mediaID: '2' }]
    const bboxesByMedia = {
      1: [{ scientificName: 'Panthera leo' }]
      // mediaID '2' not present
    }
    assert.equal(getSpeciesFromSequence(items, bboxesByMedia), 'Panthera leo')
  })

  test('falls back to item scientificNames when no bboxes have species', () => {
    const items = [
      { mediaID: '1', scientificName: 'Panthera leo' },
      { mediaID: '2', scientificName: 'Loxodonta africana' }
    ]
    const bboxesByMedia = {
      1: [{ scientificName: null }],
      2: []
    }
    assert.equal(getSpeciesFromSequence(items, bboxesByMedia), 'Panthera leo, Loxodonta africana')
  })

  test('deduplicates fallback item scientificNames', () => {
    const items = [
      { mediaID: '1', scientificName: 'Panthera leo' },
      { mediaID: '2', scientificName: 'Panthera leo' }
    ]
    const bboxesByMedia = {}
    assert.equal(getSpeciesFromSequence(items, bboxesByMedia), 'Panthera leo')
  })

  test('returns "No species" when no species found anywhere', () => {
    const items = [{ mediaID: '1' }, { mediaID: '2' }]
    const bboxesByMedia = {}
    assert.equal(getSpeciesFromSequence(items, bboxesByMedia), 'No species')
  })

  test('filters out null/undefined from fallback item scientificNames', () => {
    const items = [
      { mediaID: '1', scientificName: null },
      { mediaID: '2', scientificName: 'Panthera leo' },
      { mediaID: '3', scientificName: undefined }
    ]
    const bboxesByMedia = {}
    assert.equal(getSpeciesFromSequence(items, bboxesByMedia), 'Panthera leo')
  })
})

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
