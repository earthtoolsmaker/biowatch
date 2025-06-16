import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'
import { deployments } from './deployments'

export const media = sqliteTable('media', {
  mediaID: text().primaryKey(),
  deploymentID: text().references(() => deployments.deploymentID),
  timestamp: text(),
  filePath: text(),
  fileName: real()
})
