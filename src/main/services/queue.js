/**
 * SQLite-backed persistent job queue service.
 *
 * Pure functions operating on a StudyDatabaseManager.
 * Used for ML inference, OCR, and other async work.
 */

import crypto from 'crypto'
import { eq, and, desc } from 'drizzle-orm'
import { jobs } from '../database/models.js'
import log from './logger.js'

/**
 * Enqueue a single job.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {Object} opts
 * @param {string} opts.kind - Job category ('ml-inference', 'ocr', etc.)
 * @param {string} [opts.topic] - Sub-grouping ('speciesnet:4.0.1a', etc.)
 * @param {Object} opts.payload - Job-specific data
 * @param {number} [opts.maxAttempts=3]
 * @returns {Object} The inserted job
 */
export function enqueue(manager, { kind, topic = null, payload, maxAttempts = 3 }) {
  const db = manager.getDb()
  const row = {
    id: crypto.randomUUID(),
    kind,
    topic,
    status: 'pending',
    payload,
    attempts: 0,
    maxAttempts,
    createdAt: new Date().toISOString()
  }
  const result = db.insert(jobs).values(row).returning().get()
  log.info(`[Queue] Enqueued job ${result.id} kind=${kind} topic=${topic}`)
  return result
}

/**
 * Enqueue multiple jobs in a single transaction.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {Array<{kind: string, topic?: string, payload: Object, maxAttempts?: number}>} jobsArray
 * @returns {Array<Object>} The inserted jobs
 */
export function enqueueBatch(manager, jobsArray) {
  if (jobsArray.length === 0) return []

  const sqlite = manager.getSqlite()
  const now = new Date().toISOString()

  const stmt = sqlite.prepare(`
    INSERT INTO jobs (id, kind, topic, status, payload, attempts, maxAttempts, createdAt)
    VALUES (?, ?, ?, 'pending', ?, 0, ?, ?)
  `)

  const inserted = []
  sqlite.transaction(() => {
    for (const job of jobsArray) {
      const id = crypto.randomUUID()
      stmt.run(
        id,
        job.kind,
        job.topic ?? null,
        JSON.stringify(job.payload),
        job.maxAttempts ?? 3,
        now
      )
      inserted.push({
        id,
        kind: job.kind,
        topic: job.topic ?? null,
        status: 'pending',
        payload: job.payload,
        error: null,
        attempts: 0,
        maxAttempts: job.maxAttempts ?? 3,
        createdAt: now,
        startedAt: null,
        completedAt: null
      })
    }
  })()

  log.info(`[Queue] Enqueued batch of ${inserted.length} jobs`)
  return inserted
}

/**
 * Atomically claim a batch of pending jobs for processing.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {Object} opts
 * @param {string} opts.kind
 * @param {string} [opts.topic]
 * @param {number} [opts.batchSize=10]
 * @returns {Array<Object>} The claimed jobs
 */
export function claimBatch(manager, { kind, topic = undefined, batchSize = 10 }) {
  const sqlite = manager.getSqlite()
  const now = new Date().toISOString()

  let query
  let params

  if (topic !== undefined) {
    query = `
      UPDATE jobs
      SET status = 'processing',
          startedAt = ?,
          attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
        WHERE status = 'pending' AND kind = ? AND topic = ?
        ORDER BY createdAt ASC
        LIMIT ?
      )
      RETURNING *
    `
    params = [now, kind, topic, batchSize]
  } else {
    query = `
      UPDATE jobs
      SET status = 'processing',
          startedAt = ?,
          attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
        WHERE status = 'pending' AND kind = ?
        ORDER BY createdAt ASC
        LIMIT ?
      )
      RETURNING *
    `
    params = [now, kind, batchSize]
  }

  const rows = sqlite.prepare(query).all(...params)

  // Parse JSON payload from raw results
  return rows.map((row) => ({
    ...row,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
  }))
}

/**
 * Mark a job as completed.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {string} jobId
 */
export function complete(manager, jobId) {
  const db = manager.getDb()
  db.update(jobs)
    .set({
      status: 'completed',
      completedAt: new Date().toISOString()
    })
    .where(eq(jobs.id, jobId))
    .run()
}

/**
 * Mark a job as failed. If attempts < maxAttempts, requeue as pending for retry.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {string} jobId
 * @param {string} errorMessage
 */
export function fail(manager, jobId, errorMessage) {
  const sqlite = manager.getSqlite()

  sqlite.transaction(() => {
    const row = sqlite.prepare('SELECT attempts, maxAttempts FROM jobs WHERE id = ?').get(jobId)
    if (!row) {
      log.warn(`[Queue] fail: job ${jobId} not found`)
      return
    }

    if (row.attempts < row.maxAttempts) {
      // Requeue for retry
      sqlite
        .prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?')
        .run('pending', errorMessage, jobId)
    } else {
      // Exhausted retries
      sqlite
        .prepare('UPDATE jobs SET status = ?, error = ?, completedAt = ? WHERE id = ?')
        .run('failed', errorMessage, new Date().toISOString(), jobId)
    }
  })()
}

/**
 * Get job counts grouped by status.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {Object} [opts]
 * @param {string} [opts.kind]
 * @param {string} [opts.topic]
 * @returns {{ pending: number, processing: number, completed: number, failed: number, cancelled: number }}
 */
export function getStatus(manager, { kind, topic } = {}) {
  const sqlite = manager.getSqlite()

  let query = 'SELECT status, COUNT(*) as count FROM jobs'
  const conditions = []
  const params = []

  if (kind !== undefined) {
    conditions.push('kind = ?')
    params.push(kind)
  }
  if (topic !== undefined) {
    conditions.push('topic = ?')
    params.push(topic)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' GROUP BY status'

  const rows = sqlite.prepare(query).all(...params)

  const result = { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 }
  for (const row of rows) {
    if (row.status in result) {
      result[row.status] = row.count
    }
  }
  return result
}

/**
 * Get jobs with optional filters and pagination.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {Object} [opts]
 * @param {string} [opts.kind]
 * @param {string} [opts.topic]
 * @param {string} [opts.status]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Array<Object>}
 */
export function getJobs(manager, { kind, topic, status, limit = 50, offset = 0 } = {}) {
  const db = manager.getDb()

  const conditions = []
  if (kind !== undefined) conditions.push(eq(jobs.kind, kind))
  if (topic !== undefined) conditions.push(eq(jobs.topic, topic))
  if (status !== undefined) conditions.push(eq(jobs.status, status))

  let query = db.select().from(jobs)
  if (conditions.length > 0) {
    query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions))
  }

  return query.orderBy(desc(jobs.createdAt)).limit(limit).offset(offset).all()
}

/**
 * Cancel pending jobs matching the given filters.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {Object} opts - At least one of jobId, kind, or topic required
 * @param {string} [opts.jobId]
 * @param {string} [opts.kind]
 * @param {string} [opts.topic]
 * @returns {number} Number of cancelled jobs
 */
export function cancel(manager, { jobId, kind, topic } = {}) {
  if (!jobId && !kind && !topic) {
    throw new Error('[Queue] cancel requires at least one of: jobId, kind, topic')
  }

  const sqlite = manager.getSqlite()

  const conditions = ["status = 'pending'"]
  const params = []

  if (jobId !== undefined) {
    conditions.push('id = ?')
    params.push(jobId)
  }
  if (kind !== undefined) {
    conditions.push('kind = ?')
    params.push(kind)
  }
  if (topic !== undefined) {
    conditions.push('topic = ?')
    params.push(topic)
  }

  const query = `UPDATE jobs SET status = 'cancelled' WHERE ${conditions.join(' AND ')}`
  const result = sqlite.prepare(query).run(...params)
  log.info(`[Queue] Cancelled ${result.changes} jobs`)
  return result.changes
}

/**
 * Retry all failed jobs matching the given filters.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @param {Object} [opts]
 * @param {string} [opts.kind]
 * @param {string} [opts.topic]
 * @returns {number} Number of retried jobs
 */
export function retryFailed(manager, { kind, topic } = {}) {
  const sqlite = manager.getSqlite()

  const conditions = ["status = 'failed'"]
  const params = []

  if (kind !== undefined) {
    conditions.push('kind = ?')
    params.push(kind)
  }
  if (topic !== undefined) {
    conditions.push('topic = ?')
    params.push(topic)
  }

  const query = `UPDATE jobs SET status = 'pending', attempts = 0, error = NULL WHERE ${conditions.join(' AND ')}`
  const result = sqlite.prepare(query).run(...params)
  log.info(`[Queue] Retried ${result.changes} failed jobs`)
  return result.changes
}

/**
 * Recover stale processing jobs after a crash.
 * Resets all processing jobs back to pending.
 * @param {import('../database/manager.js').StudyDatabaseManager} manager
 * @returns {number} Number of recovered jobs
 */
export function recoverStale(manager) {
  const sqlite = manager.getSqlite()
  const result = sqlite
    .prepare("UPDATE jobs SET status = 'pending' WHERE status = 'processing'")
    .run()
  if (result.changes > 0) {
    log.info(`[Queue] Recovered ${result.changes} stale processing jobs`)
  }
  return result.changes
}
