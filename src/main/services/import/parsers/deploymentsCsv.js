import fs from 'fs'
import csv from 'csv-parser'

const COORD_EPSILON = 1e-9

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
}
