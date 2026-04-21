import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickEnglishCommonName } from '../../../src/shared/commonNames/gbifScorer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../../fixtures/gbif')

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))
}

describe('pickEnglishCommonName', () => {
  test('returns null for null input', () => {
    assert.equal(pickEnglishCommonName(null), null)
  })

  test('returns null for empty results array', () => {
    assert.equal(pickEnglishCommonName([]), null)
  })

  test('returns null when no candidates have language="eng"', () => {
    const results = [
      { vernacularName: 'Ardilla roja', language: 'spa', source: 'EUNIS' }
    ]
    assert.equal(pickEnglishCommonName(results), null)
  })

  test('prefers ITIS over unknown sources', () => {
    const results = [
      { vernacularName: 'Funny Name', language: 'eng', source: 'Random Source' },
      {
        vernacularName: 'Eurasian Red Squirrel',
        language: 'eng',
        source: 'Integrated Taxonomic Information System (ITIS)'
      }
    ]
    assert.equal(pickEnglishCommonName(results), 'Eurasian Red Squirrel')
  })

  test('falls back to first eng-tagged entry when no trusted source present', () => {
    const results = [
      { vernacularName: 'Some Name', language: 'eng', source: 'Random' }
    ]
    assert.equal(pickEnglishCommonName(results), 'Some Name')
  })

  test('Sciurus vulgaris fixture returns "Eurasian Red Squirrel" not "Ardilla Roja"', () => {
    const fixture = loadFixture('sciurusVulgaris.json')
    const result = pickEnglishCommonName(fixture.vernacularData.results)
    assert.match(result, /eurasian.*squirrel/i)
    assert.ok(
      !/ardilla/i.test(result),
      `must not pick the Spanish "Ardilla" variant, got ${JSON.stringify(result)}`
    )
  })

  test('Sciurus anomalus fixture returns "Caucasian Squirrel" not "Ardilla del Cáucaso"', () => {
    const fixture = loadFixture('sciurusAnomalus.json')
    const result = pickEnglishCommonName(fixture.vernacularData.results)
    assert.match(result, /caucasian.*squirrel/i)
  })

  test('Cervus elaphus fixture returns a Red Deer variant', () => {
    const fixture = loadFixture('cervusElaphus.json')
    const result = pickEnglishCommonName(fixture.vernacularData.results)
    assert.match(result, /red deer/i)
  })

  test('Panthera tigris fixture returns "Tiger"', () => {
    const fixture = loadFixture('pantheraTigris.json')
    const result = pickEnglishCommonName(fixture.vernacularData.results)
    assert.match(result, /tiger/i)
  })
})
