import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  isValidTimestamp,
  parseFFmpegCreationTime,
  extractTimestampFromFilename
} from '../../../../src/main/services/import/timestamp.js'

// --- isValidTimestamp ---

describe('isValidTimestamp', () => {
  test('rejects null and invalid inputs', () => {
    assert.equal(isValidTimestamp(null), false)
    assert.equal(isValidTimestamp(undefined), false)
    assert.equal(isValidTimestamp(new Date('invalid')), false)
    assert.equal(isValidTimestamp('2024-01-01'), false)
  })

  test('rejects QuickTime epoch (1904-01-01)', () => {
    assert.equal(isValidTimestamp(new Date('1904-01-01T00:00:00Z')), false)
  })

  test('rejects Unix epoch (1970-01-01)', () => {
    assert.equal(isValidTimestamp(new Date('1970-01-01T00:00:00Z')), false)
  })

  test('rejects pre-2000 dates', () => {
    assert.equal(isValidTimestamp(new Date('1999-12-31T23:59:59Z')), false)
  })

  test('rejects future dates beyond current year + 1', () => {
    const futureYear = new Date().getFullYear() + 2
    assert.equal(isValidTimestamp(new Date(`${futureYear}-06-15T12:00:00Z`)), false)
  })

  test('accepts valid camera trap dates', () => {
    assert.equal(isValidTimestamp(new Date('2024-03-15T14:30:22Z')), true)
    assert.equal(isValidTimestamp(new Date('2000-01-01T00:00:00Z')), true)
    assert.equal(isValidTimestamp(new Date('2023-12-31T23:59:59Z')), true)
  })

  test('accepts dates in current year + 1 (clock drift)', () => {
    const nextYear = new Date().getFullYear() + 1
    assert.equal(isValidTimestamp(new Date(`${nextYear}-01-15T12:00:00Z`)), true)
  })
})

// --- parseFFmpegCreationTime ---

describe('parseFFmpegCreationTime', () => {
  test('parses creation_time from typical ffmpeg output', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'video.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2mp41
    creation_time   : 2024-03-15T14:30:22.000000Z
  Duration: 00:00:30.00, start: 0.000000, bitrate: 2500 kb/s
`
    const date = parseFFmpegCreationTime(stderr)
    assert.ok(date)
    assert.equal(date.getFullYear(), 2024)
    assert.equal(date.getMonth(), 2) // March = 2
    assert.equal(date.getDate(), 15)
  })

  test('parses creation_time without fractional seconds', () => {
    const stderr = '    creation_time   : 2023-07-20T08:15:30Z\n'
    const date = parseFFmpegCreationTime(stderr)
    assert.ok(date)
    assert.equal(date.getFullYear(), 2023)
  })

  test('returns null when no creation_time present', () => {
    const stderr = 'Duration: 00:00:30.00, bitrate: 2500 kb/s\n'
    assert.equal(parseFFmpegCreationTime(stderr), null)
  })

  test('returns null for invalid date string', () => {
    const stderr = '    creation_time   : not-a-date\n'
    assert.equal(parseFFmpegCreationTime(stderr), null)
  })
})

// --- extractTimestampFromFilename ---

describe('extractTimestampFromFilename', () => {
  test('parses YYYYMMDD_HHMMSS (Reconyx style)', () => {
    const result = extractTimestampFromFilename('RCNX0001_20240315_143022.MP4')
    assert.ok(result.timestamp)
    assert.equal(result.source, 'filename')
    assert.equal(result.timestamp.getFullYear(), 2024)
    assert.equal(result.timestamp.getMonth(), 2) // March
    assert.equal(result.timestamp.getDate(), 15)
    assert.equal(result.timestamp.getHours(), 14)
    assert.equal(result.timestamp.getMinutes(), 30)
    assert.equal(result.timestamp.getSeconds(), 22)
  })

  test('parses VID_YYYYMMDD_HHMMSS (Android style)', () => {
    const result = extractTimestampFromFilename('VID_20230720_081530.mp4')
    assert.ok(result.timestamp)
    assert.equal(result.timestamp.getFullYear(), 2023)
    assert.equal(result.timestamp.getMonth(), 6) // July
  })

  test('parses YYYYMMDD-HHMMSS (dash separator)', () => {
    const result = extractTimestampFromFilename('20240315-143022.AVI')
    assert.ok(result.timestamp)
    assert.equal(result.timestamp.getFullYear(), 2024)
    assert.equal(result.timestamp.getHours(), 14)
  })

  test('parses YYYY-MM-DD_HH-MM-SS (dashed variant)', () => {
    const result = extractTimestampFromFilename('2024-03-15_14-30-22.mp4')
    assert.ok(result.timestamp)
    assert.equal(result.timestamp.getFullYear(), 2024)
    assert.equal(result.timestamp.getMonth(), 2)
    assert.equal(result.timestamp.getDate(), 15)
    assert.equal(result.timestamp.getHours(), 14)
    assert.equal(result.timestamp.getMinutes(), 30)
    assert.equal(result.timestamp.getSeconds(), 22)
  })

  test('parses YYYYMMDD date-only (time defaults to 00:00:00)', () => {
    const result = extractTimestampFromFilename('IMG_20240315.jpg')
    assert.ok(result.timestamp)
    assert.equal(result.timestamp.getFullYear(), 2024)
    assert.equal(result.timestamp.getMonth(), 2)
    assert.equal(result.timestamp.getDate(), 15)
    assert.equal(result.timestamp.getHours(), 0)
    assert.equal(result.timestamp.getMinutes(), 0)
  })

  test('returns null for filenames with no timestamp', () => {
    const result = extractTimestampFromFilename('DSC_0001.MP4')
    assert.equal(result.timestamp, null)
  })

  test('returns null for filenames with invalid month', () => {
    const result = extractTimestampFromFilename('20241315_143022.MP4')
    assert.equal(result.timestamp, null)
  })

  test('falls back to date-only for filenames with invalid hour', () => {
    // Hour 25 is invalid, so the datetime pattern fails but date-only fallback succeeds
    const result = extractTimestampFromFilename('20240315_253022.MP4')
    assert.ok(result.timestamp)
    assert.equal(result.timestamp.getFullYear(), 2024)
    assert.equal(result.timestamp.getHours(), 0) // time defaults to 00:00:00
  })

  test('returns null for pre-2000 dates in filenames', () => {
    const result = extractTimestampFromFilename('19990315_143022.MP4')
    assert.equal(result.timestamp, null)
  })

  test('handles filenames with path prefix stripped', () => {
    const result = extractTimestampFromFilename('20240315_143022.MP4')
    assert.ok(result.timestamp)
    assert.equal(result.timestamp.getFullYear(), 2024)
  })
})
