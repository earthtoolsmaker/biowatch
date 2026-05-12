import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'
import { eq } from 'drizzle-orm'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  getDrizzleDb,
  deployments
} from '../../../../src/main/database/index.js'
import { applyDeploymentsCsv } from '../../../../src/main/services/import/applyDeploymentsCsv.js'

let testStudyId
let testDbPath
let testBiowatchDataPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    /* ok */
  }
  testStudyId = `test-apply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-apply-csv-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'CAM_001',
      locationID: 'LOC_A',
      locationName: 'Ridge',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: null,
      longitude: null
    },
    d2: {
      deploymentID: 'CAM_002',
      locationID: 'LOC_A',
      locationName: 'Ridge',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: null,
      longitude: null
    },
    d3: {
      deploymentID: 'CAM_003',
      locationID: 'LOC_B',
      locationName: 'Slope',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: 10,
      longitude: 20
    }
  })
}

describe('applyDeploymentsCsv', () => {
  test('updates lat/lon for a single deployment', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    const summary = await applyDeploymentsCsv(db, [
      { deploymentID: 'CAM_001', fields: { latitude: 45.5, longitude: 6.5 } }
    ])

    assert.equal(summary.deploymentsUpdated, 1)
    const row = await db
      .select()
      .from(deployments)
      .where(eq(deployments.deploymentID, 'CAM_001'))
    assert.equal(row[0].latitude, 45.5)
    assert.equal(row[0].longitude, 6.5)
  })

  test('propagates locationName to all deployments sharing locationID', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    const summary = await applyDeploymentsCsv(db, [
      { deploymentID: 'CAM_001', fields: { locationName: 'Ridge South' } }
    ])

    assert.equal(summary.locationsNamed, 1)
    const a = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_001'))
    const b = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_002'))
    const c = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_003'))
    assert.equal(a[0].locationName, 'Ridge South')
    assert.equal(b[0].locationName, 'Ridge South')
    assert.equal(c[0].locationName, 'Slope')
  })

  test('re-validates and drops out-of-range coords silently', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    await applyDeploymentsCsv(db, [
      { deploymentID: 'CAM_001', fields: { latitude: 200, longitude: 6.5 } }
    ])

    const row = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_001'))
    assert.equal(row[0].latitude, null)
    assert.equal(row[0].longitude, 6.5)
  })

  test('empty plan is a no-op', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    const summary = await applyDeploymentsCsv(db, [])

    assert.equal(summary.deploymentsUpdated, 0)
    assert.equal(summary.locationsNamed, 0)
  })

  test('rolls back on synthetic failure mid-transaction', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    await assert.rejects(
      applyDeploymentsCsv(db, [
        { deploymentID: 'CAM_001', fields: { latitude: 45.5 } },
        { __forceFailure: true }
      ])
    )

    const row = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_001'))
    assert.equal(row[0].latitude, null)
  })
})
