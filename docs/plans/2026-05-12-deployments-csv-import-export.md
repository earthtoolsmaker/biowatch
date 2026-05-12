# Deployments CSV import/export — Implementation Plan

**Goal:** Add CSV export/import in the Deployments tab so users can bulk-edit `latitude`, `longitude`, and `locationName` for many deployments at once. Includes a preview-table modal with cell-level error highlighting.

**Architecture:** Three pure main-process modules (parse, apply, export) plus one IPC handler module that wires them up. Two new renderer components (`DeploymentsCsvMenu`, `DeploymentsImportPreviewModal`) mounted into `deployments.jsx`'s timeline header. Apply runs as a single SQLite transaction. Renderer is stateless wrt validation — it just renders the preview payload main produces.

**Tech Stack:** Node `csv-parser` (already dep), Drizzle ORM transactions on `better-sqlite3`, React 18 + TanStack Query + virtualization, Tailwind, `lucide-react`. Tests use `node:test` + `node:assert/strict` (no new tooling).

**Spec:** [`docs/specs/2026-05-12-deployments-csv-import-export-design.md`](../specs/2026-05-12-deployments-csv-import-export-design.md). Read it before starting — every decision below traces to a numbered section there.

---

## File Map

| Path | New / Modify | Responsibility |
| --- | --- | --- |
| `src/main/services/export/deploymentsCsv.js` | new | Render deployments → CSV string. Pure. |
| `src/main/services/import/parsers/deploymentsCsv.js` | new | Read CSV file + DB deployments map → preview payload. Pure (no DB writes). |
| `src/main/services/import/applyDeploymentsCsv.js` | new | Single-transaction apply of validated plan. Drizzle. |
| `src/main/ipc/deploymentsCsv.js` | new | Three IPC handlers + save/open dialog wiring. |
| `src/main/ipc/index.js` | modify | Register the new module. |
| `src/preload/index.js` | modify | Expose 3 IPC methods + open-file helper. |
| `src/renderer/src/deployments/DeploymentsImportPreviewModal.jsx` | new | The preview-table modal (stateless renderer of preview payload). |
| `src/renderer/src/deployments/DeploymentsCsvActions.jsx` | new | Two flat buttons (Export / Import) + import flow state owner. |
| `src/renderer/src/deployments.jsx` | modify | Mount an always-visible header strip above the conditional timeline header, containing `<DeploymentsCsvActions />`. |
| `test/main/services/export/deploymentsCsv.test.js` | new | CSV-render unit tests. |
| `test/main/services/import/parsers/deploymentsCsv.test.js` | new | Parse + validate unit tests. |
| `test/main/services/import/applyDeploymentsCsv.test.js` | new | Apply integration tests (temp SQLite). |
| `docs/ipc-api.md` | modify | Document 3 new handlers. |
| `docs/import-export.md` | modify | Add "Deployments CSV" section. |
| `docs/data-formats.md` | modify | Document CSV column shape. |

---

## Task 1: Export module — pure CSV renderer

Build the pure function that turns an array of deployment rows into a CSV string. No file I/O, no Electron, no DB — just `(rows) → string`. Easy to test exhaustively.

**Files:**
- Create: `src/main/services/export/deploymentsCsv.js`
- Test: `test/main/services/export/deploymentsCsv.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/main/services/export/deploymentsCsv.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderDeploymentsCsv } from '../../../../src/main/services/export/deploymentsCsv.js'

describe('renderDeploymentsCsv', () => {
  test('renders header row even for empty input', () => {
    const csv = renderDeploymentsCsv([])
    assert.equal(csv, 'deploymentID,locationID,locationName,latitude,longitude\n')
  })

  test('renders a single row with all fields', () => {
    const csv = renderDeploymentsCsv([
      {
        deploymentID: 'CAM_001',
        locationID: 'LOC_A',
        locationName: 'Ridge',
        latitude: 45.234,
        longitude: 6.812
      }
    ])
    assert.equal(
      csv,
      'deploymentID,locationID,locationName,latitude,longitude\nCAM_001,LOC_A,Ridge,45.234,6.812\n'
    )
  })

  test('emits empty cells for null DB values', () => {
    const csv = renderDeploymentsCsv([
      { deploymentID: 'A01', locationID: 'A01', locationName: null, latitude: null, longitude: null }
    ])
    assert.equal(
      csv,
      'deploymentID,locationID,locationName,latitude,longitude\nA01,A01,,,\n'
    )
  })

  test('quotes values containing commas, quotes, or newlines', () => {
    const csv = renderDeploymentsCsv([
      {
        deploymentID: 'CAM_002',
        locationID: 'LOC_B',
        locationName: 'Ridge, South',
        latitude: 45.0,
        longitude: 6.0
      }
    ])
    assert.ok(csv.includes('"Ridge, South"'))
  })

  test('preserves synthesized biowatch-geo: locationID prefix', () => {
    const csv = renderDeploymentsCsv([
      {
        deploymentID: 'CAM_001',
        locationID: 'biowatch-geo:45.2340,6.8120',
        locationName: null,
        latitude: 45.234,
        longitude: 6.812
      }
    ])
    assert.ok(csv.includes('biowatch-geo:45.2340,6.8120'))
  })

  test('preserves caller-provided row order', () => {
    const csv = renderDeploymentsCsv([
      { deploymentID: 'B', locationID: 'L', locationName: null, latitude: null, longitude: null },
      { deploymentID: 'A', locationID: 'L', locationName: null, latitude: null, longitude: null }
    ])
    const lines = csv.trim().split('\n')
    assert.equal(lines[1].split(',')[0], 'B')
    assert.equal(lines[2].split(',')[0], 'A')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern='renderDeploymentsCsv'`
Expected: FAIL with `Cannot find module … deploymentsCsv.js`.

- [ ] **Step 3: Implement the renderer**

```js
// src/main/services/export/deploymentsCsv.js

const COLUMNS = ['deploymentID', 'locationID', 'locationName', 'latitude', 'longitude']

function escapeCSV(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

/**
 * Render an array of deployment rows to a CSV string with the canonical
 * deployments-CSV header. Preserves caller-provided row order. Null/undefined
 * cells become empty strings. Synthesized `biowatch-geo:` locationIDs are
 * emitted as-is (round-trip stability — different from the CamtrapDP export
 * which strips that prefix for spec compliance).
 *
 * @param {Array<{ deploymentID, locationID, locationName, latitude, longitude }>} rows
 * @returns {string} CSV including trailing newline.
 */
export function renderDeploymentsCsv(rows) {
  const header = COLUMNS.join(',')
  const lines = rows.map((row) => COLUMNS.map((col) => escapeCSV(row[col])).join(','))
  return header + '\n' + (lines.length ? lines.join('\n') + '\n' : '')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern='renderDeploymentsCsv'`
Expected: all 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/export/deploymentsCsv.js test/main/services/export/deploymentsCsv.test.js
git commit -m "feat(deployments-csv): pure CSV renderer for export"
```

---

## Task 2: Parser module — header + happy path

Build the parser entry point. Stream the CSV, validate the header, and produce a preview payload for the happy path (every row already exists in DB, every cell unchanged). Validation logic comes in Task 3.

**Files:**
- Create: `src/main/services/import/parsers/deploymentsCsv.js`
- Test: `test/main/services/import/parsers/deploymentsCsv.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/main/services/import/parsers/deploymentsCsv.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseDeploymentsCsv
} from '../../../../../src/main/services/import/parsers/deploymentsCsv.js'

function withTempCsv(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dep-csv-'))
  const file = join(dir, 'in.csv')
  writeFileSync(file, content, 'utf8')
  try {
    return fn(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const dbRows = [
  { deploymentID: 'CAM_001', locationID: 'LOC_A', locationName: 'Ridge', latitude: 45.234, longitude: 6.812 },
  { deploymentID: 'CAM_002', locationID: 'LOC_A', locationName: 'Ridge', latitude: 45.241, longitude: 6.812 }
]

describe('parseDeploymentsCsv — header', () => {
  test('rejects CSV without deploymentID column', async () => {
    await withTempCsv('locationID,latitude\nLOC_A,45.0\n', async (file) => {
      const result = await parseDeploymentsCsv(file, dbRows)
      assert.equal(result.error, "Required column 'deploymentID' not found in CSV.")
    })
  })

  test('ignores unknown columns', async () => {
    const csv = 'deploymentID,foo,latitude\nCAM_001,bar,45.234\n'
    await withTempCsv(csv, async (file) => {
      const result = await parseDeploymentsCsv(file, dbRows)
      assert.equal(result.error, undefined)
      assert.equal(result.totalRows, 1)
    })
  })
})

describe('parseDeploymentsCsv — happy path', () => {
  test('all matching rows with identical values → all cells unchanged, applyCount=0', async () => {
    const csv =
      'deploymentID,locationID,locationName,latitude,longitude\n' +
      'CAM_001,LOC_A,Ridge,45.234,6.812\n' +
      'CAM_002,LOC_A,Ridge,45.241,6.812\n'
    await withTempCsv(csv, async (file) => {
      const result = await parseDeploymentsCsv(file, dbRows)
      assert.equal(result.totalRows, 2)
      assert.equal(result.applyCount, 0)
      assert.equal(result.cellWarningCount, 0)
      assert.equal(result.rowSkipCount, 0)
      assert.equal(result.rows[0].columns.latitude.state, 'unchanged')
      assert.equal(result.rows[0].columns.locationName.state, 'unchanged')
    })
  })

  test('empty cells classified as unchanged', async () => {
    const dbRowsWithNulls = [
      { deploymentID: 'A01', locationID: 'A01', locationName: 'A01', latitude: null, longitude: null }
    ]
    const csv = 'deploymentID,locationID,locationName,latitude,longitude\nA01,A01,A01,,\n'
    await withTempCsv(csv, async (file) => {
      const result = await parseDeploymentsCsv(file, dbRowsWithNulls)
      assert.equal(result.rows[0].columns.latitude.state, 'unchanged')
      assert.equal(result.rows[0].columns.longitude.state, 'unchanged')
      assert.equal(result.applyCount, 0)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern='parseDeploymentsCsv — header'`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the parser (header + happy path only)**

```js
// src/main/services/import/parsers/deploymentsCsv.js
import fs from 'fs'
import csv from 'csv-parser'

const COORD_EPSILON = 1e-9

function readonlyEqual(csvValue, dbValue) {
  if (csvValue === '' || csvValue == null) return true
  return String(csvValue) === String(dbValue ?? '')
}

function textCellState(csvValue, dbValue) {
  // Empty CSV cell = leave alone = unchanged
  if (csvValue === '' || csvValue == null) {
    return { state: 'unchanged', csvValue: '', dbValue: dbValue ?? null }
  }
  const trimmed = String(csvValue).trim()
  if (trimmed === String(dbValue ?? '').trim()) {
    return { state: 'unchanged', csvValue: trimmed, dbValue: dbValue ?? null }
  }
  return { state: 'change', csvValue: trimmed, dbValue: dbValue ?? null, appliedValue: trimmed }
}

function numericCellState(csvValue, dbValue, { min, max, label }) {
  if (csvValue === '' || csvValue == null) {
    return { state: 'unchanged', csvValue: '', dbValue: dbValue ?? null }
  }
  const raw = String(csvValue).trim()
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    return {
      state: 'warning',
      csvValue: raw,
      dbValue: dbValue ?? null,
      warning: `'${raw}' is not a valid number.`
    }
  }
  if (n < min || n > max) {
    return {
      state: 'warning',
      csvValue: raw,
      dbValue: dbValue ?? null,
      warning: `${label} ${n} is outside [${min}, ${max}].`
    }
  }
  if (dbValue != null && Math.abs(n - Number(dbValue)) < COORD_EPSILON) {
    return { state: 'unchanged', csvValue: raw, dbValue: Number(dbValue) }
  }
  return { state: 'change', csvValue: raw, dbValue: dbValue ?? null, appliedValue: n }
}

function readonlyCellState(csvValue, dbValue, label) {
  if (csvValue === '' || csvValue == null) {
    return { state: 'readonly', csvValue: '', dbValue: dbValue ?? null }
  }
  if (readonlyEqual(csvValue, dbValue)) {
    return { state: 'readonly', csvValue: String(csvValue).trim(), dbValue: dbValue ?? null }
  }
  return {
    state: 'warning',
    csvValue: String(csvValue).trim(),
    dbValue: dbValue ?? null,
    warning: `${label} is read-only. Existing value will be kept; CSV value ignored.`
  }
}

async function readCsvRows(filePath) {
  return new Promise((resolve, reject) => {
    const rows = []
    let headers = null
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('headers', (h) => {
        headers = h
      })
      .on('data', (data) => rows.push(data))
      .on('end', () => resolve({ rows, headers: headers ?? [] }))
      .on('error', reject)
  })
}

/**
 * Parse a deployments CSV and classify every cell against the current DB
 * state. Pure: reads the CSV, never writes.
 *
 * @param {string} filePath - absolute path to the .csv file.
 * @param {Array} dbDeployments - current rows from the deployments table.
 * @returns {Promise<object>} preview payload (see spec §Preview payload schema)
 *   or `{ error }` for a hard parse failure.
 */
export async function parseDeploymentsCsv(filePath, dbDeployments) {
  const { rows, headers } = await readCsvRows(filePath)

  if (!headers.includes('deploymentID')) {
    return { error: "Required column 'deploymentID' not found in CSV." }
  }

  const dbByID = new Map()
  for (const d of dbDeployments) dbByID.set(d.deploymentID, d)

  let applyCount = 0
  let cellWarningCount = 0
  let rowSkipCount = 0

  const previewRows = rows.map((rawRow, index) => {
    const rowIndex = index + 1
    const deploymentID = (rawRow.deploymentID ?? '').trim()
    const dbRow = deploymentID ? dbByID.get(deploymentID) : null

    if (!deploymentID) {
      rowSkipCount++
      return {
        rowIndex,
        deploymentID: '',
        rowState: 'skipped',
        rowWarning: 'deploymentID is required.',
        columns: {
          deploymentID: { state: 'readonly', csvValue: '', dbValue: null },
          locationID: { state: 'readonly', csvValue: rawRow.locationID ?? '', dbValue: null },
          locationName: { state: 'readonly', csvValue: rawRow.locationName ?? '', dbValue: null },
          latitude: { state: 'readonly', csvValue: rawRow.latitude ?? '', dbValue: null },
          longitude: { state: 'readonly', csvValue: rawRow.longitude ?? '', dbValue: null }
        }
      }
    }

    if (!dbRow) {
      rowSkipCount++
      return {
        rowIndex,
        deploymentID,
        rowState: 'skipped',
        rowWarning: 'No deployment with this ID in the study.',
        columns: {
          deploymentID: { state: 'readonly', csvValue: deploymentID, dbValue: null },
          locationID: { state: 'readonly', csvValue: rawRow.locationID ?? '', dbValue: null },
          locationName: { state: 'readonly', csvValue: rawRow.locationName ?? '', dbValue: null },
          latitude: { state: 'readonly', csvValue: rawRow.latitude ?? '', dbValue: null },
          longitude: { state: 'readonly', csvValue: rawRow.longitude ?? '', dbValue: null }
        }
      }
    }

    const columns = {
      deploymentID: { state: 'readonly', csvValue: deploymentID, dbValue: dbRow.deploymentID },
      locationID: readonlyCellState(rawRow.locationID, dbRow.locationID, 'locationID'),
      locationName: textCellState(rawRow.locationName, dbRow.locationName),
      latitude: numericCellState(rawRow.latitude, dbRow.latitude, {
        min: -90,
        max: 90,
        label: 'Latitude'
      }),
      longitude: numericCellState(rawRow.longitude, dbRow.longitude, {
        min: -180,
        max: 180,
        label: 'Longitude'
      })
    }

    const hasChange = ['locationName', 'latitude', 'longitude'].some(
      (k) => columns[k].state === 'change'
    )
    if (hasChange) applyCount++

    for (const k of Object.keys(columns)) {
      if (columns[k].state === 'warning') cellWarningCount++
    }

    return {
      rowIndex,
      deploymentID,
      rowState: 'normal',
      rowWarning: null,
      columns
    }
  })

  return {
    filePath,
    fileName: filePath.split(/[/\\]/).pop(),
    totalRows: rows.length,
    applyCount,
    cellWarningCount,
    rowSkipCount,
    rows: previewRows
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern='parseDeploymentsCsv'`
Expected: 4 tests pass (2 from "header", 2 from "happy path").

- [ ] **Step 5: Commit**

```bash
git add src/main/services/import/parsers/deploymentsCsv.js test/main/services/import/parsers/deploymentsCsv.test.js
git commit -m "feat(deployments-csv): parser header + happy-path"
```

---

## Task 3: Parser module — validation rules

Add the remaining validation passes: out-of-range coords, non-numeric coords, unknown deploymentID (already partially in place), locationID mismatch (already in place), duplicate deploymentID rows in CSV, intra-locationID name conflicts. The cell-state helper functions from Task 2 already handle most of these; we mainly need the duplicate and name-conflict passes.

**Files:**
- Modify: `src/main/services/import/parsers/deploymentsCsv.js`
- Modify: `test/main/services/import/parsers/deploymentsCsv.test.js`

- [ ] **Step 1: Write failing tests for the per-cell rules already implemented**

Append to `test/main/services/import/parsers/deploymentsCsv.test.js`:

```js
describe('parseDeploymentsCsv — per-cell validation', () => {
  const dbRows = [
    { deploymentID: 'CAM_001', locationID: 'LOC_A', locationName: 'Ridge', latitude: 45.234, longitude: 6.812 },
    { deploymentID: 'CAM_002', locationID: 'LOC_A', locationName: 'Ridge', latitude: 45.241, longitude: 6.812 }
  ]

  test('latitude > 90 → warning', async () => {
    const csv = 'deploymentID,latitude\nCAM_001,91.5\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.latitude.state, 'warning')
      assert.match(r.rows[0].columns.latitude.warning, /outside \[-90, 90\]/)
      assert.equal(r.cellWarningCount, 1)
      assert.equal(r.applyCount, 0)
    })
  })

  test('longitude < -180 → warning', async () => {
    const csv = 'deploymentID,longitude\nCAM_001,-181\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.longitude.state, 'warning')
    })
  })

  test('non-numeric latitude → warning', async () => {
    const csv = 'deploymentID,latitude\nCAM_001,abc\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.latitude.state, 'warning')
      assert.match(r.rows[0].columns.latitude.warning, /not a valid number/)
    })
  })

  test('locationID mismatch → warning', async () => {
    const csv =
      'deploymentID,locationID,locationName,latitude,longitude\nCAM_001,LOC_X,Ridge,45.234,6.812\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.locationID.state, 'warning')
      assert.match(r.rows[0].columns.locationID.warning, /read-only/)
    })
  })

  test('unknown deploymentID → row skipped', async () => {
    const csv = 'deploymentID,latitude\nCAM_NEW,45.0\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].rowState, 'skipped')
      assert.match(r.rows[0].rowWarning, /No deployment with this ID/)
      assert.equal(r.rowSkipCount, 1)
      assert.equal(r.applyCount, 0)
    })
  })

  test('valid change → state=change, applyCount=1', async () => {
    const csv = 'deploymentID,latitude\nCAM_001,45.5\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.latitude.state, 'change')
      assert.equal(r.rows[0].columns.latitude.appliedValue, 45.5)
      assert.equal(r.applyCount, 1)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify the per-cell rules already pass**

Run: `npm test -- --test-name-pattern='per-cell validation'`
Expected: all 6 pass (logic was added in Task 2).

- [ ] **Step 3: Write failing tests for duplicates and name conflicts**

Append:

```js
describe('parseDeploymentsCsv — duplicates & name conflicts', () => {
  const dbRows = [
    { deploymentID: 'CAM_001', locationID: 'LOC_A', locationName: 'Ridge', latitude: 45.0, longitude: 6.0 },
    { deploymentID: 'CAM_002', locationID: 'LOC_A', locationName: 'Ridge', latitude: 45.0, longitude: 6.0 }
  ]

  test('duplicate deploymentID rows in CSV → last wins, earlier change cells become warning', async () => {
    const csv =
      'deploymentID,latitude\nCAM_001,45.10\nCAM_001,45.20\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.latitude.state, 'warning')
      assert.match(r.rows[0].columns.latitude.warning, /Overridden by row 2 below/)
      assert.equal(r.rows[1].columns.latitude.state, 'change')
      assert.equal(r.rows[1].columns.latitude.appliedValue, 45.2)
      assert.equal(r.applyCount, 1)
    })
  })

  test('intra-locationID name conflict → last wins, earlier name cells become warning', async () => {
    const csv =
      'deploymentID,locationID,locationName\nCAM_001,LOC_A,Ridge South\nCAM_002,LOC_A,Ridge North\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.locationName.state, 'warning')
      assert.match(r.rows[0].columns.locationName.warning, /Conflicting names for LOC_A/)
      assert.equal(r.rows[1].columns.locationName.state, 'change')
      assert.equal(r.applyCount, 1)
    })
  })

  test('intra-locationID names that agree → both rows count as change', async () => {
    const csv =
      'deploymentID,locationID,locationName\nCAM_001,LOC_A,Ridge X\nCAM_002,LOC_A,Ridge X\n'
    await withTempCsv(csv, async (file) => {
      const r = await parseDeploymentsCsv(file, dbRows)
      assert.equal(r.rows[0].columns.locationName.state, 'change')
      assert.equal(r.rows[1].columns.locationName.state, 'change')
      assert.equal(r.applyCount, 2)
    })
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern='duplicates & name conflicts'`
Expected: 3 tests fail — current parser does no post-pass deduplication or name-conflict detection.

- [ ] **Step 5: Add the post-passes to the parser**

Edit `src/main/services/import/parsers/deploymentsCsv.js`. Add this block **after** the main `previewRows = rows.map(...)` call but **before** the cell-warning-count tally. (We re-tally counts at the end.)

Find:

```js
const previewRows = rows.map((rawRow, index) => {
  // ... existing classification ...
})

return {
  filePath,
  // ...
}
```

Replace the post-classification section with:

```js
const previewRows = rows.map((rawRow, index) => {
  // ... existing classification (unchanged) ...
})

// --- Post-pass 1: duplicate deploymentID rows in CSV → last wins ---
const lastIndexByDeploymentID = new Map()
previewRows.forEach((row, i) => {
  if (row.rowState !== 'normal') return
  lastIndexByDeploymentID.set(row.deploymentID, i)
})
previewRows.forEach((row, i) => {
  if (row.rowState !== 'normal') return
  const lastIndex = lastIndexByDeploymentID.get(row.deploymentID)
  if (lastIndex === i) return
  // This is an earlier duplicate. Convert every 'change' cell to 'warning'.
  for (const key of ['locationName', 'latitude', 'longitude']) {
    const col = row.columns[key]
    if (col.state === 'change') {
      row.columns[key] = {
        state: 'warning',
        csvValue: col.csvValue,
        dbValue: col.dbValue,
        warning: `Overridden by row ${lastIndex + 1} below.`
      }
    }
  }
})

// --- Post-pass 2: intra-locationID name conflicts → last-row-wins ---
// Group rows by their *DB* locationID (since CSV locationID is readonly).
const nameWinnerByLocationID = new Map()
previewRows.forEach((row, i) => {
  if (row.rowState !== 'normal') return
  const col = row.columns.locationName
  if (col.state !== 'change') return
  const locID = row.columns.locationID.dbValue
  if (!locID) return
  const prev = nameWinnerByLocationID.get(locID)
  if (!prev || prev.appliedValue === col.appliedValue) {
    nameWinnerByLocationID.set(locID, { rowIndex: i, appliedValue: col.appliedValue })
    return
  }
  nameWinnerByLocationID.set(locID, { rowIndex: i, appliedValue: col.appliedValue })
})

previewRows.forEach((row, i) => {
  if (row.rowState !== 'normal') return
  const col = row.columns.locationName
  if (col.state !== 'change') return
  const locID = row.columns.locationID.dbValue
  if (!locID) return
  const winner = nameWinnerByLocationID.get(locID)
  if (!winner) return
  if (winner.rowIndex === i) return
  if (winner.appliedValue === col.appliedValue) return
  row.columns.locationName = {
    state: 'warning',
    csvValue: col.csvValue,
    dbValue: col.dbValue,
    warning: `Conflicting names for ${locID}; row ${winner.rowIndex + 1} below wins.`
  }
})

// --- Re-tally counts after post-passes ---
let applyCount = 0
let cellWarningCount = 0
let rowSkipCount = 0
for (const row of previewRows) {
  if (row.rowState === 'skipped') {
    rowSkipCount++
    continue
  }
  const hasChange = ['locationName', 'latitude', 'longitude'].some(
    (k) => row.columns[k].state === 'change'
  )
  if (hasChange) applyCount++
  for (const k of Object.keys(row.columns)) {
    if (row.columns[k].state === 'warning') cellWarningCount++
  }
}

return {
  filePath,
  fileName: filePath.split(/[/\\]/).pop(),
  totalRows: rows.length,
  applyCount,
  cellWarningCount,
  rowSkipCount,
  rows: previewRows
}
```

Remove the now-redundant inline tally (`applyCount++`, `cellWarningCount++`, `rowSkipCount++`) from inside the per-row `.map(...)`. The re-tally at the end is authoritative.

- [ ] **Step 6: Run all parser tests**

Run: `npm test -- --test-name-pattern='parseDeploymentsCsv'`
Expected: all 13 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/import/parsers/deploymentsCsv.js test/main/services/import/parsers/deploymentsCsv.test.js
git commit -m "feat(deployments-csv): validation + duplicate/name-conflict post-passes"
```

---

## Task 4: Applier module — transactional apply

Single-transaction apply. Re-validates each value defensively. Takes a Drizzle `db` instance + apply plan; tests use a temp SQLite DB seeded via existing helpers.

**Files:**
- Create: `src/main/services/import/applyDeploymentsCsv.js`
- Test: `test/main/services/import/applyDeploymentsCsv.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/main/services/import/applyDeploymentsCsv.test.js
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'
import { eq } from 'drizzle-orm'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  getDrizzleDb,
  deployments
} from '../../../src/main/database/index.js'
import { applyDeploymentsCsv } from '../../../src/main/services/import/applyDeploymentsCsv.js'

let testStudyId
let testDbPath
let testBiowatchDataPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    /* ok */
  }
  testStudyId = `test-apply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-apply-csv-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'CAM_001',
      locationID: 'LOC_A',
      locationName: 'Ridge',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: null,
      longitude: null
    },
    d2: {
      deploymentID: 'CAM_002',
      locationID: 'LOC_A',
      locationName: 'Ridge',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: null,
      longitude: null
    },
    d3: {
      deploymentID: 'CAM_003',
      locationID: 'LOC_B',
      locationName: 'Slope',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: 10,
      longitude: 20
    }
  })
}

describe('applyDeploymentsCsv', () => {
  test('updates lat/lon for a single deployment', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    const summary = await applyDeploymentsCsv(db, [
      { deploymentID: 'CAM_001', fields: { latitude: 45.5, longitude: 6.5 } }
    ])

    assert.equal(summary.deploymentsUpdated, 1)
    const row = await db
      .select()
      .from(deployments)
      .where(eq(deployments.deploymentID, 'CAM_001'))
    assert.equal(row[0].latitude, 45.5)
    assert.equal(row[0].longitude, 6.5)
  })

  test('propagates locationName to all deployments sharing locationID', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    const summary = await applyDeploymentsCsv(db, [
      { deploymentID: 'CAM_001', fields: { locationName: 'Ridge South' } }
    ])

    assert.equal(summary.locationsNamed, 1)
    const a = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_001'))
    const b = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_002'))
    const c = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_003'))
    assert.equal(a[0].locationName, 'Ridge South')
    assert.equal(b[0].locationName, 'Ridge South')
    assert.equal(c[0].locationName, 'Slope') // not propagated across locationIDs
  })

  test('re-validates and drops out-of-range coords silently', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    await applyDeploymentsCsv(db, [
      { deploymentID: 'CAM_001', fields: { latitude: 200, longitude: 6.5 } }
    ])

    const row = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_001'))
    assert.equal(row[0].latitude, null) // out-of-range dropped
    assert.equal(row[0].longitude, 6.5) // valid kept
  })

  test('empty plan is a no-op', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    const summary = await applyDeploymentsCsv(db, [])

    assert.equal(summary.deploymentsUpdated, 0)
    assert.equal(summary.locationsNamed, 0)
  })

  test('rolls back on synthetic failure mid-transaction', async () => {
    await seed()
    const db = await getDrizzleDb(testStudyId, testDbPath)

    await assert.rejects(
      applyDeploymentsCsv(db, [
        { deploymentID: 'CAM_001', fields: { latitude: 45.5 } },
        { __forceFailure: true } // sentinel: applier throws if it sees this
      ])
    )

    const row = await db.select().from(deployments).where(eq(deployments.deploymentID, 'CAM_001'))
    assert.equal(row[0].latitude, null) // first update rolled back
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern='applyDeploymentsCsv'`
Expected: FAIL with `Cannot find module … applyDeploymentsCsv.js`.

- [ ] **Step 3: Implement the applier**

```js
// src/main/services/import/applyDeploymentsCsv.js
import { eq } from 'drizzle-orm'
import { deployments } from '../../database/index.js'
import log from '../logger.js'

/**
 * Apply a validated deployments-CSV plan inside a single Drizzle transaction.
 * Defensive re-validation: out-of-range coords are silently dropped so a
 * tampered plan can't bypass the preview's validation.
 *
 * @param {object} db - Drizzle `better-sqlite3` instance for the study.
 * @param {Array<{deploymentID: string, fields: object} | {__forceFailure: true}>} applyPlan
 * @returns {Promise<{ deploymentsUpdated: number, locationsNamed: number }>}
 */
export async function applyDeploymentsCsv(db, applyPlan) {
  let deploymentsUpdated = 0
  let locationsNamed = 0

  await db.transaction(async (tx) => {
    for (const row of applyPlan) {
      // Test-only sentinel to verify rollback behavior.
      if (row.__forceFailure) {
        throw new Error('forced rollback')
      }

      const { deploymentID, fields } = row
      if (!deploymentID || !fields) continue

      const updates = {}
      if ('latitude' in fields) {
        const v = Number(fields.latitude)
        if (Number.isFinite(v) && v >= -90 && v <= 90) updates.latitude = v
      }
      if ('longitude' in fields) {
        const v = Number(fields.longitude)
        if (Number.isFinite(v) && v >= -180 && v <= 180) updates.longitude = v
      }

      if (Object.keys(updates).length > 0) {
        await tx
          .update(deployments)
          .set(updates)
          .where(eq(deployments.deploymentID, deploymentID))
        deploymentsUpdated++
      }

      if ('locationName' in fields) {
        const trimmed = String(fields.locationName).trim()
        if (trimmed) {
          const found = await tx
            .select({ locationID: deployments.locationID })
            .from(deployments)
            .where(eq(deployments.deploymentID, deploymentID))
          const locationID = found[0]?.locationID
          if (locationID) {
            await tx
              .update(deployments)
              .set({ locationName: trimmed })
              .where(eq(deployments.locationID, locationID))
          } else {
            await tx
              .update(deployments)
              .set({ locationName: trimmed })
              .where(eq(deployments.deploymentID, deploymentID))
          }
          locationsNamed++
          if (Object.keys(updates).length === 0) deploymentsUpdated++
        }
      }
    }
  })

  log.info(
    `applyDeploymentsCsv: ${deploymentsUpdated} deployments updated, ${locationsNamed} location names propagated`
  )
  return { deploymentsUpdated, locationsNamed }
}
```

Note the test-only `__forceFailure` sentinel exists so the rollback test can prove transactional safety without depending on a real constraint violation. If you'd rather not ship the sentinel, write a test that violates a unique constraint instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern='applyDeploymentsCsv'`
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/import/applyDeploymentsCsv.js test/main/services/import/applyDeploymentsCsv.test.js
git commit -m "feat(deployments-csv): transactional applier with name propagation"
```

---

## Task 5: IPC handlers + preload wiring

Wire the three pure modules into Electron IPC. Export uses `dialog.showSaveDialog`; parse uses `dialog.showOpenDialog`; apply takes the plan from the renderer.

**Files:**
- Create: `src/main/ipc/deploymentsCsv.js`
- Modify: `src/main/ipc/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Create the IPC handler module**

```js
// src/main/ipc/deploymentsCsv.js
import { app, dialog, ipcMain } from 'electron'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import { asc } from 'drizzle-orm'
import log from 'electron-log'

import {
  getDrizzleDb,
  getReadonlyDrizzleDb,
  deployments,
  closeStudyDatabase,
  getMetadata
} from '../database/index.js'
import { getStudyDatabasePath } from '../services/paths.js'
import { renderDeploymentsCsv } from '../services/export/deploymentsCsv.js'
import { parseDeploymentsCsv } from '../services/import/parsers/deploymentsCsv.js'
import { applyDeploymentsCsv } from '../services/import/applyDeploymentsCsv.js'

function slugifyStudyName(name) {
  if (!name) return 'study'
  return name.replace(/[^a-z0-9-]/gi, '-').toLowerCase().replace(/-+/g, '-')
}

export function registerDeploymentsCsvIPCHandlers() {
  ipcMain.handle('deployments:export-csv', async (_event, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) return { error: 'Database not found for this study' }

      const db = await getReadonlyDrizzleDb(studyId, dbPath)
      const metadata = await getMetadata(db)
      const slug = slugifyStudyName(metadata?.name)
      const today = new Date().toISOString().slice(0, 10)
      const defaultName = `deployments-${slug}-${today}.csv`

      const rows = await db
        .select({
          deploymentID: deployments.deploymentID,
          locationID: deployments.locationID,
          locationName: deployments.locationName,
          latitude: deployments.latitude,
          longitude: deployments.longitude
        })
        .from(deployments)
        .orderBy(asc(deployments.deploymentID))

      await closeStudyDatabase(studyId, dbPath)

      const result = await dialog.showSaveDialog({
        title: 'Export deployments CSV',
        defaultPath: defaultName,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (result.canceled || !result.filePath) return { cancelled: true }

      const csv = renderDeploymentsCsv(rows)
      await fs.writeFile(result.filePath, csv, 'utf8')
      return { success: true, filePath: result.filePath, rowCount: rows.length }
    } catch (error) {
      log.error('Error exporting deployments CSV:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:parse-csv-for-import', async (_event, studyId, filePath) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) return { error: 'Database not found for this study' }

      const db = await getReadonlyDrizzleDb(studyId, dbPath)
      const dbRows = await db
        .select({
          deploymentID: deployments.deploymentID,
          locationID: deployments.locationID,
          locationName: deployments.locationName,
          latitude: deployments.latitude,
          longitude: deployments.longitude
        })
        .from(deployments)
      await closeStudyDatabase(studyId, dbPath)

      const result = await parseDeploymentsCsv(filePath, dbRows)
      if (result.error) return { error: result.error }
      return { data: result }
    } catch (error) {
      log.error('Error parsing deployments CSV:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:apply-csv-import', async (_event, studyId, applyPlan) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) return { error: 'Database not found for this study' }

      const db = await getDrizzleDb(studyId, dbPath)
      const summary = await applyDeploymentsCsv(db, applyPlan)
      await closeStudyDatabase(studyId, dbPath)

      return { success: true, summary }
    } catch (error) {
      log.error('Error applying deployments CSV:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:pick-csv-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import deployments CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
    return { filePath: result.filePaths[0] }
  })
}
```

- [ ] **Step 2: Register the handler module**

Edit `src/main/ipc/index.js`:

```js
// at the imports block, add:
import { registerDeploymentsCsvIPCHandlers } from './deploymentsCsv.js'

// inside registerAllIPCHandlers(), after registerDeploymentsIPCHandlers():
  registerDeploymentsCsvIPCHandlers()

// at the re-export block, add:
  registerDeploymentsCsvIPCHandlers
```

- [ ] **Step 3: Expose the four methods in preload**

Edit `src/preload/index.js`. After the existing `setDeploymentLocationName` block, add:

```js
  exportDeploymentsCsv: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('deployments:export-csv', studyId)
  },
  pickDeploymentsCsvFile: async () => {
    return await electronAPI.ipcRenderer.invoke('deployments:pick-csv-file')
  },
  parseDeploymentsCsvForImport: async (studyId, filePath) => {
    return await electronAPI.ipcRenderer.invoke(
      'deployments:parse-csv-for-import',
      studyId,
      filePath
    )
  },
  applyDeploymentsCsvImport: async (studyId, applyPlan) => {
    return await electronAPI.ipcRenderer.invoke(
      'deployments:apply-csv-import',
      studyId,
      applyPlan
    )
  },
```

- [ ] **Step 4: Smoke-test the wiring by running the app**

Run: `npm run dev`
Open a study with deployments. Open DevTools console and run:

```js
await window.api.exportDeploymentsCsv(/* studyId */)
```

Expected: save dialog appears, choose a path, file is written, console returns `{ success: true, filePath: '…', rowCount: N }`.

Then run:

```js
const pick = await window.api.pickDeploymentsCsvFile()
const preview = await window.api.parseDeploymentsCsvForImport(/* studyId */, pick.filePath)
preview.data.applyCount // should be 0 for a round-trip with no edits
```

Expected: preview payload returned with `applyCount: 0`.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/deploymentsCsv.js src/main/ipc/index.js src/preload/index.js
git commit -m "feat(deployments-csv): IPC handlers + preload exposure"
```

---

## Task 6: `DeploymentsImportPreviewModal` component

The preview-table modal. Stateless wrt validation — renders whatever payload it receives, exposes Apply / Cancel callbacks.

**Files:**
- Create: `src/renderer/src/deployments/DeploymentsImportPreviewModal.jsx`

- [ ] **Step 1: Implement the modal**

```jsx
// src/renderer/src/deployments/DeploymentsImportPreviewModal.jsx
import { X, AlertTriangle, Ban, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

const FIELD_LABELS = {
  deploymentID: 'deploymentID',
  locationID: 'locationID',
  locationName: 'locationName',
  latitude: 'latitude',
  longitude: 'longitude'
}

const EDITABLE_KEYS = ['locationName', 'latitude', 'longitude']

function CellContent({ col }) {
  if (col.state === 'warning') {
    return (
      <span
        title={col.warning}
        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"
      >
        <AlertTriangle size={12} />
        <span className="tabular-nums">{col.csvValue || '—'}</span>
      </span>
    )
  }
  if (col.state === 'change') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-green-700 dark:text-green-300">
        <ArrowLeftRight size={12} />
        <span className="tabular-nums">{col.csvValue}</span>
      </span>
    )
  }
  // unchanged or readonly
  const display = col.csvValue !== '' ? col.csvValue : col.dbValue ?? '—'
  return (
    <span
      className={
        col.state === 'readonly'
          ? 'text-muted-foreground italic tabular-nums'
          : 'text-foreground tabular-nums'
      }
    >
      {String(display)}
    </span>
  )
}

/**
 * Preview-table modal for the deployments CSV import flow.
 * Stateless rendering of the preview payload produced by the main process.
 */
export default function DeploymentsImportPreviewModal({
  preview,
  onCancel,
  onApply,
  isApplying = false,
  errorMessage = null
}) {
  const modalRef = useRef(null)

  // Esc cancels; Enter does NOT apply (bulk destructive op).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !isApplying) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, isApplying])

  const canApply = preview && preview.applyCount > 0 && !isApplying

  const applyPlan = useMemo(() => {
    if (!preview) return []
    const plan = []
    for (const row of preview.rows) {
      if (row.rowState !== 'normal') continue
      const fields = {}
      for (const key of EDITABLE_KEYS) {
        const col = row.columns[key]
        if (col.state === 'change') {
          fields[key] = col.appliedValue
        }
      }
      if (Object.keys(fields).length > 0) {
        plan.push({ deploymentID: row.deploymentID, fields })
      }
    }
    return plan
  }, [preview])

  if (!preview) return null

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Import deployments CSV"
    >
      <div
        ref={modalRef}
        className="bg-card border border-border rounded-lg shadow-2xl w-[90vw] max-w-[1100px] max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Import deployments CSV</h2>
            <div className="text-[11px] text-muted-foreground mt-0.5">{preview.fileName}</div>
          </div>
          <button
            onClick={onCancel}
            disabled={isApplying}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Summary banner */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs">
          <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-300">
            <ArrowLeftRight size={12} /> {preview.applyCount} rows will update
          </span>
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
            <AlertTriangle size={12} /> {preview.cellWarningCount} cells skipped
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Ban size={12} /> {preview.rowSkipCount} rows unknown ID
          </span>
        </div>

        {errorMessage && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/30 text-xs text-red-700 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left w-10">#</th>
                {Object.keys(FIELD_LABELS).map((key) => (
                  <th key={key} className="px-2 py-1.5 text-left">
                    {FIELD_LABELS[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr
                  key={row.rowIndex}
                  className={`border-t border-border ${
                    row.rowState === 'skipped' ? 'opacity-50' : ''
                  }`}
                >
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {row.rowState === 'skipped' ? (
                      <span title={row.rowWarning} className="inline-flex items-center gap-1">
                        <Ban size={12} /> {row.rowIndex}
                      </span>
                    ) : (
                      row.rowIndex
                    )}
                  </td>
                  {Object.keys(FIELD_LABELS).map((key) => (
                    <td key={key} className="px-2 py-1.5">
                      <CellContent col={row.columns[key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-[11px] text-muted-foreground">
            <span className="text-green-700 dark:text-green-300">⇆</span> change &nbsp;
            <span className="text-amber-700 dark:text-amber-300">⚠</span> warning (cell skipped) &nbsp;
            <span className="text-muted-foreground">⊝</span> row skipped
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={isApplying}
              className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(applyPlan)}
              disabled={!canApply}
              className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:hover:bg-blue-500"
            >
              {isApplying ? 'Applying…' : `Apply (${preview.applyCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run dev`
Expected: app starts, no Vite errors. Modal isn't mounted anywhere yet.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/deployments/DeploymentsImportPreviewModal.jsx
git commit -m "feat(deployments-csv): preview modal component"
```

---

## Task 7: `DeploymentsCsvActions` component

Two flat buttons (Export / Import) plus the import-flow state machine, connected to the preview modal. Rendered into a tab-level header strip in the next task.

**Files:**
- Create: `src/renderer/src/deployments/DeploymentsCsvActions.jsx`

- [ ] **Step 1: Implement the actions component**

```jsx
// src/renderer/src/deployments/DeploymentsCsvActions.jsx
import { Download, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import DeploymentsImportPreviewModal from './DeploymentsImportPreviewModal'

/**
 * Tab-level Export / Import buttons rendered in the always-visible
 * Deployments header strip (above the conditional timeline header).
 * Owns the entire import flow state. Calls `onApplied` after a successful
 * apply so the parent can invalidate caches.
 */
export default function DeploymentsCsvActions({ studyId, onApplied }) {
  const [preview, setPreview] = useState(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)

  const handleExport = useCallback(async () => {
    const result = await window.api.exportDeploymentsCsv(studyId)
    if (result?.cancelled) return
    if (result?.error) {
      toast.error(`Export failed: ${result.error}`)
      return
    }
    toast.success(`Exported ${result.rowCount} deployments to ${result.filePath}`)
  }, [studyId])

  const handleImport = useCallback(async () => {
    const pick = await window.api.pickDeploymentsCsvFile()
    if (pick?.cancelled) return
    if (pick?.error) {
      toast.error(`Could not open file: ${pick.error}`)
      return
    }

    setIsParsing(true)
    try {
      const response = await window.api.parseDeploymentsCsvForImport(studyId, pick.filePath)
      if (response.error) {
        toast.error(response.error)
        return
      }
      setPreview(response.data)
      setApplyError(null)
    } finally {
      setIsParsing(false)
    }
  }, [studyId])

  const handleApply = useCallback(
    async (applyPlan) => {
      setIsApplying(true)
      setApplyError(null)
      try {
        const response = await window.api.applyDeploymentsCsvImport(studyId, applyPlan)
        if (response.error) {
          setApplyError(response.error)
          return
        }
        const { deploymentsUpdated, locationsNamed } = response.summary
        toast.success(
          `Updated ${deploymentsUpdated} deployments. ${locationsNamed} location names propagated.`
        )
        setPreview(null)
        if (onApplied) onApplied()
      } finally {
        setIsApplying(false)
      }
    },
    [studyId, onApplied]
  )

  const handleCancel = useCallback(() => {
    setPreview(null)
    setApplyError(null)
  }, [])

  const btnClass =
    'inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded'

  return (
    <>
      <button onClick={handleExport} title="Export deployments CSV" className={btnClass}>
        <Download size={12} />
        Export CSV
      </button>
      <button onClick={handleImport} title="Import deployments CSV" className={btnClass}>
        <Upload size={12} />
        Import CSV
      </button>

      {isParsing && (
        <div className="fixed inset-0 z-[1900] flex items-center justify-center bg-black/20 text-xs text-white">
          Parsing CSV…
        </div>
      )}

      {preview && (
        <DeploymentsImportPreviewModal
          preview={preview}
          onCancel={handleCancel}
          onApply={handleApply}
          isApplying={isApplying}
          errorMessage={applyError}
        />
      )}
    </>
  )
}
```

Note the component returns a Fragment — the parent owns the strip layout, this component just renders the two buttons (and the floating modal/spinner overlays).

- [ ] **Step 2: Verify it compiles**

Run: `npm run dev`
Expected: no Vite errors. Component still not mounted anywhere — next task.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/deployments/DeploymentsCsvActions.jsx
git commit -m "feat(deployments-csv): export/import action buttons"
```

---

## Task 8: Mount the always-visible header strip + wire cache invalidation

Add a new always-visible header strip above the conditional timeline header. Mount `<DeploymentsCsvActions />` inside it. Pass an `onApplied` callback that invalidates the same React Query caches the per-row lat/lon handlers do.

The strip is rendered unconditionally so it stays visible even for studies where `hasTimestamps === false` (no timeline rendered) — which are exactly the studies most likely to need CSV import (LILA/COCO imports with no timestamps yet).

**Files:**
- Modify: `src/renderer/src/deployments.jsx`

- [ ] **Step 1: Add the import**

Edit `src/renderer/src/deployments.jsx`. Near the other deployment-component imports (around line 17–22), add:

```jsx
import DeploymentsCsvActions from './deployments/DeploymentsCsvActions'
```

- [ ] **Step 2: Add the `onApplied` callback**

Inside the main component (search for the `onNewLatitude` definition around `deployments.jsx:969`), add the callback near the other invalidation logic:

```jsx
const onCsvApplied = useCallback(() => {
  queryClient.invalidateQueries({ queryKey: ['deploymentLocations', studyId] })
  queryClient.invalidateQueries({ queryKey: ['deploymentsAll', studyId] })
  queryClient.invalidateQueries({ queryKey: ['deploymentsActivity', studyId] })
  queryClient.invalidateQueries({ queryKey: ['heatmapData', studyId] })
}, [studyId, queryClient])
```

- [ ] **Step 3: Add the always-visible header strip**

Find the start of the render block (around `deployments.jsx:749–751`):

```jsx
return (
  <div ref={containerRef} className="relative flex-1 flex flex-col overflow-hidden min-h-0">
    {hasTimestamps && (
      <header ...>
```

Insert a new strip between the outer `<div>` and the conditional `<header>`:

```jsx
return (
  <div ref={containerRef} className="relative flex-1 flex flex-col overflow-hidden min-h-0">
    {/* Tab-level actions strip — always visible (sibling of the conditional
        timeline header). Hosts deployments-CSV export/import. */}
    <div className="bg-card border-b border-border px-3 py-1.5 flex items-center justify-end gap-1">
      <DeploymentsCsvActions studyId={studyId} onApplied={onCsvApplied} />
    </div>
    {hasTimestamps && (
      <header ...>
```

The `justify-end` keeps the buttons right-aligned, leaving the left side
free for future tab-level context (a count, a filter pill, etc.). When
the timeline header is hidden, only this strip's `border-b` separates
the buttons from the list — clean. When the timeline is shown, you get
strip-border → timeline-row → timeline-border → list, which matches the
existing "stacked thin nav rows" pattern.

- [ ] **Step 4: Manual verification — with timeline**

Run: `npm run dev`. Open a study that has timestamps (e.g. MICA Muskrat, Muntjac Antwerp). Verify:

1. The strip is visible at the top of the Deployments list panel with **Export CSV** and **Import CSV** buttons right-aligned.
2. The timeline header (date markers + sparkline toggle) renders below the strip as before.
3. Click **Export CSV**. Save dialog appears. Save the file. Toast appears.
4. Open the saved CSV in a text editor. Edit a few `latitude` / `longitude` cells. Add an out-of-range value (e.g., `latitude=200`) to one row. Save.
5. Click **Import CSV**. Pick the file. Preview modal opens.
6. Verify: change cells are green with `⇆` glyph; unchanged cells are normal text; the bogus value shows amber `⚠` with hover tooltip; `[Apply (N)]` shows the right count.
7. Click **Apply (N)**. Toast appears. Modal closes.
8. Verify the map markers moved to the new coords.
9. Re-export and re-import the same file — confirm round-trip stability: `applyCount: 0`, `[Apply]` disabled.

- [ ] **Step 5: Manual verification — without timeline**

Open a study where `hasTimestamps === false` (e.g., Snapshot Karoo or Maasai Mara — LILA imports, no timestamps). Verify:

1. The strip is **still visible** at the top of the Deployments list panel with the two buttons.
2. The date-markers timeline header is absent (as before).
3. Export → edit → import → preview → apply works exactly as in the with-timeline case.
4. Markers appear on the map at the new coords.

This is the primary motivating scenario; the strip MUST be visible here.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/deployments.jsx
git commit -m "feat(deployments-csv): mount always-visible header strip with CSV actions"
```

---

## Task 9: Documentation

Update the four docs files listed in the spec's "File touch summary."

**Files:**
- Modify: `docs/ipc-api.md`
- Modify: `docs/import-export.md`
- Modify: `docs/data-formats.md`

- [ ] **Step 1: Document the IPC handlers**

In `docs/ipc-api.md`, append a section like:

```markdown
### Deployments CSV import/export

| Channel | Args | Returns | Purpose |
| --- | --- | --- | --- |
| `deployments:export-csv` | `studyId` | `{ success, filePath, rowCount } | { cancelled: true } | { error }` | Save dialog + write deployments to CSV. |
| `deployments:pick-csv-file` | — | `{ filePath } | { cancelled: true }` | Open-file dialog for the import flow. |
| `deployments:parse-csv-for-import` | `studyId, filePath` | `{ data: previewPayload } | { error }` | Parse + validate; never writes. |
| `deployments:apply-csv-import` | `studyId, applyPlan` | `{ success, summary: { deploymentsUpdated, locationsNamed } } | { error }` | Single-transaction apply. |

Preview payload shape: see [Deployments CSV spec](./specs/2026-05-12-deployments-csv-import-export-design.md#preview-payload-schema).
```

- [ ] **Step 2: Document the import/export flow**

In `docs/import-export.md`, after the "Image Directory Export" section (or wherever fits the existing flow), add:

```markdown
## Deployments CSV (locations + names)

Bulk-edit `latitude`, `longitude`, and `locationName` for many deployments at
once. Triggered from the `⋮` menu in the Deployments-tab timeline header.

**Export.** Writes all deployments (one row each, including null-coord rows)
to a CSV with the canonical columns:

```
deploymentID,locationID,locationName,latitude,longitude
```

Filename: `deployments-<study-slug>-<YYYY-MM-DD>.csv`. Synthesized
`biowatch-geo:` `locationID` prefixes are preserved as-is (unlike the
CamtrapDP exporter which strips them for spec compliance).

**Import.** Two-call flow:

1. `deployments:parse-csv-for-import` — parses, validates, builds a preview
   payload classifying every cell as unchanged / change / warning / readonly.
   Empty cells = leave existing DB value untouched. Unknown `deploymentID`
   rows are skipped. Validation rules: lat ∈ [-90, 90], lon ∈ [-180, 180],
   numeric only. Duplicate `deploymentID` rows: last wins. Intra-`locationID`
   `locationName` conflicts: last wins.
2. `deployments:apply-csv-import` — runs the user-confirmed apply plan as a
   single SQLite transaction. Coordinate updates apply per `deploymentID`;
   `locationName` propagates to every deployment sharing the resolved
   `locationID` (matches the inline `set-location-name` behavior).

**Key files:**

- `src/main/services/export/deploymentsCsv.js` — pure CSV renderer
- `src/main/services/import/parsers/deploymentsCsv.js` — parser + validator
- `src/main/services/import/applyDeploymentsCsv.js` — transactional applier
- `src/main/ipc/deploymentsCsv.js` — IPC wrappers
- `src/renderer/src/deployments/DeploymentsCsvActions.jsx` — UI entry point (always-visible header strip)
- `src/renderer/src/deployments/DeploymentsImportPreviewModal.jsx` — preview modal
```

- [ ] **Step 3: Document the CSV format**

In `docs/data-formats.md`, append:

```markdown
## Deployments CSV (locations + names)

Used by the Deployments-tab `⋮` menu for round-tripping deployment locations.

| Column | Required? | Editable on import? | Notes |
| --- | --- | --- | --- |
| `deploymentID` | yes | no (row key) | Unknown values → row skipped. |
| `locationID` | no | no (read-only context) | CSV value differing from DB raises a cell warning. |
| `locationName` | no | yes | Propagates to all deployments sharing the resolved `locationID`. |
| `latitude` | no | yes | Must be in `[-90, 90]`. Empty = leave DB value untouched. |
| `longitude` | no | yes | Must be in `[-180, 180]`. Empty = leave DB value untouched. |

Encoding: UTF-8 with RFC-4180 quoting. Unknown headers are ignored. Missing
`deploymentID` header is a hard parse error.
```

- [ ] **Step 4: Commit**

```bash
git add docs/ipc-api.md docs/import-export.md docs/data-formats.md
git commit -m "docs(deployments-csv): IPC handlers, import/export flow, CSV format"
```

---

## Task 10: Final verification & e2e sanity (optional)

End-to-end smoke run plus a re-test of the broader test suite to catch regressions.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including the new ones from Tasks 1, 3, and 4.

- [ ] **Step 2: Lint & format check**

Run: `npm run lint && npm run format:check`
Expected: clean. If `lint` complains, run `npm run fix`; if `format:check` complains, run `npm run format`. Stage and commit any formatting fixes:

```bash
git add -u
git commit -m "chore: lint/format"
```

- [ ] **Step 3: Manual full-flow on a real study**

Run: `npm run dev`. With a LILA-imported study like Maasai Mara (176 deployments, 0 coords):

1. Export. CSV has 176 rows with empty lat/lon.
2. Edit ~5 rows in a spreadsheet, fill in plausible coords. Save.
3. Import. Preview shows 5 `change` rows. Apply.
4. Open the Deployments-tab map. Verify the 5 deployments now have markers; the rest don't.
5. Re-export. Open the new CSV — those 5 rows now have coordinates filled in; the other 171 are still empty. Re-import → applyCount=0.

- [ ] **Step 4: Optional Playwright e2e**

If time permits, add a `test:e2e` test that automates Step 3 above. Skip if not.

---

## Self-Review (completed inline)

- **Spec coverage check.** Every section of `2026-05-12-deployments-csv-import-export-design.md` maps to at least one task:
  - Export: Task 1 (renderer), Task 5 (IPC + dialog).
  - Parse + validation: Tasks 2, 3.
  - Apply: Task 4 (logic), Task 5 (IPC).
  - UI: Tasks 6 (modal), 7 (menu), 8 (mount + invalidation).
  - Docs: Task 9.
  - Verification: Task 10.
- **Placeholder scan.** No TBDs. Every code step has actual code. Every command has expected output.
- **Type consistency.** `applyPlan` is `[{ deploymentID, fields: { latitude?, longitude?, locationName? } }]` everywhere it appears (Tasks 4, 5, 6, 7). Preview payload schema in Task 2 matches the consumers in Tasks 6, 7. `appliedValue` lives on `change` cells only — consistently referenced.
- **Edge cases covered.** Empty CSV, missing `deploymentID` header, duplicate rows, name conflicts, unknown deploymentID, locationID readonly, intra-`locationID` coord divergence (allowed silently per spec). Validation rule tests in Task 3 cover the canonical list from the spec.
- **No new test tooling.** All tests use `node:test` + `node:assert/strict`, matching `test/main/database/restoreObservation.test.js` patterns. React-component tests are deliberately omitted (codebase doesn't use RTL); the menu + modal are verified via manual e2e in Tasks 5, 8, 10.
