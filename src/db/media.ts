import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'
import { deployments } from './deployments'

export const media = sqliteTable('media', {
  mediaID: text().notNull().primaryKey(),
  deploymentID: text()
    .notNull()
    .references(() => deployments.deploymentID),
  timestamp: text().notNull(),
  filePath: text().notNull(),
  fileMediaType: text().notNull().default('image/jpeg'),
  fileName: real().notNull(),
  exifData: text({ mode: 'json' })
})
