import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { createImageDirectoryDatabase } from '../../../src/main/database/index.js'
import { enqueue, enqueueBatch, complete, getStatus } from '../../../src/main/services/queue.js'
import { QueueConsumer } from '../../../src/main/services/queue-consumer.js'

let testBiowatchDataPath
let testDbPath
let testStudyId
let manager

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment
  }

  testStudyId = `test-consumer-${Date.now()}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-consumer-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
  manager = await createImageDirectoryDatabase(testDbPath)
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

// Simple test consumer that tracks calls
class TestConsumer extends QueueConsumer {
  constructor(manager, opts = {}) {
    super(manager, { kind: 'test', ...opts })
    this.processedBatches = []
    this.setupCalled = false
    this.teardownCalled = false
  }

  async setup() {
    this.setupCalled = true
  }

  async processBatch(jobs) {
    this.processedBatches.push(jobs)
    // Auto-complete each job
    for (const job of jobs) {
      complete(this.manager, job.id)
    }
  }

  async teardown() {
    this.teardownCalled = true
  }
}

describe('QueueConsumer', () => {
  test('drains queue and stops', async () => {
    enqueueBatch(manager, [
      { kind: 'test', payload: { n: 1 } },
      { kind: 'test', payload: { n: 2 } },
      { kind: 'test', payload: { n: 3 } }
    ])

    const consumer = new TestConsumer(manager, { batchSize: 2 })
    await consumer.start()

    assert.ok(consumer.setupCalled)
    assert.ok(consumer.teardownCalled)
    assert.equal(consumer.processedBatches.length, 2) // batch of 2, then batch of 1
    assert.equal(consumer.processedBatches[0].length, 2)
    assert.equal(consumer.processedBatches[1].length, 1)
    assert.equal(consumer.isRunning, false)

    const status = getStatus(manager, { kind: 'test' })
    assert.equal(status.completed, 3)
    assert.equal(status.pending, 0)
  })

  test('stops when no jobs exist', async () => {
    const consumer = new TestConsumer(manager)
    await consumer.start()

    assert.ok(consumer.setupCalled)
    assert.ok(consumer.teardownCalled)
    assert.equal(consumer.processedBatches.length, 0)
    assert.equal(consumer.isRunning, false)
  })

  test('stop() breaks the loop', async () => {
    enqueueBatch(manager, [
      { kind: 'test', payload: { n: 1 } },
      { kind: 'test', payload: { n: 2 } },
      { kind: 'test', payload: { n: 3 } }
    ])

    const consumer = new TestConsumer(manager, { batchSize: 1 })

    // Override processBatch to stop after first batch
    let batchCount = 0
    consumer.processBatch = async (jobs) => {
      batchCount++
      for (const job of jobs) {
        complete(manager, job.id)
      }
      if (batchCount >= 1) {
        consumer.stop()
      }
    }

    await consumer.start()

    assert.equal(batchCount, 1)
    assert.equal(consumer.isRunning, false)
    assert.ok(consumer.teardownCalled)

    // Some jobs should still be pending
    const status = getStatus(manager, { kind: 'test' })
    assert.equal(status.completed, 1)
    assert.equal(status.pending, 2)
  })

  test('pause/resume works', async () => {
    enqueueBatch(manager, [
      { kind: 'test', payload: { n: 1 } },
      { kind: 'test', payload: { n: 2 } }
    ])

    const consumer = new TestConsumer(manager, { batchSize: 1, pollIntervalMs: 10 })

    let batchCount = 0
    const originalProcessBatch = consumer.processBatch.bind(consumer)
    consumer.processBatch = async (jobs) => {
      batchCount++
      await originalProcessBatch(jobs)
      if (batchCount === 1) {
        // Pause after first batch, then resume after a short delay
        consumer.pause()
        assert.ok(consumer.isPaused)
        setTimeout(() => consumer.resume(), 50)
      }
    }

    await consumer.start()

    assert.equal(batchCount, 2) // Both processed after resume
    assert.equal(consumer.isPaused, false)

    const status = getStatus(manager, { kind: 'test' })
    assert.equal(status.completed, 2)
  })

  test('filters by topic', async () => {
    enqueueBatch(manager, [
      { kind: 'test', topic: 'alpha', payload: {} },
      { kind: 'test', topic: 'beta', payload: {} }
    ])

    const consumer = new TestConsumer(manager, { topic: 'alpha' })
    await consumer.start()

    assert.equal(consumer.processedBatches.length, 1)
    assert.equal(consumer.processedBatches[0].length, 1)
    assert.equal(consumer.processedBatches[0][0].topic, 'alpha')

    const status = getStatus(manager, { kind: 'test' })
    assert.equal(status.completed, 1)
    assert.equal(status.pending, 1) // beta still pending
  })

  test('processBatch errors are propagated', async () => {
    enqueue(manager, { kind: 'test', payload: {} })

    class FailingConsumer extends QueueConsumer {
      constructor(manager) {
        super(manager, { kind: 'test' })
        this.teardownCalled = false
      }
      async processBatch() {
        throw new Error('batch failed')
      }
      async teardown() {
        this.teardownCalled = true
      }
    }

    const consumer = new FailingConsumer(manager)
    await assert.rejects(() => consumer.start(), { message: 'batch failed' })
    assert.ok(consumer.teardownCalled) // teardown still called
  })
})
