import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import crypto from 'crypto'

import {
  createImageDirectoryDatabase,
  insertMedia,
  getStudyIdFromPath,
  getVideoFrameDetections,
  getDrizzleDb,
  modelRuns,
  modelOutputs
} from '../../../src/main/database/index.js'

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
    // electron-log not available — ignore
  }

  testStudyId = `test-video-bboxes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-video-bboxes-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })

  manager = await createImageDirectoryDatabase(testDbPath)
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function insertVideoModelOutput(
  mediaID,
  frames,
  modelID = 'speciesnet',
  modelVersion = '4.0.1a'
) {
  const studyId = getStudyIdFromPath(testDbPath)
  const db = await getDrizzleDb(studyId, testDbPath)

  const runID = crypto.randomUUID()
  await db.insert(modelRuns).values({
    id: runID,
    modelID,
    modelVersion,
    startedAt: new Date().toISOString(),
    status: 'completed'
  })

  await db.insert(modelOutputs).values({
    id: crypto.randomUUID(),
    mediaID,
    runID,
    rawOutput: { frames }
  })
}

async function insertVideoMedia(mediaID = 'media-1') {
  await insertMedia(manager, {
    [`${mediaID}.mp4`]: {
      mediaID,
      filePath: `/tmp/${mediaID}.mp4`,
      fileName: `${mediaID}.mp4`,
      fileMediatype: 'video/mp4',
      folderName: 'deploy-1',
      importFolder: '/tmp'
    }
  })
}

function speciesnetFrame(frameNumber, detections) {
  return {
    filepath: '/tmp/x.mp4',
    prediction: 'animal;Mammalia;Carnivora;Ursidae;Ursus;arctos;brown bear',
    model_version: '4.0.1a',
    prediction_score: 0.8,
    frame_number: frameNumber,
    metadata: { fps: 30, duration: 5 },
    detections
  }
}

describe('getVideoFrameDetections', () => {
  test('returns empty array when no modelOutputs row exists', async () => {
    await insertVideoMedia('m1')
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.deepEqual(result, [])
  })

  test('returns empty array when media does not exist', async () => {
    const result = await getVideoFrameDetections(testDbPath, 'does-not-exist')
    assert.deepEqual(result, [])
  })

  test('returns empty array when rawOutput.frames is empty', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput('m1', [])
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.deepEqual(result, [])
  })

  test('applies threshold: always keeps top, drops others below 0.5', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput('m1', [
      speciesnetFrame(0, [
        { bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.4 },
        { bbox: [0.3, 0.3, 0.1, 0.1], conf: 0.3 },
        { bbox: [0.5, 0.5, 0.1, 0.1], conf: 0.2 }
      ]),
      speciesnetFrame(1, [
        { bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.9 },
        { bbox: [0.3, 0.3, 0.1, 0.1], conf: 0.6 },
        { bbox: [0.5, 0.5, 0.1, 0.1], conf: 0.4 }
      ])
    ])
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    // Frame 0: top only (0.4) — no others ≥ 0.5.
    // Frame 1: top (0.9) + 0.6 (≥ 0.5). 0.4 dropped.
    assert.equal(result.length, 3)

    const frame0 = result.filter((d) => d.frameNumber === 0)
    assert.equal(frame0.length, 1)
    assert.equal(frame0[0].conf, 0.4)

    const frame1 = result.filter((d) => d.frameNumber === 1).sort((a, b) => b.conf - a.conf)
    assert.equal(frame1.length, 2)
    assert.equal(frame1[0].conf, 0.9)
    assert.equal(frame1[1].conf, 0.6)
  })

  test('preserves ascending frameNumber ordering', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput('m1', [
      speciesnetFrame(5, [{ bbox: [0, 0, 0.1, 0.1], conf: 0.9 }]),
      speciesnetFrame(0, [{ bbox: [0, 0, 0.1, 0.1], conf: 0.9 }]),
      speciesnetFrame(2, [{ bbox: [0, 0, 0.1, 0.1], conf: 0.9 }])
    ])
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.deepEqual(
      result.map((d) => d.frameNumber),
      [0, 2, 5]
    )
  })

  test('normalizes SpeciesNet bbox (already top-left) correctly', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput(
      'm1',
      [speciesnetFrame(0, [{ bbox: [0.1, 0.2, 0.3, 0.4], conf: 0.9 }])],
      'speciesnet',
      '4.0.1a'
    )
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.equal(result.length, 1)
    assert.equal(result[0].bboxX, 0.1)
    assert.equal(result[0].bboxY, 0.2)
    assert.equal(result[0].bboxWidth, 0.3)
    assert.equal(result[0].bboxHeight, 0.4)
  })

  test('normalizes DeepFaune xywhn (center format) to top-left', async () => {
    await insertVideoMedia('m1')
    // Center (0.5, 0.5), width 0.2, height 0.4 → top-left (0.4, 0.3), w 0.2, h 0.4
    await insertVideoModelOutput(
      'm1',
      [
        {
          filepath: '/tmp/x.mp4',
          prediction: 'chamois',
          model_version: '1.3',
          prediction_score: 0.8,
          frame_number: 0,
          metadata: { fps: 30, duration: 5 },
          detections: [{ xywhn: [0.5, 0.5, 0.2, 0.4], conf: 0.9 }]
        }
      ],
      'deepfaune',
      '1.3'
    )
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.equal(result.length, 1)
    assert.ok(Math.abs(result[0].bboxX - 0.4) < 1e-9)
    assert.ok(Math.abs(result[0].bboxY - 0.3) < 1e-9)
    assert.equal(result[0].bboxWidth, 0.2)
    assert.equal(result[0].bboxHeight, 0.4)
  })

  test('skips detections with malformed bbox data', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput('m1', [
      speciesnetFrame(0, [
        { bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.9 },
        { bbox: null, conf: 0.8 }, // malformed — transform returns null
        { conf: 0.7 } // missing bbox entirely
      ])
    ])
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    // Only the top valid detection survives.
    assert.equal(result.length, 1)
    assert.equal(result[0].conf, 0.9)
  })
})
