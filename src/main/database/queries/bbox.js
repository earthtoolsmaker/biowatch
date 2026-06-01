/**
 * Build the SQL fragment + bind params for an optional bounding-box filter on
 * a deployments table alias. Returns an empty clause (and no params) when the
 * bbox is null/undefined or crosses the antimeridian (west > east), which v1
 * does not support — see docs/specs/2026-05-29-activity-map-viewport-filter-design.md.
 *
 * Params are returned in the order the placeholders appear: south, north,
 * west, east (latitude BETWEEN south AND north, longitude BETWEEN west AND east).
 *
 * @param {{north:number, south:number, east:number, west:number}|null|undefined} bbox
 * @param {string} alias - SQL alias of the deployments table (e.g. 'd')
 * @returns {{clause: string, params: number[]}}
 */
export function buildBboxClause(bbox, alias) {
  if (!isAreaBboxApplicable(bbox)) return { clause: '', params: [] }
  const { north, south, west, east } = bbox
  const clause = `AND ${alias}.latitude BETWEEN ? AND ? AND ${alias}.longitude BETWEEN ? AND ?`
  return { clause, params: [south, north, west, east] }
}

/**
 * Whether an area bbox should be applied as a filter. False for null/undefined,
 * non-numeric/NaN bounds, or antimeridian-crossing boxes (west > east), which
 * v1 does not support. Shared by {@link buildBboxClause} (raw SQL) and the
 * Drizzle-based sequence pagination query so both apply the same guard.
 *
 * @param {{north:number, south:number, east:number, west:number}|null|undefined} bbox
 * @returns {boolean}
 */
export function isAreaBboxApplicable(bbox) {
  if (!bbox) return false
  const { north, south, east, west } = bbox
  if ([north, south, east, west].some((v) => typeof v !== 'number' || Number.isNaN(v))) {
    return false
  }
  if (west > east) return false
  return true
}
