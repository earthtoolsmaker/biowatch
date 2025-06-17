import { sql } from 'drizzle-orm'
import { check, sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core'
import { deployments } from './deployments'
import { media } from './media'

enum ObservationType {
  ANIMAL = 'animal',
  HUMAN = 'human',
  BLANK = 'blank',
  VEHICLE = 'vehicle',
  UNCLASSIFIED = 'unclassified'
}

export const observations = sqliteTable(
  'observations',
  {
    observationID: text().notNull().primaryKey(),
    mediaID: text()
      .notNull()
      .references(() => media.mediaID),
    deploymentID: text()
      .notNull()
      .references(() => deployments.deploymentID),
    eventID: text(),
    eventStart: text(),
    observationType: text().notNull().default(ObservationType.UNCLASSIFIED),
    observationLevel: text().notNull().default('media'),
    scientificName: text(),
    confidence: real(),
    count: integer().default(1),
    prediction: text()
  },
  (table) => [
    check('confidence_range', sql`${table.confidence} <= 1 AND ${table.confidence} >= 0`),
    check('count_gt_1', sql`${table.count} >= 1`),
    check(
      'observation_type_enum',
      sql`${table.observationType} IN (${ObservationType.ANIMAL}, ${ObservationType.HUMAN}, ${ObservationType.BLANK}, ${ObservationType.VEHICLE}, ${ObservationType.UNCLASSIFIED})`
    )
  ]
)
