# Drizzle ORM Migration Guide

This document explains how to work with Drizzle ORM migrations in the Biowatch application.

## Overview

Biowatch uses Drizzle ORM with a **per-study database architecture**. Each study has its own SQLite database file located at `biowatch-data/studies/{studyId}/study.db`. Migrations are automatically applied when a study database is first accessed or when new migrations are available.

## Project Structure

```
src/main/db/
├── schema.js           # Table definitions
├── manager.js          # Database connection management
├── index.js           # Main database interface
└── migrations/        # Generated migration files
    ├── 0000_initial.sql
    ├── 0001_add_column.sql
    └── meta/
        ├── _journal.json
        └── 0000_snapshot.json
```

## Adding a New Migration

### Step 1: Modify the Schema

Edit `src/main/db/schema.js` to add your changes:

```javascript
import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core'

export const deployments = sqliteTable('deployments', {
  deploymentID: text('deploymentID').primaryKey(),
  locationID: text('locationID'),
  locationName: text('locationName'),
  deploymentStart: text('deploymentStart'),
  deploymentEnd: text('deploymentEnd'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  // NEW: Add a new column
  timezone: text('timezone')
})

// NEW: Add a new table
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value'),
  createdAt: text('createdAt').default('CURRENT_TIMESTAMP')
})
```

### Step 2: Generate the Migration

Run the Drizzle Kit command to generate a new migration:

```bash
# Generate with auto-generated name (e.g., 0001_green_falcon.sql)
npx drizzle-kit generate

# Generate with custom name
npx drizzle-kit generate --name initial
npx drizzle-kit generate --name add_timezone_column
npx drizzle-kit generate --name create_settings_table
```

This will:
- Analyze the schema changes
- Create a new migration file in `src/main/db/migrations/` 
- If using `--name`, creates `0001_initial.sql` instead of auto-generated name
- Update the migration metadata in `meta/_journal.json`

**Important**: Do NOT manually rename migration files after generation. The file name must match exactly what's recorded in `meta/_journal.json`, otherwise Drizzle won't be able to find and apply the migration. Always use the `--name` flag if you want custom names.

### Step 3: Update Exports (if adding new tables)

If you added new tables, export them from `src/main/db/schema.js`:

```javascript
// Export all tables
export const deployments = sqliteTable(...)
export const media = sqliteTable(...)
export const observations = sqliteTable(...)
export const settings = sqliteTable(...)  // NEW
```

And update the imports in `src/main/db/index.js`:

```javascript
import { deployments, media, observations, settings } from './schema.js'

// Re-export schema
export { deployments, media, observations, settings }
```

### Step 4: Test the Migration

The migration will be automatically applied when:
1. A study database is first accessed
2. The app restarts and accesses existing study databases

Test by:
```bash
npm run dev
# Open a study - migrations will be applied automatically
```

## Migration Examples

### Adding a Column

```javascript
// Before
export const deployments = sqliteTable('deployments', {
  deploymentID: text('deploymentID').primaryKey(),
  locationID: text('locationID'),
  // ...
})

// After
export const deployments = sqliteTable('deployments', {
  deploymentID: text('deploymentID').primaryKey(),
  locationID: text('locationID'),
  timezone: text('timezone'),  // NEW COLUMN
  // ...
})
```

### Adding a New Table

```javascript
export const userPreferences = sqliteTable('user_preferences', {
  id: integer('id').primaryKey(),
  userId: text('userId').notNull(),
  theme: text('theme').default('light'),
  language: text('language').default('en'),
  createdAt: text('createdAt').default('CURRENT_TIMESTAMP')
})
```

### Adding Indexes

```javascript
import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'

export const observations = sqliteTable('observations', {
  // ... columns
}, (table) => ({
  scientificNameIdx: index('scientific_name_idx').on(table.scientificName),
  eventStartIdx: index('event_start_idx').on(table.eventStart)
}))
```

### Adding Foreign Keys

```javascript
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey(),
  observationId: text('observationId').references(() => observations.observationID),
  content: text('content').notNull(),
  createdAt: text('createdAt').default('CURRENT_TIMESTAMP')
})
```

## Using New Schema in Queries

After adding new tables/columns, use them in your query functions:

```javascript
import { getDrizzleDb, deployments, settings } from './db/index.js'
import { eq } from 'drizzle-orm'

export async function getStudySettings(dbPath) {
  const pathParts = dbPath.split('/')
  const studyId = pathParts[pathParts.length - 2] || 'unknown'
  
  const db = await getDrizzleDb(studyId, dbPath)
  
  return await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'study_config'))
}
```

## Migration Workflow

1. **Development**: Make schema changes and generate migrations
2. **Testing**: Migrations are applied automatically when accessing studies
3. **Production**: When users update the app, migrations run on first database access

## Important Notes

### Per-Study Migration

- Each study database is migrated **independently**
- Migrations are applied the first time a study is accessed after an app update
- Different studies can be at different migration states

### No Rollbacks

- This project uses **forward-only migrations**
- There's no backward compatibility support
- Plan schema changes carefully

### Data Migration

For complex data transformations, you may need to write custom migration logic:

```javascript
// In your migration SQL file (generated by drizzle-kit)
-- Add the column first
ALTER TABLE deployments ADD COLUMN timezone TEXT;

-- You might need to add custom data transformation logic
-- in a separate function called after migration
```

### Testing Migrations

```bash
# Test with a specific study
npm run dev
# Navigate to a study to trigger migration

# Check migration status in logs
# Look for: "[DB] Running migrations from ..." messages
```

## Configuration

The Drizzle configuration is in `drizzle.config.js`:

```javascript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/main/db/schema.js',      // Schema location
  out: './src/main/db/migrations',        // Migration output
  dialect: 'sqlite',                      // Database type
  verbose: true,                          // Detailed output
  strict: true                            // Strict mode
})
```

## Troubleshooting

### Migration Fails

Check the logs for detailed error messages:
```
[DB] Migration failed for study studyId: Error details...
```

### "No migrations folder found" Error

If you see this message but migration files exist:

1. **Check file names**: Ensure migration file names match the `meta/_journal.json` entries exactly
2. **Example**: If journal shows `"tag": "0000_sturdy_nightcrawler"`, the file must be named `0000_sturdy_nightcrawler.sql`
3. **Fix options**:
   - **Option A**: Rename the file to match the journal entry
   - **Option B**: Regenerate with custom name:
     ```bash
     # Remove current migration files
     rm -rf src/main/db/migrations/*
     # Regenerate with custom name
     npx drizzle-kit generate --name initial
     ```

### Schema Changes Not Detected

1. Ensure you saved `schema.js`
2. Run `npx drizzle-kit generate` again
3. Check that the schema change is significant enough to warrant a migration

### Database Locked

If you get database locked errors:
1. Close the Electron app completely
2. Restart and try again
3. Check that no other processes are accessing the database files

## Best Practices

1. **Test schema changes thoroughly** before generating migrations
2. **Make incremental changes** rather than large schema overhauls
3. **Document breaking changes** in your commit messages
4. **Consider data impact** when removing or renaming columns
5. **Use descriptive column names** and appropriate data types

## Resources

- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [Drizzle Kit Migrations](https://orm.drizzle.team/kit-docs/overview)
- [SQLite Data Types](https://www.sqlite.org/datatype3.html)