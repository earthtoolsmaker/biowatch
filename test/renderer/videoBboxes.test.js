import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getBboxesForFrame, getVideoBounds } from '../../src/renderer/src/utils/videoBboxes.js'

describe('getBboxesForFrame', () => {
  const detections = [
    { frameNumber: 0, bboxX: 0.1, bboxY: 0.1, bboxWidth: 0.2, bboxHeight: 0.2, conf: 0.9 },
    { frameNumber: 2, bboxX: 0.3, bboxY: 0.3, bboxWidth: 0.1, bboxHeight: 0.1, conf: 0.8 },
    { frameNumber: 2, bboxX: 0.5, bboxY: 0.5, bboxWidth: 0.1, bboxHeight: 0.1, conf: 0.7 },
    { frameNumber: 5, bboxX: 0.6, bboxY: 0.6, bboxWidth: 0.2, bboxHeight: 0.2, conf: 0.95 }
  ]

  test('returns matching detections for exact frame', () => {
    const result = getBboxesForFrame(detections, 2)
    assert.equal(result.length, 2)
    assert.equal(result[0].conf, 0.8)
    assert.equal(result[1].conf, 0.7)
  })

  test('returns empty array when no frame matches', () => {
    assert.deepEqual(getBboxesForFrame(detections, 3), [])
  })

  test('returns single detection when only one matches', () => {
    const result = getBboxesForFrame(detections, 0)
    assert.equal(result.length, 1)
    assert.equal(result[0].frameNumber, 0)
  })

  test('returns empty array for empty input', () => {
    assert.deepEqual(getBboxesForFrame([], 0), [])
  })

  test('handles null/undefined input gracefully', () => {
    assert.deepEqual(getBboxesForFrame(null, 0), [])
    assert.deepEqual(getBboxesForFrame(undefined, 0), [])
  })
})

describe('getVideoBounds', () => {
  function makeVideo(videoWidth, videoHeight) {
    return { videoWidth, videoHeight }
  }
  function makeContainer(width, height) {
    return {
      getBoundingClientRect: () => ({ width, height, left: 0, top: 0 })
    }
  }

  test('returns null when videoElement is missing', () => {
    assert.equal(getVideoBounds(null, makeContainer(100, 100)), null)
  })

  test('returns null when containerElement is missing', () => {
    assert.equal(getVideoBounds(makeVideo(1920, 1080), null), null)
  })

  test('returns null when video dimensions are zero (metadata not loaded)', () => {
    assert.equal(getVideoBounds(makeVideo(0, 0), makeContainer(100, 100)), null)
  })

  test('letterboxes top/bottom when video is wider than container', () => {
    // video 2:1 (1920x960), container 1:1 (800x800)
    // rendered width 800, rendered height 400, offsetY 200
    const bounds = getVideoBounds(makeVideo(1920, 960), makeContainer(800, 800))
    assert.equal(bounds.renderedWidth, 800)
    assert.equal(bounds.renderedHeight, 400)
    assert.equal(bounds.offsetX, 0)
    assert.equal(bounds.offsetY, 200)
  })

  test('letterboxes left/right when video is taller than container', () => {
    // video 1:2 (480x960), container 1:1 (800x800)
    // rendered height 800, rendered width 400, offsetX 200
    const bounds = getVideoBounds(makeVideo(480, 960), makeContainer(800, 800))
    assert.equal(bounds.renderedWidth, 400)
    assert.equal(bounds.renderedHeight, 800)
    assert.equal(bounds.offsetX, 200)
    assert.equal(bounds.offsetY, 0)
  })
})
