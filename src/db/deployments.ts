import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core'
import { devices } from './devices'

export const deployments = sqliteTable('deployments', {
  deploymentID: text().primaryKey(),
  locationID: text(),
  locationName: text(),
  deploymentStart: text().notNull(),
  deploymentEnd: text().notNull(),
  latitude: real().notNull(),
  longitude: real().notNull(),
  deviceID: text().references(() => devices.deviceID)
})
