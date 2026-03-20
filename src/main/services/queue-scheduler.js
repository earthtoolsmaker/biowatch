/**
 * Queue scheduler singleton.
 *
 * Ties consumers to the active study, handles pause/resume/study-switching,
 * and provides status for the renderer.
 */

import path from 'path'
import { app } from 'electron'
import { InferenceConsumer } from './inference-consumer.js'
import { serverManager } from './server-manager.js'
import { recoverStale, getStatus } from './queue.js'
import { getStudyDatabase } from '../database/manager.js'
import log from './logger.js'

class QueueScheduler {
  constructor() {
    this._consumer = null
    this._activeStudyId = null
  }

  /**
   * Start processing jobs for a study.
   * If another study is active, stops it first.
   * @param {string} studyId
   * @param {Object} opts
   * @param {string} opts.topic - e.g. 'speciesnet:4.0.1a'
   * @param {string|null} [opts.country]
   */
  async startStudy(studyId, { topic, country = null }) {
    if (this._activeStudyId && this._activeStudyId !== studyId) {
      await this.stopStudy()
    }

    const dbPath = path.join(
      app.getPath('userData'),
      'biowatch-data',
      'studies',
      studyId,
      'study.db'
    )
    const manager = await getStudyDatabase(studyId, dbPath)

    // Recover any stale processing jobs from a previous crash
    const recovered = recoverStale(manager)
    if (recovered > 0) {
      log.info(`[QueueScheduler] Recovered ${recovered} stale jobs for study ${studyId}`)
    }

    this._consumer = new InferenceConsumer(manager, {
      topic,
      country,
      studyId,
      batchSize: 5
    })
    this._activeStudyId = studyId

    log.info(`[QueueScheduler] Starting processing for study ${studyId} topic=${topic}`)

    // Start in background (fire-and-forget)
    this._consumer.start().catch((err) => {
      log.error(`[QueueScheduler] Consumer error for study ${studyId}:`, err)
    })
  }

  /**
   * Stop processing and shut down the ML server.
   */
  async stopStudy() {
    if (this._consumer) {
      this._consumer.stop()
      // Wait briefly for in-flight batch to finish
      this._consumer = null
    }
    await serverManager.stop()
    this._activeStudyId = null
    log.info('[QueueScheduler] Stopped')
  }

  pause() {
    if (this._consumer) {
      this._consumer.pause()
    }
  }

  resume() {
    if (this._consumer) {
      this._consumer.resume()
    }
  }

  get isRunning() {
    return this._consumer?.isRunning === true && this._consumer?.isPaused === false
  }

  get isPaused() {
    return this._consumer?.isPaused === true
  }

  get activeStudyId() {
    return this._activeStudyId
  }

  /**
   * Get status for a study, compatible with the old importer:get-status shape.
   * @param {string} studyId
   * @returns {Promise<{total: number, done: number, isRunning: boolean, estimatedMinutesRemaining: number|null, speed: number|null}>}
   */
  async getStatusForStudy(studyId) {
    const dbPath = path.join(
      app.getPath('userData'),
      'biowatch-data',
      'studies',
      studyId,
      'study.db'
    )

    try {
      const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
      const status = getStatus(manager, { kind: 'ml-inference' })
      const total = status.pending + status.processing + status.completed + status.failed
      const done = status.completed
      const isRunning = this._activeStudyId === studyId && this.isRunning

      return {
        total,
        done,
        isRunning,
        estimatedMinutesRemaining: null, // TODO: compute from batch timing
        speed: null // TODO: compute from batch timing
      }
    } catch (error) {
      log.error(`[QueueScheduler] Error getting status for study ${studyId}:`, error)
      return {
        total: 0,
        done: 0,
        isRunning: false,
        estimatedMinutesRemaining: null,
        speed: null
      }
    }
  }
}

export const queueScheduler = new QueueScheduler()
