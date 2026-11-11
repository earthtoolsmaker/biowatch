import { cameraZone } from './cameraTime.js'

/** Explicit user configuration, not a migration or inferred geographic timezone. */
export function setCameraTimeZone(sqlite, deploymentID, value) {
  if (typeof deploymentID !== 'string' || !deploymentID) throw new Error('Invalid deployment ID')
  if (value !== null && (typeof value !== 'string' || !cameraZone(value))) {
    throw new Error('Use an IANA timezone (Europe/Paris), UTC, or a fixed offset (UTC+02:00)')
  }
  return sqlite.transaction(() => {
    const result = sqlite
      .prepare('UPDATE deployments SET cameraTimeZone = ? WHERE deploymentID = ?')
      .run(value, deploymentID)
    if (result.changes !== 1) throw new Error('Deployment not found')
    const { unresolvedCount } = sqlite
      .prepare(
        `
      SELECT COUNT(*) AS unresolvedCount FROM media
      WHERE deploymentID = ? AND sourceTimestamp IS NOT NULL AND timestamp IS NULL
    `
      )
      .get(deploymentID)
    return { unresolvedCount }
  })()
}
