import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

import { getMergeImportFolder, getMergePrefix, prefixRow } from './helpers.js'

const URL_RE = /^https?:\/\//i

function studyDbPath(biowatchDataPath, studyId) {
  return join(biowatchDataPath, 'studies', studyId, 'study.db')
}

// Hardcoded column lists per table, matching src/main/database/models.js.
// We build prepared INSERT statements once per table and reuse for every row,
// so the merge stays flat in memory and fast for million-row studies.
const COLS = {
  deployments: [
    'deploymentID',
    'locationID',
    'locationName',
    'deploymentStart',
    'deploymentEnd',
    'latitude',
    'longitude',
    'cameraModel',
    'cameraID',
    'coordinateUncertainty'
  ],
  media: [
    'mediaID',
    'deploymentID',
    'timestamp',
    'filePath',
    'fileName',
    'importFolder',
    'folderName',
    'fileMediatype',
    'exifData',
    'favorite'
  ],
  model_runs: ['id', 'modelID', 'modelVersion', 'startedAt', 'status', 'importPath', 'options'],
  model_outputs: ['id', 'mediaID', 'runID', 'rawOutput'],
  observations: [
    'observationID',
    'mediaID',
    'deploymentID',
    'eventID',
    'eventStart',
    'eventEnd',
    'scientificName',
    'observationType',
    'commonName',
    'classificationProbability',
    'count',
    'lifeStage',
    'age',
    'sex',
    'behavior',
    'bboxX',
    'bboxY',
    'bboxWidth',
    'bboxHeight',
    'detectionConfidence',
    'modelOutputID',
    'classificationMethod',
    'classifiedBy',
    'classificationTimestamp'
  ]
}

function makeInsert(db, table) {
  const cols = COLS[table]
  const colList = cols.join(', ')
  const placeholders = cols.map((c) => `@${c}`).join(', ')
  return db.prepare(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`)
}

// Normalize a row so its keys match the table's column list. better-sqlite3
// throws on extra keys (`SqliteError: too many parameter values`) and on
// missing keys when using named bindings. Schemas may evolve slightly across
// migrations, so we project to the canonical column list here.
function project(row, table) {
  const out = {}
  for (const c of COLS[table]) {
    out[c] = c in row ? row[c] : null
  }
  return out
}

/**
 * Merge source study `B` into target study `A`. Rows only — no file operations.
 *
 * Streams every row through `iterate()` and uses prepared INSERTs so it scales
 * to multi-million-row studies without blowing up V8's heap.
 */
export function mergeStudy({
  biowatchDataPath,
  targetStudyId,
  sourceStudyId,
  reviewed,
  onProgress
}) {
  if (targetStudyId === sourceStudyId) {
    throw new Error('Cannot self-merge a study with itself')
  }
  const mergeKey = getMergeImportFolder(sourceStudyId)
  const prefix = getMergePrefix(sourceStudyId)

  const aDb = new Database(studyDbPath(biowatchDataPath, targetStudyId))
  const bDb = new Database(studyDbPath(biowatchDataPath, sourceStudyId), { readonly: true })

  // Throttle: emit progress every N rows. The IPC pipe is async but emitting
  // a million events per phase is still wasteful.
  const TICK = 2000
  const notify = (phase, done, total) => {
    if (onProgress) onProgress({ phase, done, total })
  }

  try {
    // Already-merged check.
    const existsMedia = aDb
      .prepare('SELECT 1 FROM media WHERE importFolder = ? LIMIT 1')
      .get(mergeKey)
    const existsDeployment = aDb
      .prepare('SELECT 1 FROM deployments WHERE deploymentID LIKE ? LIMIT 1')
      .get(`${prefix}%`)
    if (existsMedia || existsDeployment) return { success: true, alreadyMerged: true }

    // Counts up-front so the renderer can show a real percentage. These are
    // cheap indexed COUNTs on B — single-digit ms even on multi-million-row
    // studies.
    const counts = {
      media: bDb.prepare('SELECT COUNT(*) AS n FROM media').get().n,
      deployments: bDb.prepare('SELECT COUNT(*) AS n FROM deployments').get().n,
      modelRuns: bDb.prepare('SELECT COUNT(*) AS n FROM model_runs').get().n,
      modelOutputs: bDb.prepare('SELECT COUNT(*) AS n FROM model_outputs').get().n,
      observations: bDb.prepare('SELECT COUNT(*) AS n FROM observations').get().n
    }
    const insertTotal =
      counts.deployments +
      counts.media +
      counts.modelRuns +
      counts.modelOutputs +
      counts.observations

    // Pass 1: stream B's media to count missing local files. We don't filter
    // them out of the merge — broken filePaths are a pre-existing condition
    // of B (e.g., GBIF imports point at /tmp that the importer cleaned up;
    // unmounted external drives). The renderer's "file unavailable" path
    // handles these at view time. We just surface the count so the user
    // knows what to expect.
    notify('scanning', 0, counts.media)
    let missingFileCount = 0
    let scanned = 0
    for (const { filePath } of bDb.prepare('SELECT filePath FROM media').iterate()) {
      if (filePath && !URL_RE.test(filePath) && !existsSync(filePath)) {
        missingFileCount++
      }
      scanned++
      if (scanned % TICK === 0) notify('scanning', scanned, counts.media)
    }
    notify('scanning', scanned, counts.media)

    // Read metadata once — single rows, tiny.
    const aMeta = aDb.prepare('SELECT * FROM metadata').get()
    const bMeta = bDb.prepare('SELECT * FROM metadata').get()

    // Prepare insert statements once on A's DB. Better-sqlite3 reuses them
    // efficiently across millions of `.run()` calls.
    const insertDeployment = makeInsert(aDb, 'deployments')
    const insertMedia = makeInsert(aDb, 'media')
    const insertModelRun = makeInsert(aDb, 'model_runs')
    const insertModelOutput = makeInsert(aDb, 'model_outputs')
    const insertObservation = makeInsert(aDb, 'observations')

    // Pass 2: stream rows from B into A inside a single transaction on A.
    notify('inserting', 0, insertTotal)
    let inserted = 0
    const bump = () => {
      inserted++
      if (inserted % TICK === 0) notify('inserting', inserted, insertTotal)
    }
    const txn = aDb.transaction(() => {
      for (const row of bDb.prepare('SELECT * FROM deployments').iterate()) {
        const out = prefixRow(row, prefix, { pk: 'deploymentID', fks: [] })
        insertDeployment.run(project(out, 'deployments'))
        bump()
      }
      for (const row of bDb.prepare('SELECT * FROM media').iterate()) {
        const out = prefixRow(row, prefix, { pk: 'mediaID', fks: ['deploymentID'] })
        out.importFolder = mergeKey
        insertMedia.run(project(out, 'media'))
        bump()
      }
      for (const row of bDb.prepare('SELECT * FROM model_runs').iterate()) {
        insertModelRun.run(project({ ...row, importPath: mergeKey }, 'model_runs'))
        bump()
      }
      for (const row of bDb.prepare('SELECT * FROM model_outputs').iterate()) {
        insertModelOutput.run(
          project({ ...row, mediaID: `${prefix}${row.mediaID}` }, 'model_outputs')
        )
        bump()
      }
      for (const row of bDb.prepare('SELECT * FROM observations').iterate()) {
        const out = prefixRow(row, prefix, {
          pk: 'observationID',
          fks: ['mediaID', 'deploymentID']
        })
        insertObservation.run(project(out, 'observations'))
        bump()
      }

      const newContribs = mergeContributors(
        safeParseArray(aMeta?.contributors),
        safeParseArray(bMeta?.contributors),
        reviewed.contributorEmails
      )
      const newStart = minISO(aMeta?.startDate, bMeta?.startDate)
      const newEnd = maxISO(aMeta?.endDate, bMeta?.endDate)
      aDb
        .prepare(
          `UPDATE metadata SET description = ?, contributors = ?,
                                startDate = COALESCE(?, startDate),
                                endDate = COALESCE(?, endDate),
                                updatedAt = ?`
        )
        .run(
          reviewed.description ?? '',
          JSON.stringify(newContribs),
          newStart,
          newEnd,
          new Date().toISOString()
        )
    })
    txn()
    notify('inserting', insertTotal, insertTotal)

    return { success: true, missingFileCount }
  } finally {
    aDb.close()
    bDb.close()
  }
}

function safeParseArray(v) {
  if (!v) return []
  if (Array.isArray(v)) return v
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mergeContributors(aList, bList, keepEmails) {
  const byEmail = new Map()
  for (const c of [...aList, ...bList]) {
    const key = (c.email || '').toLowerCase()
    if (key && !byEmail.has(key)) byEmail.set(key, c)
  }
  // `keepEmails == null` means "no filter, keep the full union". An empty
  // array is explicit user intent ("drop everyone") and must be honored.
  if (keepEmails == null) return [...byEmail.values()]
  const keep = new Set(keepEmails.map((e) => e.toLowerCase()))
  return [...byEmail.values()].filter((c) => keep.has((c.email || '').toLowerCase()))
}

function minISO(a, b) {
  if (!a) return b ?? null
  if (!b) return a
  return a < b ? a : b
}

function maxISO(a, b) {
  if (!a) return b ?? null
  if (!b) return a
  return a > b ? a : b
}
