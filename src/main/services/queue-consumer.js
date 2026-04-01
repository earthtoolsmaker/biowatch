/**
 * Base class for queue consumers.
 *
 * Polls the jobs table, claims batches, and delegates processing to subclasses.
 * Subclasses override setup(), processBatch(), and teardown().
 */

import { claimBatch } from './queue.js'
import log from './logger.js'

export class QueueConsumer {
  /**
   * @param {import('../database/manager.js').StudyDatabaseManager} manager
   * @param {Object} opts
   * @param {string} opts.kind - Job kind to consume
   * @param {string} [opts.topic] - Optional topic filter
   * @param {number} [opts.batchSize=5]
   * @param {number} [opts.pollIntervalMs=500]
   */
  constructor(manager, { kind, topic = undefined, batchSize = 5, pollIntervalMs = 500 }) {
    this.manager = manager
    this.kind = kind
    this.topic = topic
    this.batchSize = batchSize
    this.pollIntervalMs = pollIntervalMs
    this._paused = false
    this._running = false
    this._stopped = false
    this._lastBatchDuration = null // seconds
    this._lastBatchSize = null
  }

  /**
   * Called once before the poll loop starts.
   * Subclasses can override to initialize resources (e.g. start a server).
   */
  async setup() {}

  /**
   * Process a batch of claimed jobs.
   * Subclasses MUST call complete()/fail() per job themselves.
   * @param {Array<Object>} jobs - Claimed jobs from claimBatch
   */
  // eslint-disable-next-line no-unused-vars
  async processBatch(jobs) {
    throw new Error('processBatch must be implemented by subclass')
  }

  /**
   * Called once after the poll loop ends (whether drained, stopped, or errored).
   * Subclasses can override to clean up resources.
   */
  async teardown() {}

  /**
   * Start the consumer poll loop.
   * Runs until the queue is drained or stop() is called.
   */
  async start() {
    if (this._running) return
    this._running = true
    this._stopped = false
    log.info(`[QueueConsumer] Starting kind=${this.kind} topic=${this.topic}`)

    try {
      await this.setup()

      while (!this._stopped) {
        if (this._paused) {
          await this._sleep(this.pollIntervalMs)
          continue
        }

        const jobs = claimBatch(this.manager, {
          kind: this.kind,
          topic: this.topic,
          batchSize: this.batchSize
        })

        if (jobs.length === 0) {
          log.info(`[QueueConsumer] Queue drained for kind=${this.kind} topic=${this.topic}`)
          break
        }

        const batchStart = Date.now()
        await this.processBatch(jobs)
        this._lastBatchDuration = (Date.now() - batchStart) / 1000
        this._lastBatchSize = jobs.length
      }
    } finally {
      await this.teardown()
      this._running = false
      log.info(`[QueueConsumer] Stopped kind=${this.kind} topic=${this.topic}`)
    }
  }

  pause() {
    this._paused = true
    log.info(`[QueueConsumer] Paused kind=${this.kind} topic=${this.topic}`)
  }

  resume() {
    this._paused = false
    log.info(`[QueueConsumer] Resumed kind=${this.kind} topic=${this.topic}`)
  }

  stop() {
    this._stopped = true
    log.info(`[QueueConsumer] Stop requested kind=${this.kind} topic=${this.topic}`)
  }

  get isRunning() {
    return this._running
  }

  get isPaused() {
    return this._paused
  }

  get batchMetrics() {
    return {
      lastBatchDuration: this._lastBatchDuration,
      lastBatchSize: this._lastBatchSize
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
