import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deriveTableRow } from '../../../src/renderer/src/media/tableRows.js'

const isVideo = (m) => !!m.fileMediatype && m.fileMediatype.startsWith('video/')

describe('deriveTableRow', () => {
  test('dominant species by count, with +N for the rest and max confidence', () => {
    const sequence = {
      id: 'seq1',
      items: [
        { mediaID: 'm1', timestamp: '2024-06-01T10:00:00Z', locationName: 'Cam-A1' },
        { mediaID: 'm2', timestamp: '2024-06-01T10:00:02Z', locationName: 'Cam-A1' }
      ]
    }
    const bboxesByMedia = {
      m1: [{ scientificName: 'Panthera pardus', classificationProbability: 0.7 }],
      m2: [
        { scientificName: 'Panthera pardus', classificationProbability: 0.91 },
        { scientificName: 'Panthera pardus', classificationProbability: 0.6 },
        { scientificName: 'Genetta genetta', classificationProbability: 0.5 }
      ]
    }
    const row = deriveTableRow(sequence, bboxesByMedia, isVideo)
    assert.equal(row.species, 'Panthera pardus')
    assert.equal(row.extraSpeciesCount, 1)
    assert.equal(row.confidence, 0.91)
    assert.equal(row.when, '2024-06-01T10:00:00Z')
    assert.equal(row.deployment, 'Cam-A1')
    assert.equal(row.mediaID, 'm1')
  })

  test('video flagged; null timestamp preserved', () => {
    const sequence = {
      id: 'seq2',
      items: [{ mediaID: 'v1', timestamp: null, deploymentID: 'd9', fileMediatype: 'video/mp4' }]
    }
    const row = deriveTableRow(sequence, { v1: [] }, isVideo)
    assert.equal(row.isVideo, true)
    assert.equal(row.when, null)
    assert.equal(row.deployment, 'd9')
    // No bboxes → no species, no extra, no confidence
    assert.equal(row.species, null)
    assert.equal(row.extraSpeciesCount, 0)
    assert.equal(row.confidence, null)
  })
})
