import { sql } from 'drizzle-orm'
import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'
import { media } from './media'
import { observations } from './observations'

export const annotations = sqliteTable('annotations', {
  observationID: text().notNull().primaryKey(),
  mediaID: text().references(() => media.mediaID),
  eventID: text().references(() => observations.eventID),
  annotationLevel: text(),
  bboxX: real(),
  bboxY: real(),
  bboxWidth: real(),
  bboxHeight: real(),
  confidence: real(),
  prediction: text(),
  createdAt: text()
    .notNull()
    .default(sql`(current_timestamp)`),
  createdBy: text()
})
