export const EDITABLE_DEPLOYMENT_IMPORT_KEYS = ['locationName', 'latitude', 'longitude']

export function rowHasWarning(row) {
  return Object.values(row?.columns || {}).some((col) => col?.state === 'warning')
}

export function buildDeploymentsCsvApplyPlan(preview) {
  if (!preview) return []

  const plan = []
  for (const row of preview.rows || []) {
    if (row.rowState !== 'normal') continue
    if (rowHasWarning(row)) continue

    const fields = {}
    for (const key of EDITABLE_DEPLOYMENT_IMPORT_KEYS) {
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
}
