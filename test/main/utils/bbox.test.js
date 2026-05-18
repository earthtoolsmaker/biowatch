import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { transformBboxToCamtrapDP, detectModelType } from '../../../src/main/utils/bbox.js'

describe('MegaDetector bbox handling', () => {
  test('transformBboxToCamtrapDP routes megadetector through xywhn → top-left', () => {
    const detection = { xywhn: [0.5, 0.5, 0.4, 0.6] }
    const result = transformBboxToCamtrapDP(detection, 'megadetector')
    assert.deepEqual(result, {
      bboxX: 0.3, // 0.5 - 0.4/2
      bboxY: 0.2, // 0.5 - 0.6/2
      bboxWidth: 0.4,
      bboxHeight: 0.6
    })
  })

  test('detectModelType identifies megadetector by version 6.0 + xywhn', () => {
    const prediction = {
      model_version: '6.0',
      detections: [{ xywhn: [0.5, 0.5, 0.4, 0.6], conf: 0.9, label: 'animal' }]
    }
    assert.equal(detectModelType(prediction), 'megadetector')
  })
})
