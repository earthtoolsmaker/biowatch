import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

import { getMergeImportFolder, getMergePrefix, prefixRow } from './helpers.js'

const URL_RE = /^https?:\/\//i

function studyDbPath(biowatchDataPath, studyId) {
  return join(biowatchDataPath, 'studies', studyId, 'study.db')
}

/**
 * Merge source study `B` into target study `A`. Rows only — no file operations.
 *
 * @param {object} args
 * @param {string} args.biowatchDataPath
 * @param {string} args.targetStudyId
 * @param {string} args.sourceStudyId
 * @param {{ description: string, contributorEmails: string[] }} args.reviewed
 */
export function mergeStudy({ biowatchDataPath, targetStudyId, sourceStudyId, reviewed }) {
  if (targetStudyId === sourceStudyId) {
    throw new Error('Cannot self-merge a study with itself')
  }
  const mergeKey = getMergeImportFolder(sourceStudyId)
  const prefix = getMergePrefix(sourceStudyId)

  const aDb = new Database(studyDbPath(biowatchDataPath, targetStudyId))
  const bDb = new Database(studyDbPath(biowatchDataPath, sourceStudyId), { readonly: true })

  try {
    const existsMedia = aDb
      .prepare('SELECT 1 FROM media WHERE importFolder = ? LIMIT 1')
      .get(mergeKey)
    const existsDeployment = aDb
      .prepare('SELECT 1 FROM deployments WHERE deploymentID LIKE ? LIMIT 1')
      .get(`${prefix}%`)
    if (existsMedia || existsDeployment) return { success: true, alreadyMerged: true }

    const missingMediaIDs = new Set()
    for (const { mediaID, filePath } of bDb.prepare('SELECT mediaID, filePath FROM media').all()) {
      if (!filePath || URL_RE.test(filePath)) continue
      if (!existsSync(filePath)) missingMediaIDs.add(mediaID)
    }

    const bDeployments = bDb.prepare('SELECT * FROM deployments').all()
    const bMedia = bDb.prepare('SELECT * FROM media').all()
    const bModelRuns = bDb.prepare('SELECT * FROM model_runs').all()
    const bModelOutputs = bDb.prepare('SELECT * FROM model_outputs').all()
    const bObservations = bDb.prepare('SELECT * FROM observations').all()
    const bMeta = bDb.prepare('SELECT * FROM metadata').get()
    const aMeta = aDb.prepare('SELECT * FROM metadata').get()

    const txn = aDb.transaction(() => {
      for (const d of bDeployments) {
        insertRow(aDb, 'deployments', prefixRow(d, prefix, { pk: 'deploymentID', fks: [] }))
      }
      for (const m of bMedia) {
        if (missingMediaIDs.has(m.mediaID)) continue
        const row = prefixRow(m, prefix, { pk: 'mediaID', fks: ['deploymentID'] })
        row.importFolder = mergeKey
        insertRow(aDb, 'media', row)
      }
      for (const r of bModelRuns) {
        insertRow(aDb, 'model_runs', { ...r, importPath: mergeKey })
      }
      // model_outputs: id is a UUID (no prefix); only rewrite the mediaID FK.
      for (const o of bModelOutputs) {
        if (missingMediaIDs.has(o.mediaID)) continue
        insertRow(aDb, 'model_outputs', { ...o, mediaID: `${prefix}${o.mediaID}` })
      }
      for (const obs of bObservations) {
        if (missingMediaIDs.has(obs.mediaID)) continue
        const row = prefixRow(obs, prefix, {
          pk: 'observationID',
          fks: ['mediaID', 'deploymentID']
        })
        insertRow(aDb, 'observations', row)
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

    return { success: true, missingFileCount: missingMediaIDs.size }
  } finally {
    aDb.close()
    bDb.close()
  }
}

function insertRow(db, table, row) {
  const cols = Object.keys(row)
  const placeholders = cols.map(() => '?').join(', ')
  const values = cols.map((c) => row[c])
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values)
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
  if (!keepEmails || keepEmails.length === 0) return [...byEmail.values()]
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
