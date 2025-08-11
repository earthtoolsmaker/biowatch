import { dialog, app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import sqlite3 from 'sqlite3'

interface CamtrapDPMetadata {
  profile: string
  created: string
  contributors: Array<{
    title: string
    role: string
  }>
  project: {
    title: string
    samplingDesign: string
    captureMethod: string[]
    individualAnimals: boolean
    observationLevel: string[]
    description?: string
  }
  spatial: {
    type: string
    coordinates: number[][][]
  }
  temporal: {
    start: string
    end: string
  }
  taxonomic: any[]
  name?: string
  id?: string
  title?: string
  description?: string
  version?: string
  keywords?: string[]
  image?: string
  homepage?: string
  sources?: any[]
  licenses?: any[]
  bibliographicCitation?: string
  coordinatePrecision?: number
  relatedIdentifiers?: any[]
  references?: any[]
  resources: Array<{
    name: string
    path: string
    profile: string
    schema: string
  }>
}

interface DeploymentData {
  deploymentID: string
  locationID: string
  locationName?: string
  longitude?: number
  latitude?: number
  coordinateUncertainty?: number
  start: string
  end?: string
  setupBy?: string
  cameraID?: string
  cameraModel?: string
  cameraInterval?: number
  cameraHeight?: number
  baitUse?: boolean
  featureType?: string
  habitat?: string
  deploymentComments?: string
}

interface MediaData {
  mediaID: string
  deploymentID: string
  captureMethod: string
  timestamp: string
  filePath: string
  filePublic: boolean
  fileName: string
  fileMediatype: string
  exifData?: any
  favourite?: boolean
  mediaComments?: string
}

interface ObservationData {
  observationID: string
  deploymentID: string
  mediaID: string
  eventID?: string
  eventStart?: string
  eventEnd?: string
  observationLevel: string
  observationType?: string
  cameraSetupType?: string
  scientificName?: string
  count?: number
  lifeStage?: string
  sex?: string
  behaviour?: string
  individualID?: string
  individualPositionRadius?: number
  individualPositionAngle?: number
  individualSpeed?: number
  bboxX?: number
  bboxY?: number
  bboxWidth?: number
  bboxHeight?: number
  classificationMethod?: string
  classifiedBy?: string
  classificationTimestamp?: string
  classificationProbability?: number
  observationTags?: string
  observationComments?: string
}

function generateDeploymentsData(dbPath: string): Promise<DeploymentData[]> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      const query = `
        SELECT DISTINCT
          d.deploymentID,
          d.locationID,
          d.locationName,
          d.longitude,
          d.latitude,
          d.coordinateUncertainty,
          d.deploymentStart as start,
          d.deploymentEnd as end,
          d.setupBy,
          d.cameraID,
          d.cameraModel,
          d.cameraInterval,
          d.cameraHeight,
          d.baitUse,
          d.featureType,
          d.habitat,
          d.deploymentComments
        FROM deployments d
        ORDER BY d.deploymentID
      `

      db.all(query, [], (err, rows) => {
        db.close()
        if (err) {
          log.error('Error generating deployments data:', err)
          return reject(err)
        }
        resolve(rows as DeploymentData[])
      })
    })
  })
}

function generateMediaData(dbPath: string): Promise<MediaData[]> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      const query = `
        SELECT DISTINCT
          m.mediaID,
          m.deploymentID,
          'activityDetection' as captureMethod,
          m.timestamp,
          m.filePath,
          1 as filePublic,
          m.fileName,
          'image/jpeg' as fileMediatype,
          m.exifData,
          m.favourite,
          m.mediaComments
        FROM media m
        ORDER BY m.mediaID
      `

      db.all(query, [], (err, rows) => {
        db.close()
        if (err) {
          log.error('Error generating media data:', err)
          return reject(err)
        }
        resolve(rows as MediaData[])
      })
    })
  })
}

function generateObservationsData(dbPath: string): Promise<ObservationData[]> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        return reject(err)
      }

      const query = `
        SELECT DISTINCT
          o.observationID,
          o.deploymentID,
          o.mediaID,
          o.eventID,
          o.eventStart,
          o.eventEnd,
          'media' as observationLevel,
          o.observationType,
          'stationary' as cameraSetupType,
          o.scientificName,
          o.count,
          o.lifeStage,
          o.age,
          o.sex,
          o.behavior as behaviour,
          o.individualID,
          o.individualPositionRadius,
          o.individualPositionAngle,
          o.individualSpeed,
          o.bboxX,
          o.bboxY,
          o.bboxWidth,
          o.bboxHeight,
          'automatic' as classificationMethod,
          o.classifiedBy,
          o.classificationTimestamp,
          o.confidence as classificationProbability,
          o.observationTags,
          o.observationComments
        FROM observations o
        ORDER BY o.observationID
      `

      db.all(query, [], (err, rows) => {
        db.close()
        if (err) {
          log.error('Error generating observations data:', err)
          return reject(err)
        }
        resolve(rows as ObservationData[])
      })
    })
  })
}

function convertToCSV(data: any[], headers: string[]): string {
  if (data.length === 0) {
    return headers.join(',') + '\n'
  }

  const csvRows = [headers.join(',')]

  for (const row of data) {
    const values = headers.map((header) => {
      let val = row[header]
      if (val === null || val === undefined) {
        val = ''
      }
      // Escape commas and quotes in CSV
      if (
        typeof val === 'string' &&
        (val.includes(',') || val.includes('"') || val.includes('\n'))
      ) {
        val = `"${val.replace(/"/g, '""')}"`
      }
      return val
    })
    csvRows.push(values.join(','))
  }

  return csvRows.join('\n')
}

export async function exportCamtrapDP(
  studyId: string,
  metadata: Partial<CamtrapDPMetadata>
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    // Open dialog to select export location
    const result = await dialog.showSaveDialog({
      title: 'Export Camtrap DP Package',
      defaultPath: `camtrap-dp-${studyId}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Export cancelled by user' }
    }

    // Get database path
    const dbPath = join(app.getPath('userData'), 'biowatch-data', 'studies', studyId, 'study.db')

    // Generate data for CSV files
    const deploymentsData = await generateDeploymentsData(dbPath)
    const mediaData = await generateMediaData(dbPath)
    const observationsData = await generateObservationsData(dbPath)

    // Define CSV headers based on Camtrap DP specification
    const deploymentHeaders = [
      'deploymentID',
      'locationID',
      'locationName',
      'longitude',
      'latitude',
      'coordinateUncertainty',
      'start',
      'end',
      'setupBy',
      'cameraID',
      'cameraModel',
      'cameraInterval',
      'cameraHeight',
      'baitUse',
      'featureType',
      'habitat',
      'deploymentComments'
    ]

    const mediaHeaders = [
      'mediaID',
      'deploymentID',
      'captureMethod',
      'timestamp',
      'filePath',
      'filePublic',
      'fileName',
      'fileMediatype',
      'exifData',
      'favourite',
      'mediaComments'
    ]

    const observationHeaders = [
      'observationID',
      'deploymentID',
      'mediaID',
      'eventID',
      'eventStart',
      'eventEnd',
      'observationLevel',
      'observationType',
      'cameraSetupType',
      'scientificName',
      'count',
      'lifeStage',
      'sex',
      'behaviour',
      'individualID',
      'individualPositionRadius',
      'individualPositionAngle',
      'individualSpeed',
      'bboxX',
      'bboxY',
      'bboxWidth',
      'bboxHeight',
      'classificationMethod',
      'classifiedBy',
      'classificationTimestamp',
      'classificationProbability',
      'observationTags',
      'observationComments'
    ]

    // Build the complete datapackage.json
    const datapackage: CamtrapDPMetadata = {
      profile:
        metadata.profile ||
        'https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/camtrap-dp-profile.json',
      created: metadata.created || new Date().toISOString(),
      contributors: metadata.contributors || [{ title: '', role: 'contact' }],
      project: {
        title: metadata.project?.title || '',
        samplingDesign: metadata.project?.samplingDesign || 'simpleRandom',
        captureMethod: metadata.project?.captureMethod || ['activityDetection'],
        individualAnimals: metadata.project?.individualAnimals || false,
        observationLevel: metadata.project?.observationLevel || ['media'],
        ...(metadata.project?.description && { description: metadata.project.description })
      },
      spatial: metadata.spatial || {
        type: 'Polygon',
        coordinates: [[]]
      },
      temporal: metadata.temporal || {
        start: '',
        end: ''
      },
      taxonomic: metadata.taxonomic || [],
      resources: [
        {
          name: 'deployments',
          path: 'deployments.csv',
          profile: 'tabular-data-resource',
          schema:
            'https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/deployments-table-schema.json'
        },
        {
          name: 'media',
          path: 'media.csv',
          profile: 'tabular-data-resource',
          schema: 'https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/media-table-schema.json'
        },
        {
          name: 'observations',
          path: 'observations.csv',
          profile: 'tabular-data-resource',
          schema:
            'https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/observations-table-schema.json'
        }
      ],
      ...(metadata.name && { name: metadata.name }),
      ...(metadata.id && { id: metadata.id }),
      ...(metadata.title && { title: metadata.title }),
      ...(metadata.description && { description: metadata.description }),
      ...(metadata.version && { version: metadata.version }),
      ...(metadata.keywords && { keywords: metadata.keywords }),
      ...(metadata.image && { image: metadata.image }),
      ...(metadata.homepage && { homepage: metadata.homepage }),
      ...(metadata.sources && { sources: metadata.sources }),
      ...(metadata.licenses && { licenses: metadata.licenses }),
      ...(metadata.bibliographicCitation && {
        bibliographicCitation: metadata.bibliographicCitation
      }),
      ...(metadata.coordinatePrecision && { coordinatePrecision: metadata.coordinatePrecision }),
      ...(metadata.relatedIdentifiers && { relatedIdentifiers: metadata.relatedIdentifiers }),
      ...(metadata.references && { references: metadata.references })
    }

    // Write the datapackage.json file
    writeFileSync(result.filePath, JSON.stringify(datapackage, null, 2), 'utf8')

    // Optionally, write CSV files to the same directory
    const exportDir = result.filePath.replace(/\.json$/, '')
    const deploymentsPath = join(exportDir, 'deployments.csv')
    const mediaPath = join(exportDir, 'media.csv')
    const observationsPath = join(exportDir, 'observations.csv')

    // Create directory if it doesn't exist
    try {
      const fs = require('fs')
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true })
      }

      // Write CSV files
      writeFileSync(deploymentsPath, convertToCSV(deploymentsData, deploymentHeaders), 'utf8')
      writeFileSync(mediaPath, convertToCSV(mediaData, mediaHeaders), 'utf8')
      writeFileSync(observationsPath, convertToCSV(observationsData, observationHeaders), 'utf8')

      log.info(`Camtrap DP package exported successfully to ${result.filePath}`)
      log.info(`CSV files exported to ${exportDir}`)
    } catch (csvError) {
      log.warn('Failed to export CSV files, but datapackage.json was created:', csvError)
    }

    return { success: true, path: result.filePath }
  } catch (error) {
    log.error('Error exporting Camtrap DP package:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
