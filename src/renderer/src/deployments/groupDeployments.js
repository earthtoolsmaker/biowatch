/**
 * Sum per-bucket observation counts across multiple deployments at the
 * same location. Different deployments are different temporal samples,
 * so summing is correct here (distinct from the within-sequence
 * bbox-count rule, which uses max-per-frame).
 */
const aggregatePeriods = (deployments) => {
  if (deployments.length === 0) return []
  return deployments[0].periods.map((period, i) => ({
    start: period.start,
    end: period.end,
    count: deployments.reduce((sum, d) => sum + (d.periods[i]?.count || 0), 0)
  }))
}

/**
 * Earliest start / latest end across a group's deployments, so a section
 * header's coverage markers span the union of its children. A missing
 * date on any child is open-ended and makes the union open-ended too;
 * unparseable dates are ignored so they can't poison the comparison.
 */
const coverageUnion = (deployments) => {
  const byTime = (iso) => new Date(iso).getTime()
  const pick = (dates, better) => {
    if (dates.some((d) => !d)) return null
    const valid = dates.filter((d) => Number.isFinite(byTime(d)))
    if (valid.length === 0) return null
    return valid.reduce((a, b) => (better(byTime(b), byTime(a)) ? b : a))
  }
  return {
    deploymentStart: pick(
      deployments.map((d) => d.deploymentStart),
      (b, a) => b < a
    ),
    deploymentEnd: pick(
      deployments.map((d) => d.deploymentEnd),
      (b, a) => b > a
    )
  }
}

/**
 * Sum camera-days across deployments at one location. Deployments without a
 * valid interval (effortDays null) are skipped; null when none has effort so
 * the header can show "—" rather than a misleading 0.
 */
export const sumEffortDays = (deployments) => {
  let total = null
  for (const d of deployments) {
    if (typeof d.effortDays === 'number') total = (total ?? 0) + d.effortDays
  }
  return total
}

/** Number of deployments skipped by sumEffortDays (no valid interval). */
export const countMissingEffort = (deployments) =>
  deployments.filter((d) => typeof d.effortDays !== 'number').length

/**
 * Group deployments by locationID and return one alphabetically-sorted
 * sequence interleaving multi-deploy groups with singletons. Each entry
 * has isSingleDeployment for the renderer to switch between section
 * header + children vs flat row.
 */
export function groupDeploymentsByLocation(deployments) {
  if (!deployments || deployments.length === 0) return []

  const groups = new Map()

  deployments.forEach((deployment) => {
    const key = deployment.locationID || deployment.deploymentID
    if (!groups.has(key)) {
      groups.set(key, {
        locationID: deployment.locationID || deployment.deploymentID,
        locationName: deployment.locationName,
        latitude: deployment.latitude,
        longitude: deployment.longitude,
        deployments: []
      })
    }
    groups.get(key).deployments.push(deployment)
  })

  // Within each group, most recent deployment first.
  groups.forEach((group) => {
    group.deployments.sort((a, b) => new Date(b.deploymentStart) - new Date(a.deploymentStart))
  })

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      aggregatedPeriods: aggregatePeriods(group.deployments),
      ...coverageUnion(group.deployments),
      aggregatedEffortDays: sumEffortDays(group.deployments),
      isSingleDeployment: group.deployments.length === 1
    }))
    .sort((a, b) => {
      const aName = a.locationName || a.locationID || ''
      const bName = b.locationName || b.locationID || ''
      return aName.localeCompare(bName)
    })
}
