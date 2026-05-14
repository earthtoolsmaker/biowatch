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
