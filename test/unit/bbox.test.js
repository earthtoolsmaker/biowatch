import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBboxClause, isAreaBboxApplicable } from '../../src/main/database/queries/bbox.js'

test('returns empty clause and no params when bbox is null', () => {
  const { clause, params } = buildBboxClause(null, 'd')
  assert.equal(clause, '')
  assert.deepEqual(params, [])
})

test('returns empty clause when bbox is undefined', () => {
  const { clause, params } = buildBboxClause(undefined, 'd')
  assert.equal(clause, '')
  assert.deepEqual(params, [])
})

test('builds lat/lng BETWEEN clause with south,north,west,east order', () => {
  const bbox = { north: 51.2, south: 50.8, east: 4.6, west: 4.2 }
  const { clause, params } = buildBboxClause(bbox, 'd')
  assert.equal(
    clause.replace(/\s+/g, ' ').trim(),
    'AND d.latitude BETWEEN ? AND ? AND d.longitude BETWEEN ? AND ?'
  )
  assert.deepEqual(params, [50.8, 51.2, 4.2, 4.6])
})

test('ignores antimeridian-crossing bbox (west > east) — returns no clause', () => {
  const bbox = { north: 10, south: -10, east: -170, west: 170 }
  const { clause, params } = buildBboxClause(bbox, 'd')
  assert.equal(clause, '')
  assert.deepEqual(params, [])
})

test('isAreaBboxApplicable is false for null/undefined', () => {
  assert.equal(isAreaBboxApplicable(null), false)
  assert.equal(isAreaBboxApplicable(undefined), false)
})

test('isAreaBboxApplicable is false for non-numeric or NaN bounds', () => {
  assert.equal(isAreaBboxApplicable({ north: 1, south: 0, east: 'x', west: 0 }), false)
  assert.equal(isAreaBboxApplicable({ north: NaN, south: 0, east: 1, west: 0 }), false)
})

test('isAreaBboxApplicable is false for antimeridian-crossing bbox (west > east)', () => {
  assert.equal(isAreaBboxApplicable({ north: 10, south: -10, east: -170, west: 170 }), false)
})

test('isAreaBboxApplicable is true for a valid bbox', () => {
  assert.equal(isAreaBboxApplicable({ north: 51.2, south: 50.8, east: 4.6, west: 4.2 }), true)
})
