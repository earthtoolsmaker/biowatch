import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultTimeFilter,
  emptyHourSelection,
  switchTimeMode
} from '../../src/shared/timeFilter.js'
import { readTimeFilter } from '../../src/renderer/src/hooks/useTimeFilter.js'

test('default hour selection is empty: no individual period restricts the full day', () => {
  assert.deepEqual(emptyHourSelection(), { kind: 'chips', keys: [] })
  assert.deepEqual(defaultTimeFilter(), {
    mode: 'solar',
    selection: { kind: 'chips', keys: [] }
  })
})

test('mode switches atomically clear hours in both directions; no-op does not clear', () => {
  for (const mode of ['clock', 'solar']) {
    const selected = {
      mode,
      selection: {
        kind: 'ranges',
        ranges: [
          { start: 22, end: 4 },
          { start: 8, end: 9 }
        ]
      }
    }
    assert.equal(switchTimeMode(selected, mode), selected)
    const next = switchTimeMode(selected, mode === 'clock' ? 'solar' : 'clock')
    assert.deepEqual(next.selection, emptyHourSelection())
    assert.notEqual(next.mode, mode)
    assert.equal(selected.selection.ranges.length, 2)
    assert.deepEqual(switchTimeMode(next, mode).selection, emptyHourSelection())
  }
})

test('mode and multi-range/preset selection persist together and independently per study', () => {
  const data = {
    a: {
      mode: 'solar',
      selection: {
        kind: 'ranges',
        ranges: [
          { start: 22, end: 4 },
          { start: 6.25, end: 8 }
        ]
      }
    },
    b: { mode: 'clock', selection: { kind: 'chips', keys: ['dawn', 'dusk'] } }
  }
  const storage = { getItem: (key) => JSON.stringify(data[key.slice('timeFilter:'.length)]) }
  assert.deepEqual(readTimeFilter('a', storage), data.a)
  assert.deepEqual(readTimeFilter('b', storage), data.b)
})

test('malformed storage cannot send unsafe or unknown ranges to analysis IPC', () => {
  for (const value of [
    null,
    {},
    { mode: 'solar' },
    { mode: 'sidereal', selection: emptyHourSelection() },
    { mode: 'solar', selection: { kind: 'ranges', ranges: [null] } },
    { mode: 'solar', selection: { kind: 'ranges', ranges: [{ start: -1, end: 25 }] } },
    { mode: 'clock', selection: { kind: 'chips', keys: ['unknown'] } }
  ]) {
    assert.deepEqual(
      readTimeFilter('a', { getItem: () => JSON.stringify(value) }),
      defaultTimeFilter()
    )
  }
  assert.deepEqual(readTimeFilter('a', { getItem: () => '{bad' }), defaultTimeFilter())
})
