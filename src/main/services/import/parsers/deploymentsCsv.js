import fs from 'fs'
import csv from 'csv-parser'

const COORD_EPSILON = 1e-9

// The three columns the import flow may write back to the deployments table.
// Kept in sync with the renderer-side EDITABLE_DEPLOYMENT_IMPORT_KEYS.
const EDITABLE_KEYS = ['locationName', 'latitude', 'longitude']

function readonlyEqual(csvValue, dbValue) {
  if (csvValue === '' || csvValue == null) return true
  return String(csvValue) === String(dbValue ?? '')
}

function textCellState(csvValue, dbValue) {
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
 * Validation is row-level: any warning cell in a normal row blocks the
 * whole row from being applied. `applyCount` reflects this — it counts
 * rows that will actually update (no warning cells + at least one change
 * cell). `rowsBlockedByWarningCount` is the row-level complement.
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

  const previewRows = rows.map((rawRow, index) => {
    const rowIndex = index + 1
    const deploymentID = (rawRow.deploymentID ?? '').trim()
    const dbRow = deploymentID ? dbByID.get(deploymentID) : null

    if (!deploymentID) {
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

    return {
      rowIndex,
      deploymentID,
      rowState: 'normal',
      rowWarning: null,
      columns
    }
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
    for (const key of EDITABLE_KEYS) {
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
  // Group rows by their DB locationID (CSV locationID is readonly).
  const nameWinnerByLocationID = new Map()
  previewRows.forEach((row, i) => {
    if (row.rowState !== 'normal') return
    const col = row.columns.locationName
    if (col.state !== 'change') return
    const locID = row.columns.locationID.dbValue
    if (!locID) return
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

  // Row-level counting: a row with any warning cell is blocked from apply
  // entirely — partial-row application is not supported (see spec).
  let applyCount = 0
  let rowsBlockedByWarningCount = 0
  let rowSkipCount = 0
  for (const row of previewRows) {
    if (row.rowState === 'skipped') {
      rowSkipCount++
      continue
    }
    const hasWarning = Object.values(row.columns).some((c) => c.state === 'warning')
    if (hasWarning) {
      rowsBlockedByWarningCount++
      continue
    }
    const hasChange = EDITABLE_KEYS.some((k) => row.columns[k].state === 'change')
    if (hasChange) applyCount++
  }

  return {
    filePath,
    fileName: filePath.split(/[/\\]/).pop(),
    totalRows: rows.length,
    applyCount,
    rowsBlockedByWarningCount,
    rowSkipCount,
    rows: previewRows
  }
}
