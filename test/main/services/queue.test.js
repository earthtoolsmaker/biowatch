import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { createImageDirectoryDatabase } from '../../../src/main/database/index.js'
import {
  enqueue,
  enqueueBatch,
  claimBatch,
  complete,
  fail,
  getStatus,
  getJobs,
  cancel,
  retryFailed,
  recoverStale
} from '../../../src/main/services/queue.js'

let testBiowatchDataPath
let testDbPath
let testStudyId
let manager

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

  testStudyId = `test-queue-${Date.now()}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-queue-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')

  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
  manager = await createImageDirectoryDatabase(testDbPath)
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// enqueue / enqueueBatch
// ---------------------------------------------------------------------------

describe('enqueue / enqueueBatch', () => {
  test('enqueue a single job with correct defaults', () => {
    const job = enqueue(manager, {
      kind: 'ml-inference',
      topic: 'speciesnet:4.0.1a',
      payload: { mediaId: 'm1', filePath: '/img.jpg' }
    })

    assert.ok(job.id)
    assert.equal(job.kind, 'ml-inference')
    assert.equal(job.topic, 'speciesnet:4.0.1a')
    assert.equal(job.status, 'pending')
    assert.deepEqual(job.payload, { mediaId: 'm1', filePath: '/img.jpg' })
    assert.equal(job.error, null)
    assert.equal(job.attempts, 0)
    assert.equal(job.maxAttempts, 3)
    assert.ok(job.createdAt)
    assert.equal(job.startedAt, null)
    assert.equal(job.completedAt, null)
  })

  test('enqueueBatch inserts multiple jobs atomically', () => {
    const inserted = enqueueBatch(manager, [
      { kind: 'ml-inference', topic: 'speciesnet:4.0.1a', payload: { mediaId: 'm1' } },
      { kind: 'ml-inference', topic: 'speciesnet:4.0.1a', payload: { mediaId: 'm2' } },
      { kind: 'ocr', topic: 'tesseract', payload: { mediaId: 'm3' } }
    ])

    assert.equal(inserted.length, 3)
    assert.equal(inserted[0].kind, 'ml-inference')
    assert.equal(inserted[2].kind, 'ocr')

    // Verify they are in the DB
    const status = getStatus(manager)
    assert.equal(status.pending, 3)
  })

  test('enqueueBatch with empty array is no-op', () => {
    const inserted = enqueueBatch(manager, [])
    assert.equal(inserted.length, 0)

    const status = getStatus(manager)
    assert.equal(status.pending, 0)
  })

  test('enqueue with custom maxAttempts', () => {
    const job = enqueue(manager, {
      kind: 'ocr',
      payload: { mediaId: 'm1' },
      maxAttempts: 5
    })
    assert.equal(job.maxAttempts, 5)
  })

  test('enqueue with null topic', () => {
    const job = enqueue(manager, {
      kind: 'ocr',
      payload: { mediaId: 'm1' }
    })
    assert.equal(job.topic, null)
  })
})

// ---------------------------------------------------------------------------
// claimBatch
// ---------------------------------------------------------------------------

describe('claimBatch', () => {
  test('claims jobs in createdAt order (FIFO)', () => {
    // Insert with distinct timestamps by injecting slight delays via unique payloads
    const j1 = enqueue(manager, { kind: 'ml-inference', payload: { order: 1 } })
    const j2 = enqueue(manager, { kind: 'ml-inference', payload: { order: 2 } })
    enqueue(manager, { kind: 'ml-inference', payload: { order: 3 } })

    const claimed = claimBatch(manager, { kind: 'ml-inference', batchSize: 2 })
    assert.equal(claimed.length, 2)
    assert.equal(claimed[0].id, j1.id)
    assert.equal(claimed[1].id, j2.id)
  })

  test('respects batchSize', () => {
    enqueueBatch(manager, [
      { kind: 'ml-inference', payload: { n: 1 } },
      { kind: 'ml-inference', payload: { n: 2 } },
      { kind: 'ml-inference', payload: { n: 3 } }
    ])

    const claimed = claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })
    assert.equal(claimed.length, 1)
  })

  test('sets status=processing, startedAt, and increments attempts', () => {
    enqueue(manager, { kind: 'ml-inference', payload: {} })
    const [claimed] = claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })

    assert.equal(claimed.status, 'processing')
    assert.ok(claimed.startedAt)
    assert.equal(claimed.attempts, 1)
  })

  test('skips non-pending jobs', () => {
    const job = enqueue(manager, { kind: 'ml-inference', payload: {} })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 }) // now processing
    complete(manager, job.id) // now completed

    enqueue(manager, { kind: 'ml-inference', payload: {} })
    cancel(manager, { kind: 'ml-inference' }) // now cancelled

    // Only pending jobs should be claimable — none left
    const claimed = claimBatch(manager, { kind: 'ml-inference', batchSize: 10 })
    assert.equal(claimed.length, 0)
  })

  test('filters by kind', () => {
    enqueue(manager, { kind: 'ml-inference', payload: {} })
    enqueue(manager, { kind: 'ocr', payload: {} })

    const claimed = claimBatch(manager, { kind: 'ocr', batchSize: 10 })
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0].kind, 'ocr')
  })

  test('filters by kind + topic', () => {
    enqueue(manager, { kind: 'ml-inference', topic: 'speciesnet:4.0.1a', payload: {} })
    enqueue(manager, { kind: 'ml-inference', topic: 'deepfaune:1.2', payload: {} })

    const claimed = claimBatch(manager, {
      kind: 'ml-inference',
      topic: 'deepfaune:1.2',
      batchSize: 10
    })
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0].topic, 'deepfaune:1.2')
  })

  test('returns [] when no matches', () => {
    const claimed = claimBatch(manager, { kind: 'ml-inference', batchSize: 10 })
    assert.deepEqual(claimed, [])
  })

  test('parses JSON payload from raw results', () => {
    enqueue(manager, {
      kind: 'ml-inference',
      payload: { mediaId: 'm1', filePath: '/test.jpg' }
    })
    const [claimed] = claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })
    assert.deepEqual(claimed.payload, { mediaId: 'm1', filePath: '/test.jpg' })
  })
})

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

describe('complete', () => {
  test('sets status=completed and completedAt', () => {
    const job = enqueue(manager, { kind: 'ml-inference', payload: {} })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })
    complete(manager, job.id)

    const [result] = getJobs(manager, { status: 'completed' })
    assert.equal(result.id, job.id)
    assert.equal(result.status, 'completed')
    assert.ok(result.completedAt)
  })
})

// ---------------------------------------------------------------------------
// fail
// ---------------------------------------------------------------------------

describe('fail', () => {
  test('retries: sets back to pending when attempts < maxAttempts', () => {
    const job = enqueue(manager, { kind: 'ml-inference', payload: {}, maxAttempts: 3 })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 }) // attempts = 1
    fail(manager, job.id, 'connection timeout')

    const [result] = getJobs(manager, { kind: 'ml-inference' })
    assert.equal(result.status, 'pending')
    assert.equal(result.error, 'connection timeout')
    assert.equal(result.attempts, 1) // unchanged by fail
  })

  test('gives up: sets to failed when attempts >= maxAttempts', () => {
    const job = enqueue(manager, { kind: 'ml-inference', payload: {}, maxAttempts: 1 })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 }) // attempts = 1
    fail(manager, job.id, 'model crashed')

    const [result] = getJobs(manager, { kind: 'ml-inference' })
    assert.equal(result.status, 'failed')
    assert.equal(result.error, 'model crashed')
    assert.ok(result.completedAt)
  })

  test('stores error message', () => {
    const job = enqueue(manager, { kind: 'ml-inference', payload: {} })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })
    fail(manager, job.id, 'ENOMEM')

    const [result] = getJobs(manager, { kind: 'ml-inference' })
    assert.equal(result.error, 'ENOMEM')
  })

  test('no-op for nonexistent job', () => {
    // Should not throw
    fail(manager, 'nonexistent-id', 'some error')
  })
})

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe('cancel', () => {
  test('cancels single job by id', () => {
    const job = enqueue(manager, { kind: 'ml-inference', payload: {} })
    const count = cancel(manager, { jobId: job.id })

    assert.equal(count, 1)
    const [result] = getJobs(manager, { status: 'cancelled' })
    assert.equal(result.id, job.id)
  })

  test('cancels all pending by kind', () => {
    enqueueBatch(manager, [
      { kind: 'ml-inference', payload: {} },
      { kind: 'ml-inference', payload: {} },
      { kind: 'ocr', payload: {} }
    ])

    const count = cancel(manager, { kind: 'ml-inference' })
    assert.equal(count, 2)

    const status = getStatus(manager)
    assert.equal(status.cancelled, 2)
    assert.equal(status.pending, 1) // ocr still pending
  })

  test('cancels by kind + topic', () => {
    enqueueBatch(manager, [
      { kind: 'ml-inference', topic: 'speciesnet:4.0.1a', payload: {} },
      { kind: 'ml-inference', topic: 'deepfaune:1.2', payload: {} }
    ])

    const count = cancel(manager, { kind: 'ml-inference', topic: 'speciesnet:4.0.1a' })
    assert.equal(count, 1)
  })

  test('does not cancel non-pending jobs', () => {
    const job = enqueue(manager, { kind: 'ml-inference', payload: {} })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 }) // now processing

    const count = cancel(manager, { jobId: job.id })
    assert.equal(count, 0)
  })

  test('throws when no filters provided', () => {
    assert.throws(() => cancel(manager), /at least one of/)
  })
})

// ---------------------------------------------------------------------------
// retryFailed
// ---------------------------------------------------------------------------

describe('retryFailed', () => {
  test('resets failed jobs to pending with attempts=0 and error cleared', () => {
    const job = enqueue(manager, { kind: 'ml-inference', payload: {}, maxAttempts: 1 })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })
    fail(manager, job.id, 'crashed')

    const count = retryFailed(manager, { kind: 'ml-inference' })
    assert.equal(count, 1)

    const [result] = getJobs(manager, { kind: 'ml-inference' })
    assert.equal(result.status, 'pending')
    assert.equal(result.attempts, 0)
    assert.equal(result.error, null)
  })

  test('only affects failed status', () => {
    enqueue(manager, { kind: 'ml-inference', payload: {} }) // pending
    const j2 = enqueue(manager, { kind: 'ml-inference', payload: {}, maxAttempts: 1 })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 }) // claims first one
    // Claim and fail j2
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })
    fail(manager, j2.id, 'error')

    const count = retryFailed(manager, { kind: 'ml-inference' })
    assert.equal(count, 1) // only the failed one
  })

  test('filters by kind and topic', () => {
    const j1 = enqueue(manager, {
      kind: 'ml-inference',
      topic: 'speciesnet:4.0.1a',
      payload: {},
      maxAttempts: 1
    })
    const j2 = enqueue(manager, {
      kind: 'ml-inference',
      topic: 'deepfaune:1.2',
      payload: {},
      maxAttempts: 1
    })

    // Claim and fail both
    claimBatch(manager, { kind: 'ml-inference', batchSize: 10 })
    fail(manager, j1.id, 'err')
    fail(manager, j2.id, 'err')

    const count = retryFailed(manager, { kind: 'ml-inference', topic: 'speciesnet:4.0.1a' })
    assert.equal(count, 1)

    const status = getStatus(manager, { topic: 'deepfaune:1.2' })
    assert.equal(status.failed, 1) // deepfaune still failed
  })
})

// ---------------------------------------------------------------------------
// recoverStale
// ---------------------------------------------------------------------------

describe('recoverStale', () => {
  test('resets processing jobs to pending', () => {
    enqueue(manager, { kind: 'ml-inference', payload: {} })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 }) // now processing

    const count = recoverStale(manager)
    assert.equal(count, 1)

    const status = getStatus(manager)
    assert.equal(status.pending, 1)
    assert.equal(status.processing, 0)
  })

  test('ignores other statuses', () => {
    // completed
    const j1 = enqueue(manager, { kind: 'ml-inference', payload: {} })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })
    complete(manager, j1.id)
    // failed
    const j2 = enqueue(manager, { kind: 'ml-inference', payload: {}, maxAttempts: 1 })
    claimBatch(manager, { kind: 'ml-inference', batchSize: 1 })
    fail(manager, j2.id, 'err')
    // pending (added last so it's not claimed by previous claimBatch calls)
    enqueue(manager, { kind: 'ml-inference', payload: {} })

    const count = recoverStale(manager)
    assert.equal(count, 0)

    const status = getStatus(manager)
    assert.equal(status.pending, 1)
    assert.equal(status.completed, 1)
    assert.equal(status.failed, 1)
  })
})

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  test('returns counts by status', () => {
    enqueueBatch(manager, [
      { kind: 'ml-inference', payload: {} },
      { kind: 'ml-inference', payload: {} },
      { kind: 'ml-inference', payload: {} }
    ])

    const status = getStatus(manager)
    assert.equal(status.pending, 3)
    assert.equal(status.processing, 0)
    assert.equal(status.completed, 0)
    assert.equal(status.failed, 0)
    assert.equal(status.cancelled, 0)
  })

  test('filters by kind and topic', () => {
    enqueueBatch(manager, [
      { kind: 'ml-inference', topic: 'speciesnet:4.0.1a', payload: {} },
      { kind: 'ml-inference', topic: 'deepfaune:1.2', payload: {} },
      { kind: 'ocr', payload: {} }
    ])

    const mlStatus = getStatus(manager, { kind: 'ml-inference' })
    assert.equal(mlStatus.pending, 2)

    const snStatus = getStatus(manager, { kind: 'ml-inference', topic: 'speciesnet:4.0.1a' })
    assert.equal(snStatus.pending, 1)
  })
})

// ---------------------------------------------------------------------------
// getJobs
// ---------------------------------------------------------------------------

describe('getJobs', () => {
  test('returns paginated results', () => {
    enqueueBatch(
      manager,
      Array.from({ length: 5 }, (_, i) => ({ kind: 'ml-inference', payload: { n: i } }))
    )

    const page1 = getJobs(manager, { limit: 2, offset: 0 })
    assert.equal(page1.length, 2)

    const page2 = getJobs(manager, { limit: 2, offset: 2 })
    assert.equal(page2.length, 2)

    const page3 = getJobs(manager, { limit: 2, offset: 4 })
    assert.equal(page3.length, 1)
  })

  test('filters by kind, topic, and status', () => {
    enqueueBatch(manager, [
      { kind: 'ml-inference', topic: 'speciesnet:4.0.1a', payload: {} },
      { kind: 'ml-inference', topic: 'deepfaune:1.2', payload: {} },
      { kind: 'ocr', payload: {} }
    ])

    const mlJobs = getJobs(manager, { kind: 'ml-inference' })
    assert.equal(mlJobs.length, 2)

    const snJobs = getJobs(manager, { topic: 'speciesnet:4.0.1a' })
    assert.equal(snJobs.length, 1)

    // Cancel one and filter by status
    cancel(manager, { kind: 'ocr' })
    const pendingJobs = getJobs(manager, { status: 'pending' })
    assert.equal(pendingJobs.length, 2)
  })
})
