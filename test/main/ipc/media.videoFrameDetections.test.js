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

// The IPC handler itself is registered against Electron's ipcMain (not importable
// cleanly in a node:test context). We cover its logic by testing the query function
// and by confirming the handler body's contract: { data } on success, { error } on failure.
// This test guards the shape expected by preload/renderer consumers.

let testBiowatchDataPath
let testDbPath
let testStudyId
let manager

beforeEach(async () => {
  try {
    const log = (await import('electron-log')).default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // ignore
  }

  testStudyId = `test-ipc-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-ipc-video-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
  manager = await createImageDirectoryDatabase(testDbPath)
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

describe('IPC media:get-video-frame-detections contract', () => {
  test('returns shape { data: [...] } for a valid video with detections', async () => {
    await insertMedia(manager, {
      'm1.mp4': {
        mediaID: 'm1',
        filePath: '/tmp/m1.mp4',
        fileName: 'm1.mp4',
        fileMediatype: 'video/mp4',
        folderName: 'deploy-1',
        importFolder: '/tmp'
      }
    })

    const studyId = getStudyIdFromPath(testDbPath)
    const db = await getDrizzleDb(studyId, testDbPath)
    const runID = crypto.randomUUID()
    await db.insert(modelRuns).values({
      id: runID,
      modelID: 'speciesnet',
      modelVersion: '4.0.1a',
      startedAt: new Date().toISOString(),
      status: 'completed'
    })
    await db.insert(modelOutputs).values({
      id: crypto.randomUUID(),
      mediaID: 'm1',
      runID,
      rawOutput: {
        frames: [
          {
            filepath: '/tmp/m1.mp4',
            prediction: 'animal;Mammalia;Carnivora;Ursidae;Ursus;arctos;brown bear',
            model_version: '4.0.1a',
            frame_number: 0,
            prediction_score: 0.9,
            metadata: { fps: 30, duration: 5 },
            detections: [{ bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.9 }]
          }
        ]
      }
    })

    // Mirror the handler body: wrap query, return { data } or { error }.
    const responseShape = await (async () => {
      try {
        const data = await getVideoFrameDetections(testDbPath, 'm1')
        return { data }
      } catch (error) {
        return { error: error.message }
      }
    })()

    assert.ok('data' in responseShape, 'response has data field')
    assert.equal(responseShape.data.length, 1)
    assert.equal(responseShape.data[0].frameNumber, 0)
    assert.equal(responseShape.data[0].bboxX, 0.1)
  })

  test('returns shape { data: [] } for a video without a modelOutputs row', async () => {
    await insertMedia(manager, {
      'm2.mp4': {
        mediaID: 'm2',
        filePath: '/tmp/m2.mp4',
        fileName: 'm2.mp4',
        fileMediatype: 'video/mp4',
        folderName: 'deploy-1',
        importFolder: '/tmp'
      }
    })

    const responseShape = await (async () => {
      try {
        const data = await getVideoFrameDetections(testDbPath, 'm2')
        return { data }
      } catch (error) {
        return { error: error.message }
      }
    })()

    assert.deepEqual(responseShape, { data: [] })
  })
})
