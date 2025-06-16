# Biowatch Migration System

This directory contains the migration system for Biowatch, which handles schema and file system changes between versions.

## Overview

The migration system allows the app to automatically update user data when the structure changes between versions. Currently, it handles the migration from a flat database file structure to an organized folder structure.

### File Structure

```
src/main/migrations/
├── index.js                          # Core migration engine
├── migrations.js                     # Migration registration and exports
├── study-path-utils.js              # Utilities for handling database paths
├── v1.0.15-filesystem-restructure.js # Specific migration for file system restructure
├── example-usage.js                 # Usage examples
├── test/
│   └── migrations.test.js           # Comprehensive tests
├── package.json                     # Test dependencies
└── README.md                        # This file
```

## Migration Overview

### From (Old Structure)
```
userData/
├── study1.db
├── study2.db
├── study3.db
├── model-zoo/
│   ├── manifest.yaml
│   └── archives/
└── python-environments/
    └── conda/
        └── manifest.yaml
```

### To (New Structure)
```
userData/
└── biowatch-data/
    ├── studies/
    │   ├── study1/
    │   │   └── study.db
    │   ├── study2/
    │   │   └── study.db
    │   └── study3/
    │       └── study.db
    ├── model-zoo/
    │   ├── manifest.yaml
    │   └── archives/
    └── python-environments/
        └── conda/
            └── manifest.yaml
```

## Usage

### Basic Usage

```javascript
import './migrations/migrations.js' // Register migrations
import {
  runMigrations,
  isMigrationNeeded,
  getStudyDatabasePath
} from './migrations/migrations.js'

// Check if migration is needed
const needsMigration = await isMigrationNeeded()

if (needsMigration) {
  // Run migrations
  await runMigrations()
}

// Get database path (works with both old and new structures)
const dbPath = getStudyDatabasePath('my-study-id')
```

### App Integration

```javascript
import { initializeApp } from './migrations/example-usage.js'

// Call this early in your app startup
await initializeApp()
```

### Path Utilities

The migration system provides utilities that work across both old and new structures:

```javascript
import {
  getStudyDatabasePath,      // Find existing database
  getNewStudyDatabasePath,   // Path for new database
  getStudyDirectoryPath,     // Study directory (creates if needed)
  studyExists,               // Check if study exists
  listAllStudies,            // List all available studies
  deleteStudy                // Delete a study
} from './migrations/migrations.js'

// Examples
const dbPath = getStudyDatabasePath('study-123')
const allStudies = listAllStudies()
const newDbPath = getNewStudyDatabasePath('new-study')
```

## API Reference

### Core Migration Functions

#### `runMigrations(): Promise<void>`
Runs all pending migrations in order.

#### `isMigrationNeeded(): Promise<boolean>`
Checks if any migrations need to be run.

#### `getMigrationStatus(): Promise<Object>`
Returns detailed migration status:
```javascript
{
  currentVersion: 'v1.0.14',
  latestVersion: 'v1.0.15',
  needsMigration: true,
  availableMigrations: ['v1.0.15']
}
```

#### `rollbackToVersion(version): Promise<void>`
Rolls back to a specific version (if rollback is supported).

### Path Utility Functions

#### `getStudyDatabasePath(studyId): string|null`
Returns the path to an existing study database, checking both old and new locations.

#### `getNewStudyDatabasePath(studyId): string`
Returns the path where a new study database should be created (always uses new structure).

#### `getStudyDirectoryPath(studyId): string`
Returns the study directory path, creating it if it doesn't exist.

#### `studyExists(studyId): boolean`
Checks if a study exists in either old or new structure.

#### `listAllStudies(): Array<string>`
Returns an array of all available study IDs from both structures.

#### `deleteStudy(studyId): boolean`
Deletes a study database, returns true if successful.

## Creating New Migrations

To create a new migration:

1. Create a new file: `v1.0.16-my-migration.js`
2. Export a migration object:

```javascript
export const myMigration = {
  version: 'v1.0.16',
  description: 'Description of what this migration does',

  async up(userDataPath) {
    // Migration logic here
  },

  async down(userDataPath) {
    // Rollback logic here (optional)
  }
}
```

3. Register it in `migrations.js`:

```javascript
import { myMigration } from './v1.0.16-my-migration.js'
registerMigration(myMigration.version, myMigration)
```

## Testing

Run the tests with:

```bash
cd src/main/migrations
npm install
npm test
```

Tests cover:
- Migration detection
- Migration execution
- Rollback functionality
- Path utilities
- Edge cases and error handling

## Error Handling

The migration system includes comprehensive error handling:

- Failed migrations are logged and throw errors
- Partial migrations are handled gracefully
- Rollback functionality is available for supported migrations
- File system errors are caught and reported

## Version Management

The system tracks the current migration version in a `.biowatch-version` file in the userData directory. This allows the system to:

- Skip migrations that have already been run
- Run only new migrations
- Support rollbacks to previous versions

## Backward Compatibility

The path utilities maintain backward compatibility by:

- Checking new structure first, then falling back to old
- Supporting both structures simultaneously during transition
- Providing consistent APIs regardless of underlying structure

This ensures the app continues to work with existing databases while new databases use the improved structure.
