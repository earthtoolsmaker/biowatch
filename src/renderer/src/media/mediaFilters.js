// Pure helpers translating Media-tab filter state to/from URL search params.
// No React here — keeps the logic unit-testable under node:test.

export const QUICK_VIEW_KEYS = ['favorites', 'blank', 'detections', 'no-timestamp', 'vehicle']

export const DEFAULT_FILTERS = {
  species: [],
  deployments: [],
  mediaTypes: [],
  dateRange: [null, null],
  timeRange: { ranges: [] },
  quickView: null,
  sort: 'newest',
  view: 'table'
}

// Repeatable list params use comma-join; the renderer never stores a comma in a
// scientificName/deploymentID/importFolder, so a plain split is safe.
const listToParam = (xs) => (xs && xs.length ? xs.join(',') : null)
const paramToList = (v) => (v ? v.split(',').filter(Boolean) : [])

export function filtersToSearchParams(filters) {
  const sp = new URLSearchParams()
  const f = { ...DEFAULT_FILTERS, ...filters }
  if (f.species.length) sp.set('species', listToParam(f.species))
  if (f.deployments.length) sp.set('deployment', listToParam(f.deployments))
  if (f.mediaTypes.length) sp.set('mediaType', listToParam(f.mediaTypes))
  if (f.dateRange[0]) sp.set('from', f.dateRange[0])
  if (f.dateRange[1]) sp.set('to', f.dateRange[1])
  if (f.timeRange.ranges.length) sp.set('time', JSON.stringify(f.timeRange.ranges))
  if (f.quickView) sp.set('q', f.quickView)
  if (f.sort && f.sort !== 'newest') sp.set('sort', f.sort)
  if (f.view && f.view !== 'table') sp.set('view', f.view)
  return sp
}

export function searchParamsToFilters(sp) {
  const q = sp.get('q')
  let ranges = []
  try {
    const raw = sp.get('time')
    if (raw) ranges = JSON.parse(raw)
    if (!Array.isArray(ranges)) ranges = []
  } catch {
    ranges = []
  }
  return {
    species: paramToList(sp.get('species')),
    deployments: paramToList(sp.get('deployment')),
    mediaTypes: paramToList(sp.get('mediaType')),
    dateRange: [sp.get('from') || null, sp.get('to') || null],
    timeRange: { ranges },
    quickView: QUICK_VIEW_KEYS.includes(q) ? q : null,
    sort: sp.get('sort') === 'oldest' ? 'oldest' : 'newest',
    view: sp.get('view') === 'grid' ? 'grid' : 'table'
  }
}

// "Filters" = things that narrow the result set. sort/view are presentation,
// not filters, so they don't light up the "active filters" / reset affordance.
export function hasActiveFilters(filters) {
  const f = { ...DEFAULT_FILTERS, ...filters }
  return !!(
    f.species.length ||
    f.deployments.length ||
    f.mediaTypes.length ||
    f.dateRange[0] ||
    f.dateRange[1] ||
    f.timeRange.ranges.length ||
    f.quickView
  )
}
