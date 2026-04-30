import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { transformCOCOToMedia } from '../../../../src/main/services/import/parsers/lila-helpers.js'

describe('LILA transformCOCOToMedia', () => {
  test('stamps every media row with importFolder = dataset.name', () => {
    const images = [
      { id: 1, file_name: 'a.jpg', location: 'L1', datetime: '2024-01-01T00:00:00Z' },
      { id: 2, file_name: 'b.jpg', location: 'L2', datetime: '2024-01-02T00:00:00Z' }
    ]
    const dataset = {
      name: 'Snapshot Serengeti',
      imageBaseUrl: 'https://example.com/snapshot-serengeti/'
    }

    const rows = transformCOCOToMedia(images, dataset)

    assert.equal(rows.length, 2)
    rows.forEach((r) => {
      assert.equal(r.importFolder, 'Snapshot Serengeti')
    })
    assert.equal(rows[0].mediaID, '1')
    assert.equal(rows[0].filePath, 'https://example.com/snapshot-serengeti/a.jpg')
  })
})
