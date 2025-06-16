import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core'
import { deployments } from './deployments'
import { media } from './media'

export const observations = sqliteTable('observations', {
  observationID: text().primaryKey(),
  mediaID: text().references(() => media.mediaID),
  deploymentID: text().references(() => deployments.deploymentID),
  eventID: text(),
  eventStart: text(),
  scientificName: text(),
  confidence: real(),
  count: integer().default(1),
  prediction: text()
})
