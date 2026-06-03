import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { toggleSelection, rangeSelection } from '../../../src/renderer/src/media/selection.js'

describe('selection', () => {
  test('toggle adds then removes an id', () => {
    const a = toggleSelection(new Set(), 'm2')
    assert.deepEqual([...a], ['m2'])
    assert.deepEqual([...toggleSelection(a, 'm2')], [])
  })

  test('rangeSelection selects the inclusive span between anchor and target', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    const sel = rangeSelection(new Set(['a']), order, 'b', 'd')
    assert.deepEqual([...sel].sort(), ['a', 'b', 'c', 'd'])
  })

  test('rangeSelection works regardless of direction', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    assert.deepEqual([...rangeSelection(new Set(), order, 'd', 'b')].sort(), ['b', 'c', 'd'])
  })

  test('rangeSelection with unknown anchor just adds the target', () => {
    const order = ['a', 'b', 'c']
    assert.deepEqual([...rangeSelection(new Set(), order, 'zzz', 'b')], ['b'])
  })
})
