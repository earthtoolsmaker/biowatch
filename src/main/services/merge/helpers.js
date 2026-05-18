const MERGE_PREFIX = 'merge:'

export function getMergeImportFolder(uuid) {
  return `${MERGE_PREFIX}${uuid}`
}

export function getMergePrefix(uuid) {
  return `study:${uuid.slice(0, 8)}:`
}

export function isMergedImportFolder(value) {
  return typeof value === 'string' && value.startsWith(MERGE_PREFIX)
}

export function parseMergeUuid(value) {
  if (!isMergedImportFolder(value)) return null
  return value.slice(MERGE_PREFIX.length)
}

/**
 * Returns a copy of `row` with `row[pk]` and each FK in `fks` prefixed.
 * Null FK values are left as-is.
 */
export function prefixRow(row, prefix, { pk, fks }) {
  const out = { ...row }
  out[pk] = `${prefix}${row[pk]}`
  for (const fk of fks) {
    if (row[fk] != null) out[fk] = `${prefix}${row[fk]}`
  }
  return out
}
