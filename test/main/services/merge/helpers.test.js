import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  getMergeImportFolder,
  getMergePrefix,
  isMergedImportFolder,
  parseMergeUuid,
  prefixRow
} from '../../../../src/main/services/merge/helpers.js'

const UUID = 'b7f2a1c3-1234-4abc-9def-1234567890ab'

describe('merge helpers — importFolder/prefix conventions', () => {
  test('getMergeImportFolder returns the synthetic "merge:<uuid>" string', () => {
    assert.equal(getMergeImportFolder(UUID), `merge:${UUID}`)
  })

  test('getMergePrefix uses the first 8 chars of the UUID', () => {
    assert.equal(getMergePrefix(UUID), 'study:b7f2a1c3:')
  })

  test('isMergedImportFolder recognizes the "merge:" prefix', () => {
    assert.equal(isMergedImportFolder(`merge:${UUID}`), true)
    assert.equal(isMergedImportFolder('/home/user/photos'), false)
    assert.equal(isMergedImportFolder('https://lila.science/x.jpg'), false)
    assert.equal(isMergedImportFolder(''), false)
    assert.equal(isMergedImportFolder(null), false)
  })

  test('parseMergeUuid extracts the full UUID', () => {
    assert.equal(parseMergeUuid(`merge:${UUID}`), UUID)
    assert.equal(parseMergeUuid('/some/path'), null)
    assert.equal(parseMergeUuid(null), null)
  })
})

describe('merge helpers — prefixRow', () => {
  const PREFIX = 'study:b7f2a1c3:'

  test('prefixes the primary key and rewrites listed FK fields', () => {
    const row = {
      observationID: 'obs_42',
      mediaID: 'IMG_42',
      deploymentID: 'CAM_01',
      scientificName: 'Lepus europaeus',
      count: 1
    }
    const out = prefixRow(row, PREFIX, {
      pk: 'observationID',
      fks: ['mediaID', 'deploymentID']
    })
    assert.equal(out.observationID, 'study:b7f2a1c3:obs_42')
    assert.equal(out.mediaID, 'study:b7f2a1c3:IMG_42')
    assert.equal(out.deploymentID, 'study:b7f2a1c3:CAM_01')
    assert.equal(out.scientificName, 'Lepus europaeus')
    assert.equal(out.count, 1)
  })

  test('leaves null FK fields untouched', () => {
    const row = { mediaID: 'M1', deploymentID: null }
    const out = prefixRow(row, PREFIX, { pk: 'mediaID', fks: ['deploymentID'] })
    assert.equal(out.mediaID, 'study:b7f2a1c3:M1')
    assert.equal(out.deploymentID, null)
  })

  test('returns a new object — does not mutate the input', () => {
    const row = { mediaID: 'M1' }
    const out = prefixRow(row, PREFIX, { pk: 'mediaID', fks: [] })
    assert.notEqual(out, row)
    assert.equal(row.mediaID, 'M1')
  })
})
