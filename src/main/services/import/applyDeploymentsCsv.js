import { eq } from 'drizzle-orm'
import { deployments } from '../../database/index.js'
import log from '../logger.js'

/**
 * Apply a validated deployments-CSV plan inside a single Drizzle transaction.
 * Defensive re-validation: out-of-range coords are silently dropped so a
 * tampered plan can't bypass the preview's validation.
 *
 * Not `async` — better-sqlite3 transactions are synchronous, so the callback
 * runs synchronously and uses `.run()` / `.all()` for explicit execution.
 * The IPC handler awaits this anyway; a Promise here would be misleading.
 *
 * @param {object} db - Drizzle `better-sqlite3` instance for the study.
 * @param {Array<{deploymentID: string, fields: { latitude?, longitude?, locationName? }}>} applyPlan
 * @returns {{ deploymentsUpdated: number, locationsNamed: number }}
 *   `deploymentsUpdated` counts plan rows whose coord and/or name changes
 *   reached the DB. `locationsNamed` counts **distinct** `locationID`s
 *   renamed — so a CSV renaming 28 deployments that share one location
 *   reports `locationsNamed: 1`, not 28.
 */
export function applyDeploymentsCsv(db, applyPlan) {
  let deploymentsUpdated = 0
  const namedLocations = new Set()

  db.transaction((tx) => {
    for (const row of applyPlan) {
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

      let coordUpdateApplied = false
      if (Object.keys(updates).length > 0) {
        tx.update(deployments).set(updates).where(eq(deployments.deploymentID, deploymentID)).run()
        deploymentsUpdated++
        coordUpdateApplied = true
      }

      if ('locationName' in fields) {
        const trimmed = String(fields.locationName).trim()
        if (trimmed) {
          const found = tx
            .select({ locationID: deployments.locationID })
            .from(deployments)
            .where(eq(deployments.deploymentID, deploymentID))
            .all()
          const locationID = found[0]?.locationID
          if (locationID) {
            tx.update(deployments)
              .set({ locationName: trimmed })
              .where(eq(deployments.locationID, locationID))
              .run()
            namedLocations.add(locationID)
          } else {
            tx.update(deployments)
              .set({ locationName: trimmed })
              .where(eq(deployments.deploymentID, deploymentID))
              .run()
            // No locationID on this row; track by deploymentID so the
            // count is non-zero even though no group propagation
            // happened.
            namedLocations.add(`__no_loc:${deploymentID}`)
          }
          if (!coordUpdateApplied) deploymentsUpdated++
        }
      }
    }
  })

  const locationsNamed = namedLocations.size
  log.info(
    `applyDeploymentsCsv: ${deploymentsUpdated} deployments updated, ${locationsNamed} distinct locations renamed`
  )
  return { deploymentsUpdated, locationsNamed }
}
