import { eq } from 'drizzle-orm'
import { deployments } from '../../database/index.js'
import log from '../logger.js'

/**
 * Apply a validated deployments-CSV plan inside a single Drizzle transaction.
 * Defensive re-validation: out-of-range coords are silently dropped so a
 * tampered plan can't bypass the preview's validation.
 *
 * Note: better-sqlite3 transactions are synchronous, so the callback runs
 * synchronously and uses `.run()` / `.all()` for explicit execution.
 *
 * @param {object} db - Drizzle `better-sqlite3` instance for the study.
 * @param {Array<{deploymentID: string, fields: object} | {__forceFailure: true}>} applyPlan
 * @returns {Promise<{ deploymentsUpdated: number, locationsNamed: number }>}
 */
export async function applyDeploymentsCsv(db, applyPlan) {
  let deploymentsUpdated = 0
  let locationsNamed = 0

  db.transaction((tx) => {
    for (const row of applyPlan) {
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
          } else {
            tx.update(deployments)
              .set({ locationName: trimmed })
              .where(eq(deployments.deploymentID, deploymentID))
              .run()
          }
          locationsNamed++
          if (!coordUpdateApplied) deploymentsUpdated++
        }
      }
    }
  })

  log.info(
    `applyDeploymentsCsv: ${deploymentsUpdated} deployments updated, ${locationsNamed} location names propagated`
  )
  return { deploymentsUpdated, locationsNamed }
}
