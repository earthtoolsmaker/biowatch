import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEW_MODES,
  getAvailableViewModes,
  clampViewMode,
  initialViewMode
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

  describe('initialViewMode', () => {
    test('defaults to both at lg and up with no deep-link view', () => {
      assert.equal(initialViewMode(null, true), 'both')
    })

    test('defaults to map below lg with no deep-link view', () => {
      assert.equal(initialViewMode(null, false), 'map')
    })

    test('an explicit deep-link view wins over the size default', () => {
      assert.equal(initialViewMode('gallery', true), 'gallery')
      assert.equal(initialViewMode('map', true), 'map')
      assert.equal(initialViewMode('both', false), 'both')
    })

    test('ignores an unknown deep-link view and falls back to the size default', () => {
      assert.equal(initialViewMode('bogus', true), 'both')
      assert.equal(initialViewMode('', false), 'map')
    })
  })
})
