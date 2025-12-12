import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import fs from 'fs/promises'

// Test paths
let testUserDataPath
let testStudiesPath

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

  testUserDataPath = join(tmpdir(), 'biowatch-studies-simple-test', Date.now().toString())
  testStudiesPath = join(testUserDataPath, 'biowatch-data', 'studies')
  mkdirSync(testStudiesPath, { recursive: true })
})

afterEach(() => {
  // Clean up test directory
  if (existsSync(testUserDataPath)) {
    rmSync(testUserDataPath, { recursive: true, force: true })
  }
})

/**
 * Helper function to create a test study
 * @param {string} studyId - Study identifier
 * @param {Object} studyData - Study data object
 * @returns {string} - Path to the created study directory
 */
async function createTestStudy(studyId, studyData = {}) {
  const studyDir = join(testStudiesPath, studyId)
  await fs.mkdir(studyDir, { recursive: true })

  const defaultStudyData = {
    id: studyId,
    name: `Test Study ${studyId}`,
    importerName: 'test/importer',
    createdAt: new Date().toISOString(),
    data: {
      description: 'Test study description',
      contributors: [{ title: 'Test Author' }]
    }
  }

  const finalStudyData = { ...defaultStudyData, ...studyData }
  const studyJsonPath = join(studyDir, 'study.json')
  await fs.writeFile(studyJsonPath, JSON.stringify(finalStudyData, null, 2))

  return studyDir
}

/**
 * Simulate the studies:list functionality without Electron dependencies
 */
function listStudies(studiesPath) {
  if (!existsSync(studiesPath)) {
    return []
  }

  const studyDirs = readdirSync(studiesPath, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)

  return studyDirs
    .map((studyId) => {
      try {
        const studyJsonPath = join(studiesPath, studyId, 'study.json')
        if (!existsSync(studyJsonPath)) {
          return null
        }
        const study = JSON.parse(readFileSync(studyJsonPath, 'utf8'))
        return { ...study, id: studyId }
      } catch {
        return {
          id: studyId,
          error: 'Failed to load study data'
        }
      }
    })
    .filter((study) => study)
}

/**
 * Simulate the studies:update functionality
 */
function updateStudy(studiesPath, studyId, update) {
  const studyJsonPath = join(studiesPath, studyId, 'study.json')
  if (!existsSync(studyJsonPath)) {
    return null
  }

  const study = JSON.parse(readFileSync(studyJsonPath, 'utf8'))
  const updated = { ...study, ...update }
  writeFileSync(studyJsonPath, JSON.stringify(updated, null, 2))
  return updated
}

describe('Studies Management Tests (Simplified)', () => {
  describe('Study File Operations', () => {
    test('should list all studies', async () => {
      // Create test studies
      await createTestStudy('study1', { name: 'Camera Trap Study A' })
      await createTestStudy('study2', { name: 'Wildlife Survey B' })
      await createTestStudy('study3', { name: 'Forest Monitoring C' })

      const studies = listStudies(testStudiesPath)

      assert(Array.isArray(studies), 'Should return an array')
      assert.equal(studies.length, 3, 'Should return 3 studies')

      // Check that all studies have required properties
      studies.forEach((study) => {
        assert(study.id, 'Study should have an id')
        assert(study.name, 'Study should have a name')
        assert(study.importerName, 'Study should have an importerName')
        assert(study.data, 'Study should have data object')
      })

      // Check specific studies
      const studyIds = studies.map((s) => s.id).sort()
      assert.deepEqual(studyIds, ['study1', 'study2', 'study3'], 'Should include all study IDs')
    })

    test('should return empty array when no studies exist', async () => {
      const studies = listStudies(testStudiesPath)

      assert(Array.isArray(studies), 'Should return an array')
      assert.equal(studies.length, 0, 'Should return empty array')
    })

    test('should handle corrupted study.json files gracefully', async () => {
      // Create valid study
      await createTestStudy('valid-study')

      // Create corrupted study
      const corruptedStudyDir = join(testStudiesPath, 'corrupted-study')
      await fs.mkdir(corruptedStudyDir, { recursive: true })
      await fs.writeFile(join(corruptedStudyDir, 'study.json'), 'invalid json {')

      const studies = listStudies(testStudiesPath)

      assert(Array.isArray(studies), 'Should return an array')
      assert.equal(studies.length, 2, 'Should return both valid and corrupted studies')

      // Valid study should be loaded properly
      const validStudy = studies.find((s) => s.id === 'valid-study')
      assert(validStudy, 'Valid study should be found')
      assert(validStudy.name, 'Valid study should have name')

      // Corrupted study should have error indication
      const corruptedStudy = studies.find((s) => s.id === 'corrupted-study')
      assert(corruptedStudy, 'Corrupted study should be found')
      assert(corruptedStudy.error, 'Corrupted study should have error property')
    })

    test('should handle missing study.json files', async () => {
      // Create directory without study.json
      const emptyStudyDir = join(testStudiesPath, 'empty-study')
      await fs.mkdir(emptyStudyDir, { recursive: true })

      // Create valid study for comparison
      await createTestStudy('valid-study')

      const studies = listStudies(testStudiesPath)

      assert(Array.isArray(studies), 'Should return an array')
      assert.equal(studies.length, 1, 'Should only return studies with valid study.json')
      assert.equal(studies[0].id, 'valid-study', 'Should return the valid study')
    })
  })

  describe('Study Updates', () => {
    test('should update study successfully', async () => {
      await createTestStudy('test-study', { name: 'Original Name' })

      const update = {
        name: 'Updated Name',
        description: 'Updated description'
      }

      const result = updateStudy(testStudiesPath, 'test-study', update)

      assert(result, 'Should return the updated study')
      assert.equal(result.name, 'Updated Name', 'Name should be updated')
      assert.equal(result.description, 'Updated description', 'Description should be updated')

      // Verify the file was updated
      const studyJsonPath = join(testStudiesPath, 'test-study', 'study.json')
      const updatedContent = JSON.parse(readFileSync(studyJsonPath, 'utf8'))

      assert.equal(updatedContent.name, 'Updated Name', 'Name should be updated in file')
      assert.equal(
        updatedContent.description,
        'Updated description',
        'Description should be updated in file'
      )
      assert.equal(updatedContent.id, 'test-study', 'ID should remain unchanged')
    })

    test('should handle partial updates', async () => {
      const originalData = {
        name: 'Original Name',
        description: 'Original description',
        tags: ['tag1', 'tag2']
      }
      await createTestStudy('test-study', originalData)

      const update = { name: 'Updated Name' }

      const result = updateStudy(testStudiesPath, 'test-study', update)

      // Verify only specified fields were updated
      assert.equal(result.name, 'Updated Name', 'Name should be updated')
      assert.equal(
        result.description,
        'Original description',
        'Description should remain unchanged'
      )
      assert.deepEqual(result.tags, ['tag1', 'tag2'], 'Tags should remain unchanged')
    })

    test('should handle non-existent study', async () => {
      const update = { name: 'Updated Name' }

      const result = updateStudy(testStudiesPath, 'non-existent-study', update)

      assert.equal(result, null, 'Should return null for non-existent study')
    })
  })

  describe('Study Structure Validation', () => {
    test('should maintain consistent study.json structure', async () => {
      const studyData = {
        name: 'Structure Test Study',
        importerName: 'test/importer',
        data: {
          title: 'Test Dataset',
          description: 'A test dataset for structure validation',
          contributors: [{ title: 'Test Author', role: 'contributor' }],
          resources: []
        }
      }

      await createTestStudy('structure-test', studyData)

      const studyPath = join(testStudiesPath, 'structure-test', 'study.json')
      const savedContent = JSON.parse(readFileSync(studyPath, 'utf8'))

      // Verify required fields
      assert(savedContent.id, 'Should have id')
      assert(savedContent.name, 'Should have name')
      assert(savedContent.importerName, 'Should have importerName')
      assert(savedContent.data, 'Should have data object')

      // Verify data structure
      assert(savedContent.data.contributors, 'Should have contributors')
      assert(Array.isArray(savedContent.data.contributors), 'Contributors should be array')

      // Verify JSON formatting (should be properly formatted)
      const reserializedContent = JSON.stringify(savedContent, null, 2)
      const originalContent = readFileSync(studyPath, 'utf8')
      assert.equal(reserializedContent, originalContent, 'JSON should be properly formatted')
    })

    test('should handle special characters in study names and data', async () => {
      const specialStudyData = {
        name: 'Study with "quotes" & <tags> and émojis 🦌',
        importerName: 'test/special',
        data: {
          description: 'Description with special chars: "quotes", <brackets>, & ampersands',
          location: 'Forêt de Brocéliande',
          contributors: [{ title: 'José María García-López' }]
        }
      }

      await createTestStudy('special-chars-study', specialStudyData)

      const studies = listStudies(testStudiesPath)
      const specialStudy = studies.find((s) => s.id === 'special-chars-study')

      assert(specialStudy, 'Study with special characters should be loaded')
      assert.equal(
        specialStudy.name,
        'Study with "quotes" & <tags> and émojis 🦌',
        'Special characters in name should be preserved'
      )
      assert.equal(
        specialStudy.data.location,
        'Forêt de Brocéliande',
        'Unicode characters should be preserved'
      )
    })

    test('should handle various importer types', async () => {
      const importerTypes = [
        'camtrap/datapackage',
        'wildlife/folder',
        'deepfaune/csv',
        'local/images'
      ]

      for (const importer of importerTypes) {
        const studyId = `study-${importer.replace('/', '-')}`
        await createTestStudy(studyId, {
          name: `Study for ${importer}`,
          importerName: importer
        })
      }

      const studies = listStudies(testStudiesPath)

      assert.equal(
        studies.length,
        importerTypes.length,
        'Should load all studies with different importers'
      )

      importerTypes.forEach((importer) => {
        const study = studies.find((s) => s.importerName === importer)
        assert(study, `Should find study with importer ${importer}`)
      })
    })

    test('should preserve study timestamps and metadata', async () => {
      const createdAt = '2023-05-15T10:30:00.000Z'
      const updatedAt = '2023-05-16T14:45:30.000Z'

      await createTestStudy('timestamp-study', {
        name: 'Timestamp Study',
        createdAt,
        updatedAt,
        data: {
          processingStarted: '2023-05-15T11:00:00.000Z',
          processingCompleted: '2023-05-15T12:30:00.000Z'
        }
      })

      const studies = listStudies(testStudiesPath)
      const timestampStudy = studies.find((s) => s.id === 'timestamp-study')

      assert(timestampStudy, 'Timestamp study should be found')
      assert.equal(timestampStudy.createdAt, createdAt, 'Created timestamp should be preserved')
      assert.equal(timestampStudy.updatedAt, updatedAt, 'Updated timestamp should be preserved')
      assert.equal(
        timestampStudy.data.processingStarted,
        '2023-05-15T11:00:00.000Z',
        'Processing timestamps should be preserved'
      )
    })
  })

  describe('Error Handling', () => {
    test('should handle studies directory that does not exist', async () => {
      // Remove the studies directory
      if (existsSync(testStudiesPath)) {
        rmSync(testStudiesPath, { recursive: true })
      }

      const studies = listStudies(testStudiesPath)

      assert(Array.isArray(studies), 'Should return an array even if directory missing')
      assert.equal(studies.length, 0, 'Should return empty array when directory missing')
    })

    test('should handle very large study.json files', async () => {
      // Create a study with large data
      const largeData = {
        name: 'Large Study',
        importerName: 'test/large',
        data: {
          observations: Array(1000)
            .fill(null)
            .map((_, i) => ({
              id: `obs_${i}`,
              species: `Species ${i % 50}`,
              timestamp: new Date().toISOString(),
              location: { lat: 46.0 + (i % 100) * 0.001, lon: 6.0 + (i % 100) * 0.001 }
            }))
        }
      }

      await createTestStudy('large-study', largeData)

      const studies = listStudies(testStudiesPath)
      const largeStudy = studies.find((s) => s.id === 'large-study')

      assert(largeStudy, 'Large study should be loaded')
      assert.equal(largeStudy.name, 'Large Study', 'Large study should have correct name')
      assert.equal(
        largeStudy.data.observations.length,
        1000,
        'Large study should have all observations'
      )
    })
  })
})
