import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeBboxLabelPosition,
  computeSelectorPosition
} from '../../src/renderer/src/utils/positioning.js'

// Helper to extract numeric percentage value from string like "30%"
function parsePercent(str) {
  return parseFloat(str.replace('%', ''))
}

// Helper to assert percentage is approximately equal (handles floating point)
function assertPercentApprox(actual, expected, message) {
  const actualNum = parsePercent(actual)
  const expectedNum = typeof expected === 'string' ? parsePercent(expected) : expected
  assert.ok(
    Math.abs(actualNum - expectedNum) < 0.001,
    message || `Expected ${actual} to be approximately ${expectedNum}%`
  )
}

describe('computeBboxLabelPosition', () => {
  test('bbox at center - label above-left (default)', () => {
    const bbox = { bboxX: 0.3, bboxY: 0.3, bboxWidth: 0.2, bboxHeight: 0.2 }
    const result = computeBboxLabelPosition(bbox)

    assertPercentApprox(result.left, 30)
    assertPercentApprox(result.top, 30)
    assert.equal(result.transform, 'translateY(calc(-100% - 2px))')
  })

  test('bbox near top edge - label positioned below bbox', () => {
    const bbox = { bboxX: 0.3, bboxY: 0.01, bboxWidth: 0.2, bboxHeight: 0.2 }
    const result = computeBboxLabelPosition(bbox)

    // top should be at bottom of bbox (bboxY + bboxHeight = 0.21)
    assertPercentApprox(result.top, 21)
    assertPercentApprox(result.left, 30)
    assert.ok(result.transform.includes('translateY(4px)'))
  })

  test('bbox near right edge - label shifted left', () => {
    const bbox = { bboxX: 0.7, bboxY: 0.3, bboxWidth: 0.2, bboxHeight: 0.2 }
    const result = computeBboxLabelPosition(bbox)

    // left should be at right edge of bbox (bboxX + bboxWidth = 0.9)
    assertPercentApprox(result.left, 90)
    assertPercentApprox(result.top, 30)
    assert.ok(result.transform.includes('translateX(-100%)'))
    assert.ok(result.transform.includes('translateY(calc(-100% - 2px))'))
  })

  test('bbox near top-right corner - label below AND shifted left (regression test)', () => {
    // This is the case that was previously broken
    const bbox = { bboxX: 0.7, bboxY: 0.01, bboxWidth: 0.2, bboxHeight: 0.2 }
    const result = computeBboxLabelPosition(bbox)

    // Should have BOTH transforms applied
    assert.ok(result.transform.includes('translateX(-100%)'), 'Should shift left')
    assert.ok(result.transform.includes('translateY(4px)'), 'Should position below')

    // Position should be at bottom-right of bbox
    assertPercentApprox(result.left, 90) // bboxX + bboxWidth
    assertPercentApprox(result.top, 21) // bboxY + bboxHeight
  })

  test('bbox at bottom-left - label above-left', () => {
    const bbox = { bboxX: 0.1, bboxY: 0.8, bboxWidth: 0.2, bboxHeight: 0.15 }
    const result = computeBboxLabelPosition(bbox)

    assertPercentApprox(result.left, 10)
    assertPercentApprox(result.top, 80)
    assert.equal(result.transform, 'translateY(calc(-100% - 2px))')
  })

  test('bbox at bottom-right - label above, shifted left', () => {
    const bbox = { bboxX: 0.75, bboxY: 0.8, bboxWidth: 0.2, bboxHeight: 0.15 }
    const result = computeBboxLabelPosition(bbox)

    assertPercentApprox(result.left, 95) // bboxX + bboxWidth
    assert.ok(result.transform.includes('translateX(-100%)'))
    assert.ok(result.transform.includes('translateY(calc(-100% - 2px))'))
  })

  test('edge case: bbox exactly at threshold', () => {
    // bboxY exactly at LABEL_HEIGHT_ESTIMATE (0.03)
    const bbox = { bboxX: 0.3, bboxY: 0.03, bboxWidth: 0.2, bboxHeight: 0.2 }
    const result = computeBboxLabelPosition(bbox)

    // Should be above (not near top)
    assert.equal(result.transform, 'translateY(calc(-100% - 2px))')
  })

  test('edge case: bbox right edge just under threshold', () => {
    // bboxX + bboxWidth = 0.84 which is NOT > 0.85
    const bbox = { bboxX: 0.64, bboxY: 0.3, bboxWidth: 0.2, bboxHeight: 0.2 }
    const result = computeBboxLabelPosition(bbox)

    // 0.64 + 0.2 = 0.84, which is NOT > 0.85, so should be left-aligned
    assertPercentApprox(result.left, 64)
    assert.equal(result.transform, 'translateY(calc(-100% - 2px))')
  })

  test('edge case: bbox right edge just over threshold', () => {
    // bboxX + bboxWidth = 0.86 which IS > 0.85
    const bbox = { bboxX: 0.66, bboxY: 0.3, bboxWidth: 0.2, bboxHeight: 0.2 }
    const result = computeBboxLabelPosition(bbox)

    // Should be right-aligned
    assertPercentApprox(result.left, 86) // bboxX + bboxWidth
    assert.ok(result.transform.includes('translateX(-100%)'))
  })
})

describe('computeSelectorPosition', () => {
  const containerRect = {
    top: 100,
    bottom: 700,
    left: 50,
    right: 850,
    height: 600,
    width: 800
  }

  test('label at center - selector below label', () => {
    const labelRect = { top: 300, bottom: 324, left: 200, right: 350 }
    const result = computeSelectorPosition(labelRect, containerRect)

    // y should be labelRect.bottom + MARGIN (8)
    assert.equal(result.y, 332)
    assert.equal(result.x, 200)
    assert.equal(result.transform, 'none')
  })

  test('label near container bottom - selector above label', () => {
    // Label positioned such that selector won't fit below
    const labelRect = { top: 500, bottom: 524, left: 200, right: 350 }
    const result = computeSelectorPosition(labelRect, containerRect)

    // y should be labelRect.top - MARGIN (8)
    assert.equal(result.y, 492)
    assert.equal(result.transform, 'translateY(-100%)')
  })

  test('label near container right - selector clamped left', () => {
    const labelRect = { top: 300, bottom: 324, left: 650, right: 800 }
    const result = computeSelectorPosition(labelRect, containerRect)

    // x should be clamped to containerRect.right - PADDING - selectorWidth
    // 850 - 16 - 288 = 546
    assert.equal(result.x, 546)
  })

  test('label near container left - selector clamped right', () => {
    const labelRect = { top: 300, bottom: 324, left: 10, right: 160 }
    const result = computeSelectorPosition(labelRect, containerRect)

    // x should be clamped to containerRect.left + PADDING
    // 50 + 16 = 66
    assert.equal(result.x, 66)
  })

  test('very limited vertical space - selector centered', () => {
    // Container is very short
    const shortContainer = {
      top: 100,
      bottom: 200,
      left: 50,
      right: 850,
      height: 100,
      width: 800
    }
    const labelRect = { top: 140, bottom: 164, left: 200, right: 350 }
    const result = computeSelectorPosition(labelRect, shortContainer)

    // Should fallback to centered position
    // y = containerRect.top + (containerRect.height - selectorHeight) / 2
    // 100 + (100 - 320) / 2 = 100 + (-110) = -10 (centered, even if negative)
    assert.equal(result.transform, 'none')
  })

  test('custom selector size', () => {
    const labelRect = { top: 300, bottom: 324, left: 200, right: 350 }
    const customSize = { width: 400, height: 200 }
    const result = computeSelectorPosition(labelRect, containerRect, customSize)

    // Should use the custom size for calculations
    assert.equal(result.y, 332) // bottom + MARGIN
    assert.equal(result.transform, 'none')
  })
})
