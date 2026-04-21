import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchGbifCommonName,
  _clearGbifCache
} from '../../../src/renderer/src/utils/commonNames.js'

// Mock global fetch on each test.
let fetchCalls
function installFetchMock(responses) {
  fetchCalls = []
  let i = 0
  global.fetch = async (url) => {
    fetchCalls.push(url)
    const r = responses[i++]
    if (!r) throw new Error(`unexpected fetch #${i}: ${url}`)
    if (r.reject) throw r.reject
    return {
      ok: r.ok ?? true,
      json: async () => r.json
    }
  }
}

beforeEach(() => {
  _clearGbifCache()
  fetchCalls = []
})

describe('fetchGbifCommonName', () => {
  test('returns null when match has no usageKey', async () => {
    installFetchMock([{ json: {} }])
    const result = await fetchGbifCommonName('Foo bar')
    assert.equal(result, null)
    assert.equal(fetchCalls.length, 1)
  })

  test('returns scored English name from vernacularNames', async () => {
    installFetchMock([
      { json: { usageKey: 12345 } },
      {
        json: {
          results: [
            { vernacularName: 'Ardilla roja', language: 'eng', source: 'EUNIS' },
            {
              vernacularName: 'Eurasian Red Squirrel',
              language: 'eng',
              source: 'Integrated Taxonomic Information System (ITIS)'
            }
          ]
        }
      }
    ])

    const result = await fetchGbifCommonName('Sciurus vulgaris')
    assert.equal(result, 'Eurasian Red Squirrel')
    assert.equal(fetchCalls.length, 2)
  })

  test('caches results in-memory across calls', async () => {
    installFetchMock([
      { json: { usageKey: 1 } },
      { json: { results: [{ vernacularName: 'Cat', language: 'eng', source: 'ITIS' }] } }
    ])

    const a = await fetchGbifCommonName('Felis catus')
    const b = await fetchGbifCommonName('Felis catus')
    assert.equal(a, 'Cat')
    assert.equal(b, 'Cat')
    // Only the first call should hit fetch.
    assert.equal(fetchCalls.length, 2)
  })

  test('caches null results to avoid retry storms', async () => {
    installFetchMock([{ json: {} }])

    const a = await fetchGbifCommonName('Unknown species')
    const b = await fetchGbifCommonName('Unknown species')
    assert.equal(a, null)
    assert.equal(b, null)
    assert.equal(fetchCalls.length, 1)
  })
})
