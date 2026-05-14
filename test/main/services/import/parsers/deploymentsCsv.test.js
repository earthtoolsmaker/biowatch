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
      assert.equal(result.rowsBlockedByWarningCount, 0)
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

describe('parseDeploymentsCsv — per-cell validation', () => {
  test('latitude > 90 → warning', async () => {
    const csv = 'deploymentID,latitude\nCAM_001,91.5\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.latitude.state, 'warning')
      assert.match(r.rows[0].columns.latitude.warning, /outside \[-90, 90\]/)
      assert.equal(r.rowsBlockedByWarningCount, 1)
      assert.equal(r.applyCount, 0)
    })
  })

  test('longitude < -180 → warning', async () => {
    const csv = 'deploymentID,longitude\nCAM_001,-181\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.longitude.state, 'warning')
    })
  })

  test('non-numeric latitude → warning', async () => {
    const csv = 'deploymentID,latitude\nCAM_001,abc\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.latitude.state, 'warning')
      assert.match(r.rows[0].columns.latitude.warning, /not a valid number/)
    })
  })

  test('locationID mismatch → warning', async () => {
    const csv =
      'deploymentID,locationID,locationName,latitude,longitude\nCAM_001,LOC_X,Ridge,45.234,6.812\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.locationID.state, 'warning')
      assert.match(r.rows[0].columns.locationID.warning, /read-only/)
    })
  })

  test('unknown deploymentID → row skipped', async () => {
    const csv = 'deploymentID,latitude\nCAM_NEW,45.0\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].rowState, 'skipped')
      assert.match(r.rows[0].rowWarning, /No deployment with this ID/)
      assert.equal(r.rowSkipCount, 1)
      assert.equal(r.applyCount, 0)
    })
  })

  test('valid change → state=change, applyCount=1', async () => {
    const csv = 'deploymentID,latitude\nCAM_001,45.5\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.latitude.state, 'change')
      assert.equal(r.rows[0].columns.latitude.appliedValue, 45.5)
      assert.equal(r.applyCount, 1)
    })
  })

  test('row with a warning cell blocks the whole row even when other cells would change', async () => {
    // locationID mismatch (warning) + valid latitude change in the same row.
    // Under row-level semantics the whole row is blocked: applyCount stays
    // at 0, and the row counts toward rowsBlockedByWarningCount.
    const csv =
      'deploymentID,locationID,latitude,longitude\n' +
      'CAM_001,LOC_X,45.5,6.812\n' +
      'CAM_002,LOC_A,45.241,6.812\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.locationID.state, 'warning')
      assert.equal(r.rows[0].columns.latitude.state, 'change')
      assert.equal(r.applyCount, 0)
      assert.equal(r.rowsBlockedByWarningCount, 1)
    })
  })
})

describe('parseDeploymentsCsv — duplicates & name conflicts', () => {
  const dbRowsDup = [
    {
      deploymentID: 'CAM_001',
      locationID: 'LOC_A',
      locationName: 'Ridge',
      latitude: 45.0,
      longitude: 6.0
    },
    {
      deploymentID: 'CAM_002',
      locationID: 'LOC_A',
      locationName: 'Ridge',
      latitude: 45.0,
      longitude: 6.0
    }
  ]

  test('duplicate deploymentID rows in CSV → last wins, earlier change cells become warning', async () => {
    const csv = 'deploymentID,latitude\nCAM_001,45.10\nCAM_001,45.20\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRowsDup)
      assert.equal(r.rows[0].columns.latitude.state, 'warning')
      assert.match(r.rows[0].columns.latitude.warning, /Overridden by row 2 below/)
      assert.equal(r.rows[1].columns.latitude.state, 'change')
      assert.equal(r.rows[1].columns.latitude.appliedValue, 45.2)
      assert.equal(r.applyCount, 1)
    })
  })

  test('intra-locationID name conflict → last wins, earlier name cells become warning', async () => {
    const csv =
      'deploymentID,locationID,locationName\nCAM_001,LOC_A,Ridge South\nCAM_002,LOC_A,Ridge North\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRowsDup)
      assert.equal(r.rows[0].columns.locationName.state, 'warning')
      assert.match(r.rows[0].columns.locationName.warning, /Conflicting names for LOC_A/)
      assert.equal(r.rows[1].columns.locationName.state, 'change')
      assert.equal(r.applyCount, 1)
    })
  })

  test('intra-locationID names that agree → both rows count as change', async () => {
    const csv =
      'deploymentID,locationID,locationName\nCAM_001,LOC_A,Ridge X\nCAM_002,LOC_A,Ridge X\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRowsDup)
      assert.equal(r.rows[0].columns.locationName.state, 'change')
      assert.equal(r.rows[1].columns.locationName.state, 'change')
      assert.equal(r.applyCount, 2)
    })
  })
})
