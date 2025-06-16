import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'

export const deployments = sqliteTable('deployments', {
  deploymentID: text().primaryKey(),
  locationID: text(),
  locationName: text(),
  deploymentStart: text(),
  latitude: real(),
  longitude: real()
})
