import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseDeploymentsCsv } from '../../../../../src/main/services/import/parsers/deploymentsCsv.js'

async function withTempCsv(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dep-csv-'))
  const file = join(dir, 'in.csv')
  writeFileSync(file, content, 'utf8')
  try {
    return await fn(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const dbRows = [
  {
    deploymentID: 'CAM_001',
    locationID: 'LOC_A',
    locationName: 'Ridge',
    latitude: 45.234,
    longitude: 6.812
  },
  {
    deploymentID: 'CAM_002',
    locationID: 'LOC_A',
    locationName: 'Ridge',
    latitude: 45.241,
    longitude: 6.812
  }
]

describe('parseDeploymentsCsv — header', () => {
  test('rejects CSV without deploymentID column', async () => {
    await withTempCsv('locationID,latitude\nLOC_A,45.0\n', async (file) => {
      const result = await parseDeploymentsCsv(file, dbRows)
      assert.equal(result.error, "Required column 'deploymentID' not found in CSV.")
    })
  })

  test('ignores unknown columns', async () => {
    const csv = 'deploymentID,foo,latitude\nCAM_001,bar,45.234\n'
    await withTempCsv(csv, async (file) => {
      const result = await parseDeploymentsCsv(file, dbRows)
      assert.equal(result.error, undefined)
      assert.equal(result.totalRows, 1)
    })
  })
})

describe('parseDeploymentsCsv — happy path', () => {
  test('all matching rows with identical values → all cells unchanged, applyCount=0', async () => {
    const csv =
      'deploymentID,locationID,locationName,latitude,longitude\n' +
      'CAM_001,LOC_A,Ridge,45.234,6.812\n' +
      'CAM_002,LOC_A,Ridge,45.241,6.812\n'
    await withTempCsv(csv, async (file) => {
      const result = await parseDeploymentsCsv(file, dbRows)
      assert.equal(result.totalRows, 2)
      assert.equal(result.applyCount, 0)
      assert.equal(result.cellWarningCount, 0)
      assert.equal(result.rowSkipCount, 0)
      assert.equal(result.rows[0].columns.latitude.state, 'unchanged')
      assert.equal(result.rows[0].columns.locationName.state, 'unchanged')
    })
  })

  test('empty cells classified as unchanged', async () => {
    const dbRowsWithNulls = [
      {
        deploymentID: 'A01',
        locationID: 'A01',
        locationName: 'A01',
        latitude: null,
        longitude: null
      }
    ]
    const csv = 'deploymentID,locationID,locationName,latitude,longitude\nA01,A01,A01,,\n'
    await withTempCsv(csv, async (file) => {
      const result = await parseDeploymentsCsv(file, dbRowsWithNulls)
      assert.equal(result.rows[0].columns.latitude.state, 'unchanged')
      assert.equal(result.rows[0].columns.longitude.state, 'unchanged')
      assert.equal(result.applyCount, 0)
    })
  })
})
