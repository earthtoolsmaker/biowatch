import { test } from 'node:test'
import assert from 'node:assert/strict'
import SunCalc from 'suncalc'
import {
  createSolarClock,
  solarHours,
  solarExposure,
  SOLAR_DAY_MS
} from '../../../src/main/services/solarTime.js'
import {
  groupEffortByHour,
  validateDeploymentIntervals
} from '../../../src/main/services/sequences/effort.js'

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`)
const events = (date, lat, lon) => SunCalc.getTimes(new Date(`${date}T12:00:00Z`), lat, lon)

for (const [lat, lon] of [
  [48, 2],
  [-34, 18],
  [0, 0],
  [40, -170],
  [-30, 175]
]) {
  for (const date of ['2024-03-20', '2024-06-21', '2024-09-22', '2024-12-21']) {
    test(`anchors, daylight and actual following night: ${lat},${lon} ${date}`, () => {
      const { sunrise, sunset } = events(date, lat, lon)
      const next = SunCalc.getTimes(new Date(sunset.getTime() + SOLAR_DAY_MS), lat, lon).sunrise
      const rise = +sunrise,
        set = +sunset,
        following = +next
      close(solarHours(sunrise.toISOString(), lat, lon), 6)
      close(solarHours(sunset.toISOString(), lat, lon), 18)
      close(solarHours((rise + set) / 2, lat, lon), 12)
      close(solarHours((set + following) / 2, lat, lon), 0)
      assert.equal(Math.floor(solarHours(set - 1, lat, lon)), 17)
      assert.equal(Math.floor(solarHours(rise - 1, lat, lon)), 5)
      const exposure = solarExposure({ start: rise, end: following, latitude: lat, longitude: lon })
      close(
        exposure.reduce((a, b) => a + b, 0),
        following - rise,
        0.01
      )
      for (let h = 6; h < 18; h++) close(exposure[h], (set - rise) / 12, 0.01)
      close(exposure[23], (following - set) / 12, 0.01)
    })
  }
}

test('daylight crossing UTC midnight keeps complete dates', () => {
  const { sunrise, sunset } = events('2024-06-21', 40, -170)
  assert.notEqual(sunrise.getUTCDate(), sunset.getUTCDate())
  close(solarHours((+sunrise + +sunset) / 2, 40, -170), 12)
})

test('unavailable input and polar seasons have no conversion or fabricated effort', () => {
  for (const instant of [null, '', 'not-a-date', '2024-06-21T12:00:00'])
    assert.equal(solarHours(instant, 0, 0), null)
  for (const coords of [
    [null, 0],
    [0, null],
    [91, 0],
    [0, 181],
    [NaN, 0]
  ])
    assert.equal(solarHours('2024-06-21T12:00:00Z', ...coords), null)
  for (const date of ['2024-06-21', '2024-12-21']) {
    assert.equal(solarHours(`${date}T12:00:00Z`, 89, 0), null)
    const start = Date.parse(`${date}T00:00:00Z`)
    assert.deepEqual(
      solarExposure({ start, end: start + SOLAR_DAY_MS, latitude: 89, longitude: 0 }),
      Array(24).fill(0)
    )
  }
})

test('inverse-mapped real exposure clips bounds, unions fractional and wraparound ranges', () => {
  const { sunrise, sunset } = events('2024-06-21', 48, 2)
  const unit = (+sunset - +sunrise) / 12
  const interval = { start: +sunrise, end: +sunset, latitude: 48, longitude: 2 }
  const bins = solarExposure(interval, [
    { start: 6.25, end: 7.5 },
    { start: 7, end: 8 },
    { start: 23, end: 6.5 }
  ])
  close(bins[6], unit, 0.01) // wrap union fills 6..6.5, first covers 6.25..7
  close(bins[7], unit, 0.01)
  close(
    bins.reduce((a, b) => a + b, 0),
    unit * 2,
    0.01
  )
  const clipped = groupEffortByHour([interval], {
    timeMode: 'solar',
    start: new Date(+sunrise + unit / 2).toISOString(),
    end: new Date(+sunrise + unit * 1.5).toISOString()
  })
  close(
    clipped.reduce((a, b) => a + b, 0),
    unit / SOLAR_DAY_MS,
    1e-7
  )
})

test('solar exposure is real UTC duration across civil DST transition dates in both hemispheres', () => {
  for (const [date, latitude, longitude] of [
    ['2024-03-31', 48, 2],
    ['2024-10-27', 48, 2],
    ['2024-04-07', -36, 175],
    ['2024-09-29', -36, 175]
  ]) {
    const start = Date.parse(`${date}T00:00:00Z`)
    const totals = solarExposure({ start, end: start + SOLAR_DAY_MS, latitude, longitude })
    close(
      totals.reduce((sum, value) => sum + value, 0),
      SOLAR_DAY_MS,
      0.01
    )
  }
})

test('solar exposure does not require a camera clock setting', () => {
  const row = {
    deploymentID: 'd',
    deploymentStart: '2024-06-21T00:00:00Z',
    deploymentEnd: '2024-06-22T00:00:00Z',
    latitude: 48,
    longitude: 2
  }
  assert.equal(validateDeploymentIntervals([row]).validDeploymentCount, 0)
  assert.equal(validateDeploymentIntervals([row], { timeMode: 'solar' }).validDeploymentCount, 1)
})

test('astronomy cache is bounded and reused for observations on one date', () => {
  let calls = 0
  const clock = createSolarClock({
    limit: 8,
    getTimes: (...args) => {
      calls++
      return SunCalc.getTimes(...args)
    }
  })
  for (let i = 0; i < 1000; i++) clock.hours(Date.parse('2024-06-21T12:00:00Z') + i, 48, 2)
  assert.ok(calls < 10, `${calls} astronomy calls`)
  for (let i = 0; i < 100; i++)
    clock.hours(Date.parse('2024-06-21T12:00:00Z') + i * SOLAR_DAY_MS, 48, 2)
  assert.ok(clock.cacheSize <= 8)
})
