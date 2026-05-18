import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

import { getMergeImportFolder, getMergePrefix } from './helpers.js'

const URL_RE = /^https?:\/\//i

function studyDbPath(biowatchDataPath, studyId) {
  return join(biowatchDataPath, 'studies', studyId, 'study.db')
}

/**
 * Pure read-only pre-flight for `mergeStudy`.
 *
 * @param {object} args
 * @param {string} args.biowatchDataPath
 * @param {string} args.targetStudyId
 * @param {string} args.sourceStudyId
 */
export function mergePreflight({ biowatchDataPath, targetStudyId, sourceStudyId }) {
  const aDb = new Database(studyDbPath(biowatchDataPath, targetStudyId), { readonly: true })
  const bDb = new Database(studyDbPath(biowatchDataPath, sourceStudyId), { readonly: true })
  try {
    const mergeKey = getMergeImportFolder(sourceStudyId)
    const prefix = getMergePrefix(sourceStudyId)
    const alreadyMergedMedia = !!aDb
      .prepare('SELECT 1 FROM media WHERE importFolder = ? LIMIT 1')
      .get(mergeKey)
    const alreadyMergedDeployment = !!aDb
      .prepare('SELECT 1 FROM deployments WHERE deploymentID LIKE ? LIMIT 1')
      .get(`${prefix}%`)
    const alreadyMerged = alreadyMergedMedia || alreadyMergedDeployment

    const deploymentCount = bDb.prepare('SELECT COUNT(*) AS n FROM deployments').get().n
    const mediaCount = bDb.prepare('SELECT COUNT(*) AS n FROM media').get().n
    const observationCount = bDb.prepare('SELECT COUNT(*) AS n FROM observations').get().n
    const renameCount = deploymentCount

    const bStudyRoot = join(biowatchDataPath, 'studies', sourceStudyId) + '/'

    // Single pass over media: count missing local files AND
    // biowatch-owned-AND-actually-present files. The "owned" count is what
    // drives the delete-time warning; only files that actually exist on
    // disk *and* live inside B's biowatch dir are at risk of breakage when
    // B is deleted. Filepaths-inside-biowatch that are already missing on
    // disk are neither at risk nor recoverable — they get counted as
    // missing only.
    // Stream rows so memory stays flat regardless of B's size. `.all()` here
    // would materialize a multi-million-string array for large studies and
    // can OOM the worker.
    let missingFileCount = 0
    let ownedByBiowatchCount = 0
    for (const { filePath } of bDb.prepare('SELECT filePath FROM media').iterate()) {
      if (!filePath || URL_RE.test(filePath)) continue
      const onDisk = existsSync(filePath)
      if (!onDisk) {
        missingFileCount++
      } else if (filePath.startsWith(bStudyRoot)) {
        ownedByBiowatchCount++
      }
    }

    return {
      deploymentCount,
      mediaCount,
      observationCount,
      ownedByBiowatchCount,
      missingFileCount,
      renameCount,
      alreadyMerged
    }
  } finally {
    aDb.close()
    bDb.close()
  }
}
