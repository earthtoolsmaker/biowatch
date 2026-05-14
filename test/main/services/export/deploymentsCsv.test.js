import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderDeploymentsCsv } from '../../../../src/main/services/export/deploymentsCsv.js'

describe('renderDeploymentsCsv', () => {
  test('renders header row even for empty input', () => {
    const csv = renderDeploymentsCsv([])
    assert.equal(csv, 'deploymentID,locationID,locationName,latitude,longitude\n')
  })

  test('renders a single row with all fields', () => {
    const csv = renderDeploymentsCsv([
      {
        deploymentID: 'CAM_001',
        locationID: 'LOC_A',
        locationName: 'Ridge',
        latitude: 45.234,
        longitude: 6.812
      }
    ])
    assert.equal(
      csv,
      'deploymentID,locationID,locationName,latitude,longitude\nCAM_001,LOC_A,Ridge,45.234,6.812\n'
    )
  })

  test('emits empty cells for null DB values', () => {
    const csv = renderDeploymentsCsv([
      {
        deploymentID: 'A01',
        locationID: 'A01',
        locationName: null,
        latitude: null,
        longitude: null
      }
    ])
    assert.equal(csv, 'deploymentID,locationID,locationName,latitude,longitude\nA01,A01,,,\n')
  })

  test('quotes values containing commas, quotes, or newlines', () => {
    const csv = renderDeploymentsCsv([
      {
        deploymentID: 'CAM_002',
        locationID: 'LOC_B',
        locationName: 'Ridge, South',
        latitude: 45.0,
        longitude: 6.0
      }
    ])
    assert.ok(csv.includes('"Ridge, South"'))
  })

  test('preserves synthesized biowatch-geo: locationID prefix', () => {
    const csv = renderDeploymentsCsv([
      {
        deploymentID: 'CAM_001',
        locationID: 'biowatch-geo:45.2340,6.8120',
        locationName: null,
        latitude: 45.234,
        longitude: 6.812
      }
    ])
    assert.ok(csv.includes('biowatch-geo:45.2340,6.8120'))
  })

  test('preserves caller-provided row order', () => {
    const csv = renderDeploymentsCsv([
      { deploymentID: 'B', locationID: 'L', locationName: null, latitude: null, longitude: null },
      { deploymentID: 'A', locationID: 'L', locationName: null, latitude: null, longitude: null }
    ])
    const lines = csv.trim().split('\n')
    assert.equal(lines[1].split(',')[0], 'B')
    assert.equal(lines[2].split(',')[0], 'A')
  })
})
