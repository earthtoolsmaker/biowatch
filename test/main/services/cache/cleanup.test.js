import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import fs from 'fs/promises'

import { cleanExpiredTranscodeCacheImpl } from '../../../../src/main/services/cache/cleanup.js'

// Test paths
let testStudiesPath

beforeEach(async () => {
  // Disable electron-log output in tests
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment, that's fine
  }

  testStudiesPath = join(tmpdir(), 'biowatch-cache-test', Date.now().toString())
  mkdirSync(testStudiesPath, { recursive: true })
})

afterEach(async () => {
  // Clean up test directory
  if (existsSync(testStudiesPath)) {
    rmSync(testStudiesPath, { recursive: true, force: true })
  }
})

/**
 * Helper to create a study directory with cache files
 * @param {string} studyId - Study UUID
 * @param {Array<{name: string, ageDays: number, sizeKB?: number}>} files - Files to create
 */
async function createStudyWithCache(studyId, files) {
  const cacheDir = join(testStudiesPath, studyId, 'cache', 'transcodes')
  await fs.mkdir(cacheDir, { recursive: true })

  for (const { name, ageDays, sizeKB = 100 } of files) {
    const filePath = join(cacheDir, name)
    await fs.writeFile(filePath, Buffer.alloc(sizeKB * 1024))

    // Set modification time to simulate age
    const mtime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
    await fs.utimes(filePath, mtime, mtime)
  }
}

/**
 * Helper to check if a file exists
 */
async function fileExists(filePath) {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

describe('Cache Cleanup Tests', () => {
  describe('cleanExpiredTranscodeCacheImpl', () => {
    test('should handle non-existent studies directory gracefully', async () => {
      const nonExistentPath = join(testStudiesPath, 'non-existent')

      const result = await cleanExpiredTranscodeCacheImpl(nonExistentPath)

      assert.equal(result.deletedCount, 0, 'Should not delete any files')
      assert.equal(result.freedBytes, 0, 'Should not free any bytes')
    })

    test('should handle empty studies directory', async () => {
      // testStudiesPath already exists but is empty

      const result = await cleanExpiredTranscodeCacheImpl(testStudiesPath)

      assert.equal(result.deletedCount, 0, 'Should not delete any files')
      assert.equal(result.freedBytes, 0, 'Should not free any bytes')
    })

    test('should skip studies without cache directories', async () => {
      // Create a study directory without cache subdirectory
      await fs.mkdir(join(testStudiesPath, 'study-without-cache'), { recursive: true })

      const result = await cleanExpiredTranscodeCacheImpl(testStudiesPath)

      assert.equal(result.deletedCount, 0, 'Should not delete any files')
      assert.equal(result.freedBytes, 0, 'Should not free any bytes')
    })

    test('should not delete files that are newer than max age', async () => {
      await createStudyWithCache('study-1', [
        { name: 'recent1.mp4', ageDays: 1 },
        { name: 'recent2.mp4', ageDays: 15 },
        { name: 'recent3.mp4', ageDays: 29 }
      ])

      const result = await cleanExpiredTranscodeCacheImpl(testStudiesPath)

      assert.equal(result.deletedCount, 0, 'Should not delete recent files')
      assert.equal(result.freedBytes, 0, 'Should not free any bytes')

      // Verify files still exist
      const cacheDir = join(testStudiesPath, 'study-1', 'cache', 'transcodes')
      assert(await fileExists(join(cacheDir, 'recent1.mp4')), 'recent1.mp4 should exist')
      assert(await fileExists(join(cacheDir, 'recent2.mp4')), 'recent2.mp4 should exist')
      assert(await fileExists(join(cacheDir, 'recent3.mp4')), 'recent3.mp4 should exist')
    })

    test('should delete all files that are older than max age', async () => {
      await createStudyWithCache('study-1', [
        { name: 'old1.mp4', ageDays: 31, sizeKB: 100 },
        { name: 'old2.mp4', ageDays: 60, sizeKB: 200 },
        { name: 'old3.mp4', ageDays: 90, sizeKB: 300 }
      ])

      const result = await cleanExpiredTranscodeCacheImpl(testStudiesPath)

      assert.equal(result.deletedCount, 3, 'Should delete all 3 expired files')
      assert.equal(result.freedBytes, 600 * 1024, 'Should free 600KB')

      // Verify files are deleted
      const cacheDir = join(testStudiesPath, 'study-1', 'cache', 'transcodes')
      assert(!(await fileExists(join(cacheDir, 'old1.mp4'))), 'old1.mp4 should be deleted')
      assert(!(await fileExists(join(cacheDir, 'old2.mp4'))), 'old2.mp4 should be deleted')
      assert(!(await fileExists(join(cacheDir, 'old3.mp4'))), 'old3.mp4 should be deleted')
    })

    test('should only delete expired files when mixed ages present', async () => {
      await createStudyWithCache('study-1', [
        { name: 'recent.mp4', ageDays: 10, sizeKB: 100 },
        { name: 'old.mp4', ageDays: 45, sizeKB: 200 }
      ])

      const result = await cleanExpiredTranscodeCacheImpl(testStudiesPath)

      assert.equal(result.deletedCount, 1, 'Should delete only the expired file')
      assert.equal(result.freedBytes, 200 * 1024, 'Should free 200KB')

      // Verify correct file handling
      const cacheDir = join(testStudiesPath, 'study-1', 'cache', 'transcodes')
      assert(await fileExists(join(cacheDir, 'recent.mp4')), 'recent.mp4 should still exist')
      assert(!(await fileExists(join(cacheDir, 'old.mp4'))), 'old.mp4 should be deleted')
    })

    test('should handle multiple studies with mixed cache states', async () => {
      // Study 1: Has expired files
      await createStudyWithCache('study-1', [{ name: 'old.mp4', ageDays: 40, sizeKB: 100 }])

      // Study 2: Has only recent files
      await createStudyWithCache('study-2', [{ name: 'recent.mp4', ageDays: 5, sizeKB: 150 }])

      // Study 3: No cache directory (just the study folder)
      await fs.mkdir(join(testStudiesPath, 'study-3'), { recursive: true })

      // Study 4: Has mixed ages
      await createStudyWithCache('study-4', [
        { name: 'recent.mp4', ageDays: 20, sizeKB: 50 },
        { name: 'expired.mp4', ageDays: 60, sizeKB: 75 }
      ])

      const result = await cleanExpiredTranscodeCacheImpl(testStudiesPath)

      assert.equal(
        result.deletedCount,
        2,
        'Should delete 2 expired files (from study-1 and study-4)'
      )
      assert.equal(result.freedBytes, 175 * 1024, 'Should free 175KB')

      // Verify file states
      assert(
        !(await fileExists(join(testStudiesPath, 'study-1', 'cache', 'transcodes', 'old.mp4'))),
        'study-1 old.mp4 should be deleted'
      )
      assert(
        await fileExists(join(testStudiesPath, 'study-2', 'cache', 'transcodes', 'recent.mp4')),
        'study-2 recent.mp4 should exist'
      )
      assert(
        await fileExists(join(testStudiesPath, 'study-4', 'cache', 'transcodes', 'recent.mp4')),
        'study-4 recent.mp4 should exist'
      )
      assert(
        !(await fileExists(join(testStudiesPath, 'study-4', 'cache', 'transcodes', 'expired.mp4'))),
        'study-4 expired.mp4 should be deleted'
      )
    })

    test('should only delete .mp4 files, not other file types', async () => {
      const cacheDir = join(testStudiesPath, 'study-1', 'cache', 'transcodes')
      await fs.mkdir(cacheDir, { recursive: true })

      // Create various file types, all "old"
      const files = [
        { name: 'video.mp4', ext: '.mp4' },
        { name: 'video.txt', ext: '.txt' },
        { name: 'video.tmp', ext: '.tmp' },
        { name: 'video.avi', ext: '.avi' },
        { name: '.DS_Store', ext: '' }
      ]

      for (const { name } of files) {
        const filePath = join(cacheDir, name)
        await fs.writeFile(filePath, Buffer.alloc(1024))
        const mtime = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
        await fs.utimes(filePath, mtime, mtime)
      }

      const result = await cleanExpiredTranscodeCacheImpl(testStudiesPath)

      assert.equal(result.deletedCount, 1, 'Should only delete the .mp4 file')

      // Verify only mp4 was deleted
      assert(!(await fileExists(join(cacheDir, 'video.mp4'))), 'video.mp4 should be deleted')
      assert(await fileExists(join(cacheDir, 'video.txt')), 'video.txt should exist')
      assert(await fileExists(join(cacheDir, 'video.tmp')), 'video.tmp should exist')
      assert(await fileExists(join(cacheDir, 'video.avi')), 'video.avi should exist')
      assert(await fileExists(join(cacheDir, '.DS_Store')), '.DS_Store should exist')
    })

    test('should respect custom maxAgeMs parameter', async () => {
      await createStudyWithCache('study-1', [
        { name: 'file1.mp4', ageDays: 5 },
        { name: 'file2.mp4', ageDays: 10 },
        { name: 'file3.mp4', ageDays: 15 }
      ])

      // Use 7 days as max age instead of default 30
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
      const result = await cleanExpiredTranscodeCacheImpl(testStudiesPath, sevenDaysMs)

      assert.equal(result.deletedCount, 2, 'Should delete files older than 7 days')

      // Verify correct files remain
      const cacheDir = join(testStudiesPath, 'study-1', 'cache', 'transcodes')
      assert(await fileExists(join(cacheDir, 'file1.mp4')), 'file1.mp4 (5 days) should exist')
      assert(
        !(await fileExists(join(cacheDir, 'file2.mp4'))),
        'file2.mp4 (10 days) should be deleted'
      )
      assert(
        !(await fileExists(join(cacheDir, 'file3.mp4'))),
        'file3.mp4 (15 days) should be deleted'
      )
    })
  })
})
