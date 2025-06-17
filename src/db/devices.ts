import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const devices = sqliteTable('devices', {
  deviceID: text().primaryKey(),
  type: text().notNull().default('camera'),
  reference: text()
})
