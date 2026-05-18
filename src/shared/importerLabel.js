const LABELS = {
  'local/ml_run': 'Local folder',
  'wildlife/folder': 'Wildlife Insights',
  'camtrap/datapackage': 'Camtrap DP',
  'lila/coco': 'LILA dataset',
  'deepfaune/csv': 'DeepFaune CSV',
  'local/images': 'Local folder'
}

/**
 * Human-readable label for an `importerName` value. Falls back to the raw
 * string when no mapping exists so we don't lose information for unknown
 * importers.
 */
export function importerLabel(importerName) {
  if (!importerName) return ''
  return LABELS[importerName] || importerName
}
