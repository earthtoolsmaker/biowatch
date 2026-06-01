import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEW_MODES,
  getAvailableViewModes,
  clampViewMode
} from '../../src/renderer/src/utils/viewLayout.js'

describe('viewLayout', () => {
  test('VIEW_MODES lists all three modes in toggle order', () => {
    assert.deepEqual(VIEW_MODES, ['map', 'gallery', 'both'])
  })

  test('getAvailableViewModes offers both only at lg and up', () => {
    assert.deepEqual(getAvailableViewModes(true), ['map', 'gallery', 'both'])
    assert.deepEqual(getAvailableViewModes(false), ['map', 'gallery'])
  })

  test('clampViewMode falls back from both to map below lg', () => {
    assert.equal(clampViewMode('both', false), 'map')
  })

  test('clampViewMode keeps both at lg and up', () => {
    assert.equal(clampViewMode('both', true), 'both')
  })

  test('clampViewMode leaves map and gallery untouched at any size', () => {
    assert.equal(clampViewMode('map', false), 'map')
    assert.equal(clampViewMode('gallery', false), 'gallery')
    assert.equal(clampViewMode('gallery', true), 'gallery')
  })
})
