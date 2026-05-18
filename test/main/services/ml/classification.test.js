import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { selectVideoClassificationWinner } from '../../../../src/main/services/ml/classification.js'

describe('selectVideoClassificationWinner', () => {
  test('single species - returns that species', () => {
    const speciesMap = new Map([
      [
        'Vulpes vulpes',
        {
          frames: [1, 2, 3, 4, 5],
          scores: [0.9, 0.85, 0.88, 0.92, 0.87],
          firstFrame: 1,
          lastFrame: 5
        }
      ]
    ])
    const { winner, winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, 'Vulpes vulpes')
    assert.ok(winnerData.avgConfidence > 0)
  })

  test('clear winner by frame count', () => {
    const speciesMap = new Map([
      [
        'Vulpes vulpes',
        {
          frames: [1, 2, 3, 4, 5, 6, 7],
          scores: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
          firstFrame: 1,
          lastFrame: 7
        }
      ],
      [
        'Testudo hermanni',
        { frames: [8, 9, 10], scores: [0.95, 0.95, 0.95], firstFrame: 8, lastFrame: 10 }
      ]
    ])
    const { winner } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, 'Vulpes vulpes')
  })

  test('tie broken by higher average confidence', () => {
    const speciesMap = new Map([
      [
        'Vulpes vulpes',
        {
          frames: [1, 2, 3, 4, 5],
          scores: [0.7, 0.8, 0.8, 0.8, 0.7],
          firstFrame: 1,
          lastFrame: 5
        }
      ],
      [
        'Testudo hermanni',
        {
          frames: [6, 7, 8, 9, 10],
          scores: [0.9, 0.9, 0.9, 0.9, 0.9],
          firstFrame: 6,
          lastFrame: 10
        }
      ]
    ])
    const { winner, winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, 'Testudo hermanni')
    assert.equal(winnerData.avgConfidence, 0.9)
  })

  test('empty speciesMap returns null winner', () => {
    const speciesMap = new Map()
    const { winner, winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, null)
    assert.equal(winnerData, null)
  })

  test('null speciesMap returns null winner', () => {
    const result = selectVideoClassificationWinner(null)
    assert.deepEqual(result, { winner: null, winnerData: null })
  })

  test('undefined speciesMap returns null winner', () => {
    const result = selectVideoClassificationWinner(undefined)
    assert.deepEqual(result, { winner: null, winnerData: null })
  })

  test('calculates correct average confidence', () => {
    const speciesMap = new Map([
      [
        'Vulpes vulpes',
        { frames: [1, 2, 3, 4], scores: [0.6, 0.8, 0.7, 0.9], firstFrame: 1, lastFrame: 4 }
      ]
    ])
    const { winnerData } = selectVideoClassificationWinner(speciesMap)
    // (0.6 + 0.8 + 0.7 + 0.9) / 4 = 0.75
    // Use approximate comparison for floating point
    assert.ok(Math.abs(winnerData.avgConfidence - 0.75) < 0.0001)
  })

  test('preserves firstFrame and lastFrame in winnerData', () => {
    const speciesMap = new Map([
      [
        'Vulpes vulpes',
        { frames: [3, 7, 12], scores: [0.9, 0.9, 0.9], firstFrame: 3, lastFrame: 12 }
      ]
    ])
    const { winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winnerData.firstFrame, 3)
    assert.equal(winnerData.lastFrame, 12)
  })

  test('three-way competition - highest frame count wins', () => {
    const speciesMap = new Map([
      ['Species A', { frames: [1, 2], scores: [0.9, 0.9], firstFrame: 1, lastFrame: 2 }],
      [
        'Species B',
        { frames: [3, 4, 5, 6], scores: [0.7, 0.7, 0.7, 0.7], firstFrame: 3, lastFrame: 6 }
      ],
      ['Species C', { frames: [7, 8, 9], scores: [0.95, 0.95, 0.95], firstFrame: 7, lastFrame: 9 }]
    ])
    const { winner } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, 'Species B')
  })

  test('three-way tie broken by confidence', () => {
    const speciesMap = new Map([
      ['Species A', { frames: [1, 2, 3], scores: [0.7, 0.7, 0.7], firstFrame: 1, lastFrame: 3 }],
      ['Species B', { frames: [4, 5, 6], scores: [0.8, 0.8, 0.8], firstFrame: 4, lastFrame: 6 }],
      ['Species C', { frames: [7, 8, 9], scores: [0.9, 0.9, 0.9], firstFrame: 7, lastFrame: 9 }]
    ])
    const { winner, winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, 'Species C')
    assert.equal(winnerData.avgConfidence, 0.9)
  })

  test('handles zero confidence scores', () => {
    const speciesMap = new Map([
      ['Vulpes vulpes', { frames: [1, 2, 3], scores: [0, 0, 0], firstFrame: 1, lastFrame: 3 }]
    ])
    const { winner, winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, 'Vulpes vulpes')
    assert.equal(winnerData.avgConfidence, 0)
  })

  test('handles single frame detection', () => {
    const speciesMap = new Map([
      ['Vulpes vulpes', { frames: [5], scores: [0.95], firstFrame: 5, lastFrame: 5 }]
    ])
    const { winner, winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, 'Vulpes vulpes')
    assert.equal(winnerData.avgConfidence, 0.95)
    assert.equal(winnerData.firstFrame, 5)
    assert.equal(winnerData.lastFrame, 5)
  })

  test('preserves frames array in winnerData', () => {
    const speciesMap = new Map([
      [
        'Vulpes vulpes',
        { frames: [1, 3, 5, 7], scores: [0.8, 0.9, 0.85, 0.88], firstFrame: 1, lastFrame: 7 }
      ]
    ])
    const { winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.deepEqual(winnerData.frames, [1, 3, 5, 7])
  })

  test('preserves scores array in winnerData', () => {
    const speciesMap = new Map([
      [
        'Vulpes vulpes',
        { frames: [1, 2, 3], scores: [0.8, 0.9, 0.85], firstFrame: 1, lastFrame: 3 }
      ]
    ])
    const { winnerData } = selectVideoClassificationWinner(speciesMap)
    assert.deepEqual(winnerData.scores, [0.8, 0.9, 0.85])
  })
})

describe('selectVideoClassificationWinner with weightedVote=true (mean-confidence primary)', () => {
  test('DSCF0028.MP4 regression — strong 2-frame person beats weak 7-frame animal', () => {
    // Real per-frame data from a Biowatch import that exposed the bug.
    // Pure frame-count voting picked "animal" (7 frames > 2 frames), but the
    // animal detections are noisy (avg 0.36) while the person detections are
    // unambiguous (avg 0.83). Weighted vote correctly picks "person".
    const speciesMap = new Map([
      ['homo sapiens', { frames: [0, 1], scores: [0.945, 0.708], firstFrame: 0, lastFrame: 1 }],
      [
        'animal',
        {
          frames: [2, 3, 4, 5, 6, 8, 9],
          scores: [0.492, 0.301, 0.35, 0.36, 0.323, 0.374, 0.319],
          firstFrame: 2,
          lastFrame: 9
        }
      ]
    ])
    const { winner, winnerData } = selectVideoClassificationWinner(speciesMap, {
      weightedVote: true
    })
    assert.equal(winner, 'homo sapiens')
    assert.ok(Math.abs(winnerData.avgConfidence - 0.8265) < 0.001)
  })

  test('with weightedVote=false (default), frame count wins (existing behavior)', () => {
    // Same input, default mode. Locks the existing classifier-friendly logic.
    const speciesMap = new Map([
      ['homo sapiens', { frames: [0, 1], scores: [0.945, 0.708], firstFrame: 0, lastFrame: 1 }],
      [
        'animal',
        {
          frames: [2, 3, 4, 5, 6, 8, 9],
          scores: [0.492, 0.301, 0.35, 0.36, 0.323, 0.374, 0.319],
          firstFrame: 2,
          lastFrame: 9
        }
      ]
    ])
    const { winner } = selectVideoClassificationWinner(speciesMap)
    assert.equal(winner, 'animal')
  })

  test('frame count is the tiebreaker when mean confidences match', () => {
    const speciesMap = new Map([
      ['A', { frames: [1], scores: [0.8], firstFrame: 1, lastFrame: 1 }],
      ['B', { frames: [2, 3, 4], scores: [0.8, 0.8, 0.8], firstFrame: 2, lastFrame: 4 }]
    ])
    const { winner } = selectVideoClassificationWinner(speciesMap, { weightedVote: true })
    assert.equal(winner, 'B') // same mean (0.8), more frames → wins
  })

  test('higher mean confidence wins regardless of frame count', () => {
    const speciesMap = new Map([
      ['high-conf-few', { frames: [1, 2], scores: [0.95, 0.93], firstFrame: 1, lastFrame: 2 }],
      [
        'low-conf-many',
        {
          frames: [3, 4, 5, 6, 7, 8],
          scores: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
          firstFrame: 3,
          lastFrame: 8
        }
      ]
    ])
    const { winner } = selectVideoClassificationWinner(speciesMap, { weightedVote: true })
    assert.equal(winner, 'high-conf-few')
  })

  test('single-species video still wins regardless of mode', () => {
    const speciesMap = new Map([
      ['Vulpes vulpes', { frames: [1, 2, 3], scores: [0.7, 0.7, 0.7], firstFrame: 1, lastFrame: 3 }]
    ])
    const { winner } = selectVideoClassificationWinner(speciesMap, { weightedVote: true })
    assert.equal(winner, 'Vulpes vulpes')
  })
})
