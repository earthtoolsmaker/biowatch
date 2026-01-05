import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/main/database/models.js',
  out: './src/main/database/migrations',
  dialect: 'sqlite',
  verbose: true,
  strict: true
})
