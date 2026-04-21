import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  getSpeciesListFromBboxes,
  getSpeciesListFromSequence
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
