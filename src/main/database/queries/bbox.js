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
  if (!bbox) return { clause: '', params: [] }
  const { north, south, east, west } = bbox
  if ([north, south, east, west].some((v) => typeof v !== 'number' || Number.isNaN(v))) {
    return { clause: '', params: [] }
  }
  if (west > east) return { clause: '', params: [] }
  const clause = `AND ${alias}.latitude BETWEEN ? AND ? AND ${alias}.longitude BETWEEN ? AND ?`
  return { clause, params: [south, north, west, east] }
}
