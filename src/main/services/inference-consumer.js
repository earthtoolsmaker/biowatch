/**
 * ML inference consumer.
 *
 * Extends QueueConsumer to process ml-inference jobs by streaming
 * predictions from an ML HTTP server and inserting observations.
 */

import crypto from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { QueueConsumer } from './queue-consumer.js'
import { complete, fail } from './queue.js'
import { serverManager } from './server-manager.js'
import {
  getPredictions,
  getMedia,
  insertPrediction,
  insertVideoPredictions,
  aggregateDeploymentMetadata
} from './prediction.js'
import { insertModelOutput, updateMetadata, getMetadata } from '../database/index.js'
import { modelRuns, media, deployments } from '../database/models.js'
import log from './logger.js'

export class InferenceConsumer extends QueueConsumer {
  /**
   * @param {import('../database/manager.js').StudyDatabaseManager} manager
   * @param {Object} opts
   * @param {string} opts.topic - e.g. 'speciesnet:4.0.1a'
   * @param {string|null} [opts.country] - Country code for geofencing
   * @param {string} opts.studyId
   * @param {number} [opts.batchSize=5]
   */
  constructor(manager, { topic, country = null, studyId, importPath = null, batchSize = 5 }) {
    super(manager, { kind: 'ml-inference', topic, batchSize })
    this.country = country
    this.studyId = studyId
    this.importPath = importPath
    this.runID = null
    this.port = null
    this.model = null
    this.abortController = null
  }

  async setup() {
    // Start (or reuse) ML server for this topic
    const { port, model } = await serverManager.ensureServer(this.topic, this.country)
    this.port = port
    this.model = model
    this.abortController = new AbortController()

    // Create model run record
    const [modelId, modelVersion] = this.topic.split(':')
    this.runID = crypto.randomUUID()
    const db = this.manager.getDb()
    await db
      .insert(modelRuns)
      .values({
        id: this.runID,
        modelID: modelId,
        modelVersion: modelVersion,
        startedAt: new Date().toISOString(),
        status: 'running',
        importPath: this.importPath,
        options: this.country ? { country: this.country } : null
      })
      .run()

    log.info(`[InferenceConsumer] Setup complete. runID=${this.runID} port=${this.port}`)
  }

  async processBatch(jobs) {
    const db = this.manager.getDb()
    const [modelId, modelVersion] = this.topic.split(':')

    // Map filepath -> job for per-job completion tracking
    const jobByPath = new Map(jobs.map((j) => [j.payload.filePath, j]))
    const completedPaths = new Set()

    // Create a batch-scoped abort controller linked to the main one
    const batchAbort = new AbortController()
    const abortHandler = () => batchAbort.abort()
    if (this.abortController) {
      this.abortController.signal.addEventListener('abort', abortHandler)
    }

    try {
      const filePaths = jobs.map((j) => j.payload.filePath)
      const videoPredictionsMap = new Map() // filepath -> predictions[]

      for await (const prediction of getPredictions(filePaths, this.port, batchAbort.signal)) {
        const isVideoFrame = prediction.frame_number !== undefined

        if (isVideoFrame) {
          // Collect video frame predictions
          if (!videoPredictionsMap.has(prediction.filepath)) {
            videoPredictionsMap.set(prediction.filepath, [])
          }
          videoPredictionsMap.get(prediction.filepath).push(prediction)
        } else {
          // Process image prediction immediately
          const mediaRecord = await getMedia(db, prediction.filepath)
          if (!mediaRecord) {
            log.warn(`[InferenceConsumer] No media found for: ${prediction.filepath}`)
            const job = jobByPath.get(prediction.filepath)
            if (job) {
              fail(this.manager, job.id, `No media record found for ${prediction.filepath}`)
              completedPaths.add(prediction.filepath)
            }
            continue
          }

          const modelOutputID = crypto.randomUUID()
          const modelOutput = await insertModelOutput(db, {
            id: modelOutputID,
            mediaID: mediaRecord.mediaID,
            runID: this.runID,
            rawOutput: prediction
          })

          if (!modelOutput) {
            log.info(
              `[InferenceConsumer] Model output already exists for media ${mediaRecord.mediaID}, skipping`
            )
            const job = jobByPath.get(prediction.filepath)
            if (job) {
              complete(this.manager, job.id)
              completedPaths.add(prediction.filepath)
            }
            continue
          }

          await insertPrediction(db, prediction, {
            modelOutputID,
            modelID: modelId,
            modelVersion: modelVersion,
            detectionConfidenceThreshold: this.model.detectionConfidenceThreshold
          })

          const job = jobByPath.get(prediction.filepath)
          if (job) {
            complete(this.manager, job.id)
            completedPaths.add(prediction.filepath)
          }
        }
      }

      // Process collected video predictions
      for (const [filepath, predictions] of videoPredictionsMap) {
        const mediaRecord = await getMedia(db, filepath)
        if (!mediaRecord) {
          log.warn(`[InferenceConsumer] No media found for video: ${filepath}`)
          const job = jobByPath.get(filepath)
          if (job) {
            fail(this.manager, job.id, `No media record found for ${filepath}`)
            completedPaths.add(filepath)
          }
          continue
        }

        await insertVideoPredictions(db, predictions, mediaRecord, {
          runID: this.runID,
          modelID: modelId,
          modelVersion: modelVersion,
          detectionConfidenceThreshold: this.model.detectionConfidenceThreshold
        })

        const job = jobByPath.get(filepath)
        if (job) {
          complete(this.manager, job.id)
          completedPaths.add(filepath)
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        log.info('[InferenceConsumer] Batch aborted')
      } else {
        log.error('[InferenceConsumer] Batch error:', error)
      }

      // Fail all uncompleted jobs in this batch
      for (const job of jobs) {
        if (!completedPaths.has(job.payload.filePath)) {
          fail(this.manager, job.id, error.message || 'Batch processing error')
        }
      }
    } finally {
      if (this.abortController) {
        this.abortController.signal.removeEventListener('abort', abortHandler)
      }
    }
  }

  async teardown() {
    const db = this.manager.getDb()

    // Update model run status
    if (this.runID) {
      const status = this._stopped ? 'aborted' : 'completed'
      await db.update(modelRuns).set({ status }).where(eq(modelRuns.id, this.runID)).run()
      log.info(`[InferenceConsumer] Model run ${this.runID} → ${status}`)
    }

    // Post-processing (only on successful completion, not abort)
    if (!this._stopped) {
      await this._autoPopulateTemporalDates(db)
      await this._aggregateDeploymentMetadata(db)
    }

    // Clean up abort controller
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  stop() {
    super.stop()
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  /**
   * Auto-populate study temporal dates from media timestamps.
   * Extracted from Importer._processMediaInBackground (lines 1143-1188).
   */
  async _autoPopulateTemporalDates(db) {
    try {
      log.info(`[InferenceConsumer] Auto-populating temporal dates for study ${this.studyId}`)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const dateRange = await db
        .select({
          minDate:
            sql`MIN(CASE WHEN ${media.timestamp} < ${oneDayAgo} THEN ${media.timestamp} ELSE NULL END)`.as(
              'minDate'
            ),
          maxDate:
            sql`MAX(CASE WHEN ${media.timestamp} < ${oneDayAgo} THEN ${media.timestamp} ELSE NULL END)`.as(
              'maxDate'
            )
        })
        .from(media)
        .get()

      if (dateRange && dateRange.minDate && dateRange.maxDate) {
        const currentMetadata = await getMetadata(db)
        const updates = {}
        if (!currentMetadata?.startDate) {
          updates.startDate = dateRange.minDate.split('T')[0]
        }
        if (!currentMetadata?.endDate) {
          updates.endDate = dateRange.maxDate.split('T')[0]
        }
        if (Object.keys(updates).length > 0) {
          await updateMetadata(db, this.studyId, updates)
          log.info(`[InferenceConsumer] Updated temporal dates for study ${this.studyId}`)
        }
      }
    } catch (error) {
      log.warn(`[InferenceConsumer] Could not auto-populate temporal dates: ${error.message}`)
    }
  }

  /**
   * Aggregate deployment EXIF metadata.
   * Extracted from Importer._processMediaInBackground (lines 1190-1203).
   */
  async _aggregateDeploymentMetadata(db) {
    try {
      log.info(`[InferenceConsumer] Aggregating deployment EXIF metadata for study ${this.studyId}`)
      const allDeployments = await db
        .select({ deploymentID: deployments.deploymentID })
        .from(deployments)

      for (const { deploymentID } of allDeployments) {
        await aggregateDeploymentMetadata(db, deploymentID)
      }
      log.info(
        `[InferenceConsumer] Completed EXIF metadata aggregation for ${allDeployments.length} deployments`
      )
    } catch (error) {
      log.warn(`[InferenceConsumer] Could not aggregate deployment EXIF metadata: ${error.message}`)
    }
  }
}
