import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMediaMode } from '../../src/renderer/src/utils/mediaMode.js'

const bboxObs = (id) => ({
  observationID: id,
  bboxX: 0.1,
  bboxY: 0.1,
  bboxWidth: 0.2,
  bboxHeight: 0.2
})

const wholeImageObs = (id) => ({
  observationID: id,
  bboxX: null,
  bboxY: null,
  bboxWidth: null,
  bboxHeight: null
})

test('empty list → empty', () => {
  assert.equal(getMediaMode([]), 'empty')
})

test('only bbox observations → bbox', () => {
  assert.equal(getMediaMode([bboxObs('a'), bboxObs('b')]), 'bbox')
})

test('one whole-image observation → whole-image', () => {
  assert.equal(getMediaMode([wholeImageObs('a')]), 'whole-image')
})

test('bbox + whole-image → mixed', () => {
  assert.equal(getMediaMode([bboxObs('a'), wholeImageObs('b')]), 'mixed')
})

test('null/undefined input → empty', () => {
  assert.equal(getMediaMode(null), 'empty')
  assert.equal(getMediaMode(undefined), 'empty')
})

test('observation with partial bbox columns counts as bbox', () => {
  assert.equal(getMediaMode([{ observationID: 'x', bboxX: 0.1 }]), 'bbox')
})
