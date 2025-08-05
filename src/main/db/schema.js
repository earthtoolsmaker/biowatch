import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core'

export const deployments = sqliteTable('deployments', {
  deploymentID: text('deploymentID').primaryKey(),
  locationID: text('locationID'),
  locationName: text('locationName'),
  deploymentStart: text('deploymentStart'),
  deploymentEnd: text('deploymentEnd'),
  latitude: real('latitude'),
  longitude: real('longitude')
})

export const media = sqliteTable('media', {
  mediaID: text('mediaID').primaryKey(),
  deploymentID: text('deploymentID').references(() => deployments.deploymentID),
  timestamp: text('timestamp'),
  filePath: text('filePath'),
  fileName: text('fileName')
})

export const observations = sqliteTable('observations', {
  observationID: text('observationID').primaryKey(),
  mediaID: text('mediaID').references(() => media.mediaID),
  deploymentID: text('deploymentID').references(() => deployments.deploymentID),
  eventID: text('eventID'),
  eventStart: text('eventStart'),
  eventEnd: text('eventEnd'),
  scientificName: text('scientificName'),
  observationType: text('observationType'),
  commonName: text('commonName'),
  confidence: real('confidence'),
  count: integer('count'),
  prediction: text('prediction'),
  lifeStage: text('lifeStage'),
  age: text('age'),
  sex: text('sex'),
  behavior: text('behavior')
})
