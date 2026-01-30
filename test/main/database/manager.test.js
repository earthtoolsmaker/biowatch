import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import {
  getStudyDatabase,
  closeAllDatabases,
  getMetadata
} from '../../../src/main/database/index.js'

let testRootPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment
  }

  testStudyId = `test-readonly-${Date.now()}`
  testRootPath = join(tmpdir(), 'biowatch-readonly-test', testStudyId)
  testDbPath = join(testRootPath, 'studies', testStudyId, 'study.db')

  mkdirSync(join(testRootPath, 'studies', testStudyId), { recursive: true })
})

afterEach(async () => {
  await closeAllDatabases()

  if (existsSync(testRootPath)) {
    rmSync(testRootPath, { recursive: true, force: true })
  }
})

describe('Readonly database migration safety', () => {
  test('should run migrations before opening readonly database', async () => {
    // Create an empty database file to simulate pre-migration schema
    const sqlite = new Database(testDbPath)
    sqlite.close()

    const manager = await getStudyDatabase(testStudyId, testDbPath, { readonly: true })

    await assert.doesNotReject(async () => {
      const metadata = await getMetadata(manager.getDb())
      assert.equal(metadata, null)
    })

    const metadataTable = manager
      .getSqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'")
      .all()

    assert.equal(metadataTable.length, 1, 'metadata table should exist after migrations')
  })
})
