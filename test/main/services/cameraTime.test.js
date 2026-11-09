import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cameraZone,
  parseCameraTime,
  exifCameraTimestamp,
  formatCameraTimestamp,
  effortCameraZone
} from '../../../src/main/services/cameraTime.js'

test('camera settings distinguish civil time from a year-round fixed offset', () => {
  assert.equal(
    parseCameraTime('2024-01-01T12:00:00', 'Europe/Paris').utc,
    '2024-01-01T11:00:00.000Z'
  )
  assert.equal(
    parseCameraTime('2024-07-01T12:00:00', 'Europe/Paris').utc,
    '2024-07-01T10:00:00.000Z'
  )
  assert.equal(parseCameraTime('2024-01-01T12:00:00', 'UTC+02:00').utc, '2024-01-01T10:00:00.000Z')
  assert.equal(parseCameraTime('2024-07-01T12:00:00', 'UTC+02:00').utc, '2024-07-01T10:00:00.000Z')
  assert.equal(parseCameraTime('2024-01-01T12:00:00', 'UTC-03:30').utc, '2024-01-01T15:30:00.000Z')
  for (const invalid of ['UTC+14:30', 'UTC+25:00', 'UTC+01:60', 'somewhere'])
    assert.equal(cameraZone(invalid), null)
})

test('SQL, ISO and EXIF values never acquire the importing computer timezone', () => {
  for (const value of ['2024-05-01T22:30:00', '2024-05-01 22:30:00', '2024:05:01 22:30:00']) {
    const parsed = parseCameraTime(value)
    assert.equal(parsed.local, '2024-05-01T22:30:00.000')
    assert.equal(parsed.utc, null)
    assert.equal(parseCameraTime(value, 'UTC+08:00').utc, '2024-05-01T14:30:00.000Z')
  }
  for (const value of [null, '', 'bad', '22:30:00', '2024-02-30T00:00:00Z'])
    assert.equal(parseCameraTime(value), null)
})

test('EXIF offset tags are preserved rather than replaced by a geographic guess', () => {
  const source = exifCameraTimestamp({
    DateTimeOriginal: '2024:05:01 22:30:00',
    OffsetTimeOriginal: '+02:00'
  })
  assert.equal(parseCameraTime(source).utc, '2024-05-01T20:30:00.000Z')
  assert.equal(parseCameraTime(source).local, '2024-05-01T22:30:00.000')
  assert.equal(
    exifCameraTimestamp({ DateTimeOriginal: '2024:05:01 22:30:00' }),
    '2024:05:01 22:30:00'
  )
})

test('exports retain source offsets and resolve floating values using the confirmed setting', () => {
  assert.equal(
    formatCameraTimestamp('2024-05-01T20:30:00.000Z', '2024-05-01T22:30:00+02:00'),
    '2024-05-01T22:30:00.000+02:00'
  )
  assert.equal(
    formatCameraTimestamp('2024-05-01T20:30:00.000Z', '2024-05-01 22:30:00', 'Europe/Paris'),
    '2024-05-01T22:30:00.000+02:00'
  )
  assert.equal(formatCameraTimestamp(null, '2024-05-01 22:30:00'), null)
})

test('contradictory effort settings are rejected instead of misnormalizing detections', () => {
  assert.equal(
    effortCameraZone('2024-05-01T00:00:00+02:00', '2024-05-02T00:00:00+02:00', 'UTC+08:00'),
    null
  )
  assert.equal(
    effortCameraZone('2024-05-01T00:00:00+02:00', '2024-05-02T00:00:00+02:00', 'Europe/Paris'),
    'Europe/Paris'
  )
})
