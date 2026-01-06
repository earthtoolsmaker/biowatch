import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isOwnEnvironmentDownload,
  isDownloadComplete,
  determineInitialDownloadState,
  calculateProgressInfo
} from '../../src/shared/downloadState.js'

describe('Download State Logic', () => {
  describe('isOwnEnvironmentDownload', () => {
    test('returns true when envActiveModelId matches currentModelId', () => {
      assert.equal(isOwnEnvironmentDownload('speciesnet', 'speciesnet'), true)
    })

    test('returns true when envActiveModelId is null (no one is downloading)', () => {
      assert.equal(isOwnEnvironmentDownload(null, 'speciesnet'), true)
    })

    test('returns false when envActiveModelId is different model', () => {
      assert.equal(isOwnEnvironmentDownload('deepfaune', 'speciesnet'), false)
    })

    test('returns false when envActiveModelId is undefined', () => {
      assert.equal(isOwnEnvironmentDownload(undefined, 'speciesnet'), false)
    })
  })

  describe('isDownloadComplete', () => {
    test('returns false when model is still downloading', () => {
      assert.equal(
        isDownloadComplete({
          modelState: 'download',
          envState: 'success',
          isOwnEnvDownload: true
        }),
        false
      )
    })

    test('returns false when model is extracting', () => {
      assert.equal(
        isDownloadComplete({
          modelState: 'extract',
          envState: 'success',
          isOwnEnvDownload: true
        }),
        false
      )
    })

    test('returns true when model success and env success', () => {
      assert.equal(
        isDownloadComplete({
          modelState: 'success',
          envState: 'success',
          isOwnEnvDownload: true
        }),
        true
      )
    })

    test('returns true when model success and env clean (archive cleanup)', () => {
      assert.equal(
        isDownloadComplete({
          modelState: 'success',
          envState: 'clean',
          isOwnEnvDownload: true
        }),
        true
      )
    })

    test('returns true when model success and not own env download (another model downloading)', () => {
      assert.equal(
        isDownloadComplete({
          modelState: 'success',
          envState: 'download',
          isOwnEnvDownload: false
        }),
        true
      )
    })

    test('returns false when model success, env downloading, own download', () => {
      assert.equal(
        isDownloadComplete({
          modelState: 'success',
          envState: 'download',
          isOwnEnvDownload: true
        }),
        false
      )
    })

    test('returns false when model success, env extracting, own download', () => {
      assert.equal(
        isDownloadComplete({
          modelState: 'success',
          envState: 'extract',
          isOwnEnvDownload: true
        }),
        false
      )
    })

    test('returns false when model failed', () => {
      assert.equal(
        isDownloadComplete({
          modelState: 'failure',
          envState: 'success',
          isOwnEnvDownload: true
        }),
        false
      )
    })
  })

  describe('determineInitialDownloadState', () => {
    test('Case 1: both complete - returns downloaded', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: { state: 'success', progress: 100 },
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: true, isDownloading: false })
    })

    test('Case 2: model downloading - returns downloading', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'download', progress: 50 },
        envStatus: {},
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: true })
    })

    test('Case 2b: model extracting - returns downloading', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'extract', progress: 95 },
        envStatus: {},
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: true })
    })

    test('Case 3: model done, env downloading by this model - returns downloading', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {
          state: 'download',
          progress: 30,
          opts: { activeDownloadModelId: 'speciesnet' }
        },
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: true })
    })

    test('Case 3b: model done, env extracting by this model - returns downloading', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {
          state: 'extract',
          progress: 80,
          opts: { activeDownloadModelId: 'speciesnet' }
        },
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: true })
    })

    test('Case 4: model done, env downloading by another model - returns neither', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {
          state: 'download',
          progress: 30,
          opts: { activeDownloadModelId: 'deepfaune' }
        },
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: false })
    })

    test('Case 5: no model entry - returns not downloaded', () => {
      const result = determineInitialDownloadState({
        modelStatus: {},
        envStatus: { state: 'success', progress: 100 },
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: false })
    })

    test('Case 5b: no env entry - returns not downloaded', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {},
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: false })
    })

    test('Case 5c: null model entry - returns not downloaded', () => {
      const result = determineInitialDownloadState({
        modelStatus: null,
        envStatus: { state: 'success', progress: 100 },
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: false })
    })

    test('Case 5d: null env entry - returns not downloaded', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: null,
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: false })
    })

    test('Case 5e: both null - returns not downloaded', () => {
      const result = determineInitialDownloadState({
        modelStatus: null,
        envStatus: null,
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: false })
    })

    test('Case 6: model failed - returns fallback (not downloaded)', () => {
      const result = determineInitialDownloadState({
        modelStatus: { state: 'failure', progress: 50 },
        envStatus: { state: 'success', progress: 100 },
        currentModelId: 'speciesnet'
      })
      assert.deepEqual(result, { isDownloaded: false, isDownloading: false })
    })
  })

  describe('calculateProgressInfo', () => {
    test('shows model progress when model is downloading', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'download', progress: 45 },
        envStatus: {},
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadProgress, 45)
      assert.equal(result.downloadMessage, 'Downloading the AI Model')
    })

    test('shows model progress when model is extracting', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'extract', progress: 95 },
        envStatus: {},
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadProgress, 95)
      assert.equal(result.downloadMessage, 'Extracting the AI Model')
    })

    test('shows env progress when model done and env downloading by this model', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {
          state: 'download',
          progress: 60,
          opts: { activeDownloadModelId: 'speciesnet' }
        },
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadProgress, 60)
      assert.equal(result.downloadMessage, 'Downloading the Python Environment')
    })

    test('shows env progress when model done and env extracting by this model', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {
          state: 'extract',
          progress: 85,
          opts: { activeDownloadModelId: 'speciesnet' }
        },
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadProgress, 85)
      assert.equal(result.downloadMessage, 'Extracting the Python Environment')
    })

    test('shows model progress when env downloading by another model', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {
          state: 'download',
          progress: 60,
          opts: { activeDownloadModelId: 'deepfaune' }
        },
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadProgress, 100)
      assert.equal(result.downloadMessage, 'Successfully installed the AI Model')
    })

    test('shows cleaning message for clean state', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {
          state: 'clean',
          progress: 98,
          opts: { activeDownloadModelId: 'speciesnet' }
        },
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadMessage, 'Cleaning up the Python Environment')
    })

    test('shows failure message for failed model', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'failure', progress: 50 },
        envStatus: {},
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadMessage, 'Failed installing the AI Model')
    })

    test('shows failure message for failed env', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'success', progress: 100 },
        envStatus: {
          state: 'failure',
          progress: 30,
          opts: { activeDownloadModelId: 'speciesnet' }
        },
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadMessage, 'Failed installing the Python Environment')
    })

    test('defaults to 0 progress when progress is undefined', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'download' },
        envStatus: {},
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadProgress, 0)
    })

    test('handles null modelStatus gracefully', () => {
      const result = calculateProgressInfo({
        modelStatus: null,
        envStatus: {},
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadProgress, 0)
      assert.equal(result.downloadMessage, 'Downloading the AI Model')
    })

    test('handles undefined envStatus gracefully', () => {
      const result = calculateProgressInfo({
        modelStatus: { state: 'download', progress: 50 },
        envStatus: undefined,
        currentModelId: 'speciesnet'
      })
      assert.equal(result.downloadProgress, 50)
      assert.equal(result.downloadMessage, 'Downloading the AI Model')
    })
  })
})
