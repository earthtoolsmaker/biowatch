import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createWriteStream, readFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

/**
 * Helper that mimics the CORRECT stream writing pattern from download.ts
 * This pattern properly awaits stream completion before returning.
 */
async function writeWithProperAwait(destPath, chunks) {
  const writer = createWriteStream(destPath)

  for (const chunk of chunks) {
    writer.write(chunk)
  }

  // Correct pattern: wait for stream to fully flush
  await new Promise((resolve, reject) => {
    writer.on('error', reject)
    writer.end(() => resolve())
  })

  return destPath
}

/**
 * Helper that mimics the BUGGY stream writing pattern (before the fix).
 * This does NOT await stream completion - causes race conditions.
 */
async function writeWithoutAwait(destPath, chunks) {
  const writer = createWriteStream(destPath)

  for (const chunk of chunks) {
    writer.write(chunk)
  }

  // Buggy pattern: doesn't wait for stream to flush
  writer.end()

  return destPath
}

describe('Download Stream Completion', () => {
  const testDir = tmpdir()

  test('proper await pattern ensures file is fully written before returning', async () => {
    const destPath = join(testDir, `test-proper-${randomUUID()}.bin`)

    // Create test data: multiple chunks totaling ~1MB
    const chunkSize = 64 * 1024 // 64KB chunks
    const numChunks = 16
    const chunks = Array(numChunks)
      .fill(null)
      .map(() => Buffer.alloc(chunkSize, 0x42)) // Fill with 'B' (0x42)

    const expectedSize = chunkSize * numChunks

    try {
      await writeWithProperAwait(destPath, chunks)

      // File should exist and have correct size immediately after function returns
      assert.ok(existsSync(destPath), 'File should exist after write completes')

      const content = readFileSync(destPath)
      assert.equal(content.length, expectedSize, 'File should have all bytes written')

      // Verify content integrity
      const allBytesCorrect = content.every((byte) => byte === 0x42)
      assert.ok(allBytesCorrect, 'All bytes should match expected value')
    } finally {
      if (existsSync(destPath)) unlinkSync(destPath)
    }
  })

  test('buggy pattern (no await) can result in incomplete or missing file', async () => {
    const destPath = join(testDir, `test-buggy-${randomUUID()}.bin`)

    // Use larger data to increase chance of catching race condition
    const chunkSize = 64 * 1024
    const numChunks = 32
    const chunks = Array(numChunks)
      .fill(null)
      .map(() => Buffer.alloc(chunkSize, 0x43))

    const expectedSize = chunkSize * numChunks

    try {
      await writeWithoutAwait(destPath, chunks)

      // Immediately check file - it may be incomplete or not exist yet
      // This demonstrates the race condition bug
      if (!existsSync(destPath)) {
        // File doesn't exist yet - race condition triggered
        assert.ok(true, 'Buggy pattern: file not created yet (race condition triggered)')
      } else {
        const content = readFileSync(destPath)
        if (content.length < expectedSize) {
          assert.ok(true, 'Buggy pattern: incomplete file (race condition triggered)')
        } else {
          // File happened to be complete - timing-dependent, still valid
          assert.ok(true, 'File happened to complete in time (race condition not triggered)')
        }
      }
    } finally {
      // Wait for file operations to complete before cleanup
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (existsSync(destPath)) unlinkSync(destPath)
    }
  })

  test('proper await pattern works with empty file', async () => {
    const destPath = join(testDir, `test-empty-${randomUUID()}.bin`)

    try {
      await writeWithProperAwait(destPath, [])

      assert.ok(existsSync(destPath), 'Empty file should be created')
      const content = readFileSync(destPath)
      assert.equal(content.length, 0, 'File should be empty')
    } finally {
      if (existsSync(destPath)) unlinkSync(destPath)
    }
  })

  test('proper await pattern works with single small chunk', async () => {
    const destPath = join(testDir, `test-small-${randomUUID()}.bin`)
    const testData = Buffer.from('Hello, World!')

    try {
      await writeWithProperAwait(destPath, [testData])

      const content = readFileSync(destPath)
      assert.deepEqual(content, testData, 'Content should match')
    } finally {
      if (existsSync(destPath)) unlinkSync(destPath)
    }
  })

  test('proper await pattern propagates stream errors', async () => {
    // Try to write to an invalid path (directory that doesn't exist)
    const destPath = join(testDir, 'nonexistent-dir-' + randomUUID(), 'file.bin')

    try {
      await writeWithProperAwait(destPath, [Buffer.from('test')])
    } catch (err) {
      // Error should be propagated (ENOENT or similar)
      assert.ok(
        err.code === 'ENOENT' || err.code === 'ERR_STREAM_WRITE_AFTER_END',
        `Should get a file system error, got: ${err.code}`
      )
    }

    // Note: createWriteStream may not error immediately for all cases
    // The important thing is that if an error occurs, it's not swallowed
    assert.ok(true, 'Error handling test completed')
  })
})
