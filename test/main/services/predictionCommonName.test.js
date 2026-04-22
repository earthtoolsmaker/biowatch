import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { insertPrediction } from '../../../src/main/services/prediction.js'

/**
 * Build a fake Drizzle-ish db that:
 *  - Returns a prepared mediaRecord with timestamp + deploymentID so
 *    insertPrediction skips processMediaDeployment (which needs real files).
 *  - Captures every observation row inserted via db.insert(...).values(...).
 */
function makeFakeDb({ mediaRecord }) {
  const insertedRows = []
  const db = {
    // `select().from(...).where(...).limit(...)` chain used by getMedia().
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve([mediaRecord])
                }
              }
            }
          }
        }
      }
    },
    // `insert(table).values(row)` chain used to write observations.
    insert() {
      return {
        values(row) {
          insertedRows.push(row)
          return Promise.resolve()
        }
      }
    }
  }
  return { db, insertedRows }
}

function baseMedia(overrides = {}) {
  return {
    mediaID: 'media-1',
    deploymentID: 'dep-1',
    timestamp: '2024-01-01T00:00:00Z',
    filePath: '/fake/img.jpg',
    fileMediatype: 'image/jpeg',
    ...overrides
  }
}

describe('insertPrediction populates commonName via dictionary', () => {
  test('SpeciesNet prediction gets commonName from dictionary', async () => {
    const { db, insertedRows } = makeFakeDb({ mediaRecord: baseMedia() })
    const prediction = {
      filepath: '/fake/img.jpg',
      prediction:
        '00000000-0000-0000-0000-000000000001;mammalia;rodentia;sciuridae;sciurus;vulgaris;eurasian red squirrel',
      prediction_score: 0.95,
      detections: []
    }

    await insertPrediction(db, prediction, { modelID: 'speciesnet' })

    assert.equal(insertedRows.length, 1)
    assert.equal(insertedRows[0].scientificName, 'sciurus vulgaris')
    // Dictionary values are lowercased at build time for consistent display
    // and filtering.
    assert.equal(insertedRows[0].commonName, 'eurasian red squirrel')
  })

  test('DeepFaune non-binomial label gets commonName from dictionary', async () => {
    const { db, insertedRows } = makeFakeDb({ mediaRecord: baseMedia() })
    const prediction = {
      filepath: '/fake/img.jpg',
      prediction: 'chamois',
      prediction_score: 0.88,
      detections: []
    }

    await insertPrediction(db, prediction, { modelID: 'deepfaune' })

    assert.equal(insertedRows.length, 1)
    assert.equal(insertedRows[0].scientificName, 'chamois')
    assert.equal(insertedRows[0].commonName, 'chamois')
  })

  test('unknown species leaves commonName null', async () => {
    const { db, insertedRows } = makeFakeDb({ mediaRecord: baseMedia() })
    const prediction = {
      filepath: '/fake/img.jpg',
      prediction: 'unknown_labelium',
      prediction_score: 0.4,
      detections: []
    }

    await insertPrediction(db, prediction, { modelID: 'deepfaune' })

    assert.equal(insertedRows.length, 1)
    assert.equal(insertedRows[0].commonName, null)
  })

  test('blank prediction (null scientificName) leaves commonName null', async () => {
    const { db, insertedRows } = makeFakeDb({ mediaRecord: baseMedia() })
    const prediction = {
      filepath: '/fake/img.jpg',
      prediction: 'blank',
      prediction_score: 0.1,
      detections: []
    }

    await insertPrediction(db, prediction, { modelID: 'deepfaune' })

    assert.equal(insertedRows.length, 1)
    assert.equal(insertedRows[0].scientificName, null)
    assert.equal(insertedRows[0].commonName, null)
  })
})
