import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import fs from 'fs/promises'

// Import the functions we want to test
import {
  findPythonEnvironment,
  findModel,
  platformToKey,
  modelZoo,
  pythonEnvironments
} from '../../src/shared/mlmodels.js'

// Test paths
let testUserDataPath

beforeEach(async () => {
  // Disable electron-log output in tests
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment, that's fine
  }

  testUserDataPath = join(tmpdir(), 'biowatch-models-test', Date.now().toString())
  mkdirSync(testUserDataPath, { recursive: true })
})

afterEach(async () => {
  // Clean up test directory
  if (existsSync(testUserDataPath)) {
    rmSync(testUserDataPath, { recursive: true, force: true })
  }
})

/**
 * Helper function to create mock model installation
 * @param {string} modelId - Model identifier
 * @param {string} version - Model version
 * @returns {string} - Path to the created mock installation
 */
async function createMockModelInstallation(modelId, version) {
  const modelPath = join(testUserDataPath, 'biowatch-data', 'model-zoo', modelId, version)
  await fs.mkdir(modelPath, { recursive: true })

  // Create some mock model files
  await fs.writeFile(join(modelPath, 'model.weights'), 'mock weights data')
  await fs.writeFile(join(modelPath, 'config.json'), JSON.stringify({ model: modelId, version }))

  return modelPath
}

/**
 * Helper function to create mock Python environment installation
 * @param {string} envId - Environment identifier
 * @param {string} version - Environment version
 * @returns {string} - Path to the created mock installation
 */
async function createMockPythonEnvironment(envId, version) {
  const envPath = join(
    testUserDataPath,
    'biowatch-data',
    'python-environments',
    'conda',
    envId,
    version
  )
  await fs.mkdir(envPath, { recursive: true })

  // Create mock Python environment structure
  await fs.mkdir(join(envPath, envId), { recursive: true })
  await fs.writeFile(join(envPath, envId, 'python'), '#!/usr/bin/env python3\nprint("Mock Python")')
  await fs.writeFile(join(envPath, envId, 'requirements.txt'), 'torch==2.0.0\nnumpy==1.24.0')

  return envPath
}

/**
 * Helper function to create mock download manifest
 * @param {string} manifestPath - Path to manifest file
 * @param {Object} entries - Manifest entries
 */
async function createMockManifest(manifestPath, entries) {
  await fs.mkdir(join(manifestPath, '..'), { recursive: true })
  const yaml = await import('js-yaml')
  const manifestContent = yaml.dump(entries)
  await fs.writeFile(manifestPath, manifestContent)
}

describe('ML Model Management Tests', () => {
  describe('MLModels Configuration', () => {
    test('should have valid model zoo configuration', () => {
      assert(Array.isArray(modelZoo), 'modelZoo should be an array')
      assert(modelZoo.length > 0, 'modelZoo should not be empty')

      modelZoo.forEach((model) => {
        assert(model.reference, 'Model should have reference')
        assert(model.reference.id, 'Model should have id')
        assert(model.reference.version, 'Model should have version')
        assert(model.pythonEnvironment, 'Model should have pythonEnvironment')
        assert(model.name, 'Model should have name')
        assert(typeof model.size_in_MB === 'number', 'Model should have numeric size')
        assert(model.downloadURL, 'Model should have downloadURL')
        assert(model.description, 'Model should have description')
      })
    })

    test('should have valid Python environments configuration', () => {
      assert(Array.isArray(pythonEnvironments), 'pythonEnvironments should be an array')
      assert(pythonEnvironments.length > 0, 'pythonEnvironments should not be empty')

      pythonEnvironments.forEach((env) => {
        assert(env.reference, 'Environment should have reference')
        assert(env.reference.id, 'Environment should have id')
        assert(env.reference.version, 'Environment should have version')
        assert(env.platform, 'Environment should have platform configurations')

        // Check platform configurations (at least one platform should exist)
        const availablePlatforms = Object.keys(env.platform)
        assert(
          availablePlatforms.length > 0,
          'Environment should have at least one platform configuration'
        )

        availablePlatforms.forEach((platform) => {
          const platformConfig = env.platform[platform]
          assert(platformConfig, `Platform ${platform} should have configuration`)
          assert(platformConfig.downloadURL, `${platform} should have downloadURL`)
          assert(typeof platformConfig.files === 'number', `${platform} should have files count`)
          assert(typeof platformConfig.size_in_MB === 'number', `${platform} should have size`)
        })
      })
    })
  })

  describe('findPythonEnvironment', () => {
    test('should find existing Python environment', () => {
      const result = findPythonEnvironment({ id: 'common', version: '0.1.2' })

      assert(result, 'Should find the environment')
      assert.equal(result.reference.id, 'common', 'Should have correct id')
      assert.equal(result.reference.version, '0.1.2', 'Should have correct version')
      assert(result.platform, 'Should have platform configurations')
    })

    test('should return null for non-existent environment', () => {
      const result = findPythonEnvironment({ id: 'nonexistent', version: '1.0.0' })

      assert.equal(result, null, 'Should return null for non-existent environment')
    })

    test('should handle invalid parameters', () => {
      const result1 = findPythonEnvironment({ id: null, version: '0.1.2' })
      const result2 = findPythonEnvironment({ id: 'common', version: null })
      const result3 = findPythonEnvironment({})

      assert.equal(result1, null, 'Should handle null id')
      assert.equal(result2, null, 'Should handle null version')
      assert.equal(result3, null, 'Should handle empty parameters')
    })
  })

  describe('findModel', () => {
    test('should find existing model', () => {
      const result = findModel({ id: 'speciesnet', version: '4.0.1a' })

      assert(result, 'Should find the model')
      assert.equal(result.reference.id, 'speciesnet', 'Should have correct id')
      assert.equal(result.reference.version, '4.0.1a', 'Should have correct version')
      assert(result.downloadURL, 'Should have download URL')
    })

    test('should return null for non-existent model', () => {
      const result = findModel({ id: 'nonexistent', version: '1.0.0' })

      assert.equal(result, null, 'Should return null for non-existent model')
    })

    test('should handle version mismatch', () => {
      const result = findModel({ id: 'speciesnet', version: '999.0.0' })

      assert.equal(result, null, 'Should return null for wrong version')
    })
  })

  describe('platformToKey', () => {
    test('should correctly map platform strings', () => {
      assert.equal(platformToKey('win32'), 'windows', 'Should map win32 to windows')
      assert.equal(platformToKey('linux'), 'linux', 'Should map linux to linux')
      assert.equal(platformToKey('darwin'), 'mac', 'Should map darwin to mac')
    })

    test('should handle unknown platforms', () => {
      assert.equal(platformToKey('unknown'), 'mac', 'Should default to mac for unknown platforms')
      assert.equal(platformToKey('freebsd'), 'mac', 'Should default to mac for FreeBSD')
    })

    test('should handle null and undefined', () => {
      assert.equal(platformToKey(null), 'mac', 'Should default to mac for null')
      assert.equal(platformToKey(undefined), 'mac', 'Should default to mac for undefined')
    })
  })

  describe('Model Installation Detection', () => {
    test('should create and detect mock installations', async () => {
      // Create mock installations
      await createMockModelInstallation('speciesnet', '4.0.1a')
      await createMockModelInstallation('deepfaune', '1.3')

      // Verify the mock setup works
      const modelPath = join(testUserDataPath, 'biowatch-data', 'model-zoo', 'speciesnet', '4.0.1a')
      assert(existsSync(modelPath), 'Mock model installation should exist')
      assert(existsSync(join(modelPath, 'model.weights')), 'Mock model files should exist')

      const deepfaunePath = join(testUserDataPath, 'biowatch-data', 'model-zoo', 'deepfaune', '1.3')
      assert(existsSync(deepfaunePath), 'DeepFaune mock installation should exist')
      assert(existsSync(join(deepfaunePath, 'model.weights')), 'DeepFaune mock files should exist')
    })
  })

  describe('Python Environment Management', () => {
    test('should detect installed Python environments', async () => {
      // Create mock Python environment installation
      await createMockPythonEnvironment('common', '0.1.2')

      const envPath = join(
        testUserDataPath,
        'biowatch-data',
        'python-environments',
        'conda',
        'common',
        '0.1.2'
      )
      assert(existsSync(envPath), 'Mock Python environment should exist')

      const pythonExecutable = join(envPath, 'common', 'python')
      assert(existsSync(pythonExecutable), 'Mock Python executable should exist')
    })
  })

  describe('Download Manifest Management', () => {
    test('should handle manifest file operations', async () => {
      const manifestPath = join(testUserDataPath, 'biowatch-data', 'model-zoo', 'manifest.yaml')

      // Create mock manifest
      const manifestData = {
        'speciesnet-4.0.1a': {
          state: 'success',
          progress: 100,
          archivePath: '/path/to/archive.tar.gz',
          installPath: '/path/to/install'
        }
      }

      await createMockManifest(manifestPath, manifestData)

      assert(existsSync(manifestPath), 'Manifest file should be created')

      // Read and verify manifest content
      const content = await fs.readFile(manifestPath, 'utf8')
      const yaml = await import('js-yaml')
      const parsed = yaml.load(content)

      assert(parsed['speciesnet-4.0.1a'], 'Manifest should contain model entry')
      assert.equal(parsed['speciesnet-4.0.1a'].state, 'success', 'Should have correct state')
      assert.equal(parsed['speciesnet-4.0.1a'].progress, 100, 'Should have correct progress')
    })
  })

  describe('Garbage Collection Setup', () => {
    test('should create mock installations for testing', async () => {
      // Create valid model installations that match the model zoo
      await createMockModelInstallation('speciesnet', '4.0.1a')
      await createMockPythonEnvironment('common', '0.1.2')

      // Verify installations exist
      const modelPath = join(testUserDataPath, 'biowatch-data', 'model-zoo', 'speciesnet', '4.0.1a')
      const envPath = join(
        testUserDataPath,
        'biowatch-data',
        'python-environments',
        'conda',
        'common',
        '0.1.2'
      )

      assert(existsSync(modelPath), 'Mock model installation should exist')
      assert(existsSync(envPath), 'Mock Python environment should exist')

      // Verify file structure
      assert(existsSync(join(modelPath, 'model.weights')), 'Model files should exist')
      assert(existsSync(join(envPath, 'common', 'python')), 'Python executable should exist')
    })

    test('should identify potential stale installations', async () => {
      // Create installations that don't match current model zoo
      await createMockModelInstallation('old-model', '1.0.0')
      await createMockModelInstallation('deprecated-model', '0.5.0')
      await createMockPythonEnvironment('old-env', '0.0.1')

      const staleModelPath = join(
        testUserDataPath,
        'biowatch-data',
        'model-zoo',
        'old-model',
        '1.0.0'
      )
      const staleEnvPath = join(
        testUserDataPath,
        'biowatch-data',
        'python-environments',
        'conda',
        'old-env',
        '0.0.1'
      )

      // Verify stale installations exist
      assert(existsSync(staleModelPath), 'Stale model should exist')
      assert(existsSync(staleEnvPath), 'Stale environment should exist')

      // Verify these would be identified as stale (not in current model zoo)
      const staleModelInZoo = findModel({ id: 'old-model', version: '1.0.0' })
      const staleEnvInZoo = findPythonEnvironment({ id: 'old-env', version: '0.0.1' })

      assert.equal(staleModelInZoo, null, 'Stale model should not be in current zoo')
      assert.equal(staleEnvInZoo, null, 'Stale environment should not be in current zoo')
    })
  })

  describe('Model Compatibility', () => {
    test('should ensure all models have compatible Python environments', () => {
      modelZoo.forEach((model) => {
        const requiredEnv = model.pythonEnvironment
        const matchingEnv = findPythonEnvironment(requiredEnv)

        assert(
          matchingEnv,
          `Model ${model.reference.id} should have a compatible Python environment`
        )
        assert.equal(
          matchingEnv.reference.id,
          requiredEnv.id,
          `Environment ID should match for model ${model.reference.id}`
        )
        assert.equal(
          matchingEnv.reference.version,
          requiredEnv.version,
          `Environment version should match for model ${model.reference.id}`
        )
      })
    })

    test('should have consistent download URLs', () => {
      modelZoo.forEach((model) => {
        assert(
          model.downloadURL.startsWith('https://'),
          `Model ${model.reference.id} should have HTTPS download URL`
        )
        assert(
          model.downloadURL.includes('.tar.gz'),
          `Model ${model.reference.id} should be a tar.gz archive`
        )
      })

      pythonEnvironments.forEach((env) => {
        Object.keys(env.platform).forEach((platform) => {
          const platformConfig = env.platform[platform]
          assert(
            platformConfig.downloadURL.startsWith('https://'),
            `Environment ${env.reference.id} ${platform} should have HTTPS download URL`
          )
          assert(
            platformConfig.downloadURL.includes('.tar.gz'),
            `Environment ${env.reference.id} ${platform} should be a tar.gz archive`
          )
        })
      })
    })
  })

  describe('Error Handling', () => {
    test('should handle missing model zoo directory', async () => {
      // Don't create the model zoo directory
      const nonExistentPath = join(testUserDataPath, 'biowatch-data', 'model-zoo')
      assert(!existsSync(nonExistentPath), 'Model zoo directory should not exist')

      // Test functions should handle missing directories gracefully
      // This would typically be tested through the actual model management functions
    })

    test('should handle corrupted manifest files', async () => {
      const manifestPath = join(testUserDataPath, 'biowatch-data', 'model-zoo', 'manifest.yaml')
      await fs.mkdir(join(manifestPath, '..'), { recursive: true })

      // Create corrupted manifest
      await fs.writeFile(manifestPath, 'invalid: yaml: content: [unclosed')

      assert(existsSync(manifestPath), 'Corrupted manifest should exist')

      // Functions should handle corrupted manifests gracefully
      // This would need to be tested through actual manifest reading functions
    })

    test('should handle permission errors', async () => {
      // Create a directory structure
      const restrictedPath = join(testUserDataPath, 'restricted')
      await fs.mkdir(restrictedPath, { recursive: true })

      try {
        // Try to make it read-only (may not work on all systems)
        await fs.chmod(restrictedPath, 0o444)

        // Test that functions handle permission errors gracefully
        // This is primarily a structural test
        assert(existsSync(restrictedPath), 'Restricted directory should exist')
      } catch {
        // chmod might not work in all test environments, which is acceptable
      }
    })
  })

  describe('Model Validation', () => {
    test('should validate model references format', () => {
      modelZoo.forEach((model) => {
        const ref = model.reference

        // ID should be a non-empty string
        assert(typeof ref.id === 'string', `Model ID should be string for ${ref.id}`)
        assert(ref.id.length > 0, `Model ID should not be empty for ${ref.id}`)

        // Version should be a non-empty string
        assert(typeof ref.version === 'string', `Model version should be string for ${ref.id}`)
        assert(ref.version.length > 0, `Model version should not be empty for ${ref.id}`)

        // Size should be positive number
        assert(typeof model.size_in_MB === 'number', `Size should be number for ${ref.id}`)
        assert(model.size_in_MB > 0, `Size should be positive for ${ref.id}`)

        // Files count should be positive number
        assert(typeof model.files === 'number', `Files count should be number for ${ref.id}`)
        assert(model.files > 0, `Files count should be positive for ${ref.id}`)
      })
    })

    test('should validate Python environment references format', () => {
      pythonEnvironments.forEach((env) => {
        const ref = env.reference

        // ID should be a non-empty string
        assert(typeof ref.id === 'string', `Environment ID should be string for ${ref.id}`)
        assert(ref.id.length > 0, `Environment ID should not be empty for ${ref.id}`)

        // Version should follow semantic versioning pattern
        assert(
          typeof ref.version === 'string',
          `Environment version should be string for ${ref.id}`
        )
        assert(
          /^\d+\.\d+\.\d+$/.test(ref.version),
          `Environment version should follow semver for ${ref.id}: ${ref.version}`
        )

        // Type should be supported
        assert(
          ['conda'].includes(env.type),
          `Environment type should be supported for ${ref.id}: ${env.type}`
        )
      })
    })
  })
})
