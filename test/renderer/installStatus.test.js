import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getModelInstallStatus } from '../../src/renderer/src/models/installStatus.js'

const SPECIESNET = {
  reference: { id: 'speciesnet', version: '4.0.1a' },
  pythonEnvironment: { id: 'common', version: '0.1.4' }
}

const DEEPFAUNE = {
  reference: { id: 'deepfaune', version: '1.3' },
  pythonEnvironment: { id: 'common', version: '0.1.4' }
}

describe('getModelInstallStatus', () => {
  test("returns 'installed' when both model and env are present", () => {
    const installedModels = [{ id: 'speciesnet', version: '4.0.1a' }]
    const installedEnvs = [{ id: 'common', version: '0.1.4' }]
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'installed'
    )
  })

  test("returns 'env-missing' when model is present but env is not", () => {
    const installedModels = [{ id: 'speciesnet', version: '4.0.1a' }]
    const installedEnvs = []
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'env-missing'
    )
  })

  test("returns 'not-installed' when model is not present", () => {
    const installedModels = []
    const installedEnvs = [{ id: 'common', version: '0.1.4' }]
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'not-installed'
    )
  })

  test("returns 'not-installed' when neither model nor env is present", () => {
    assert.equal(getModelInstallStatus(SPECIESNET, [], []), 'not-installed')
  })

  test('matches model by both id and version (not just id)', () => {
    const installedModels = [{ id: 'speciesnet', version: '3.0.0' }]
    const installedEnvs = [{ id: 'common', version: '0.1.4' }]
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'not-installed'
    )
  })

  test('matches env by both id and version', () => {
    const installedModels = [{ id: 'speciesnet', version: '4.0.1a' }]
    const installedEnvs = [{ id: 'common', version: '0.1.0' }]
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'env-missing'
    )
  })

  test('returns the right status for a different model in the same env', () => {
    const installedModels = [{ id: 'speciesnet', version: '4.0.1a' }]
    const installedEnvs = [{ id: 'common', version: '0.1.4' }]
    // DeepFaune shares the env but its own model isn't installed
    assert.equal(
      getModelInstallStatus(DEEPFAUNE, installedModels, installedEnvs),
      'not-installed'
    )
  })
})
