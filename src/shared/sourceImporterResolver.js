const MERGE_PREFIX = 'merge:'

function isUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s)
}

/**
 * Resolve a source row's effective importerName + optional displayLabel.
 *
 * @param {object} args
 * @param {string} args.importFolder
 * @param {string} args.studyImporterName
 * @param {string} [args.sampleFilePath]
 * @param {Array<{ id: string, name?: string, title?: string, importerName: string }>} args.studies
 * @returns {{ importerName: string, displayLabel?: string }}
 */
export function resolveSourceDisplay({ importFolder, studyImporterName, sampleFilePath, studies }) {
  if (typeof importFolder === 'string' && importFolder.startsWith(MERGE_PREFIX)) {
    const uuid = importFolder.slice(MERGE_PREFIX.length)
    const b = (studies || []).find((s) => s.id === uuid)
    if (b) return { importerName: b.importerName, displayLabel: b.name || b.title }
    if (isUrl(sampleFilePath)) return { importerName: 'lila/coco', displayLabel: 'Merged source' }
    return { importerName: studyImporterName, displayLabel: 'Merged source' }
  }
  if (isUrl(sampleFilePath)) return { importerName: 'lila/coco' }
  return { importerName: studyImporterName }
}
