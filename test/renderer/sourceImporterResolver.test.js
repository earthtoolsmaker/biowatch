import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { resolveSourceDisplay } from '../../src/shared/sourceImporterResolver.js'

const studies = [
  {
    id: 'b7f2a1c3-2222-4222-9222-222222222222',
    name: 'Yosemite 2023',
    importerName: 'camtrap/datapackage'
  }
]

describe('resolveSourceDisplay', () => {
  test('non-merge folder source falls back to study-level importerName', () => {
    const result = resolveSourceDisplay({
      importFolder: '/home/user/photos',
      studyImporterName: 'local/images',
      sampleFilePath: '/home/user/photos/a.jpg',
      studies
    })
    assert.equal(result.importerName, 'local/images')
    assert.equal(result.displayLabel, undefined)
  })

  test('http filePath bumps importerName to lila/coco', () => {
    const result = resolveSourceDisplay({
      importFolder: 'Snapshot Serengeti',
      studyImporterName: 'lila/coco',
      sampleFilePath: 'https://lila.science/x.jpg',
      studies
    })
    assert.equal(result.importerName, 'lila/coco')
  })

  test('merge: prefix resolves to B title and importerName', () => {
    const result = resolveSourceDisplay({
      importFolder: 'merge:b7f2a1c3-2222-4222-9222-222222222222',
      studyImporterName: 'local/images',
      sampleFilePath: '/whatever',
      studies
    })
    assert.equal(result.importerName, 'camtrap/datapackage')
    assert.equal(result.displayLabel, 'Yosemite 2023')
  })

  test('merge: prefix with missing B falls back to "Merged source"', () => {
    const result = resolveSourceDisplay({
      importFolder: 'merge:00000000-0000-0000-0000-000000000000',
      studyImporterName: 'local/images',
      sampleFilePath: '/whatever',
      studies
    })
    assert.equal(result.importerName, 'local/images')
    assert.equal(result.displayLabel, 'Merged source')
  })

  test('merge: prefix with missing B but URL filePaths falls back to lila/coco', () => {
    const result = resolveSourceDisplay({
      importFolder: 'merge:00000000-0000-0000-0000-000000000000',
      studyImporterName: 'local/images',
      sampleFilePath: 'https://lila.science/x.jpg',
      studies
    })
    assert.equal(result.importerName, 'lila/coco')
    assert.equal(result.displayLabel, 'Merged source')
  })
})
