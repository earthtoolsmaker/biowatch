/** Minimal, best-effort labels for a study whose normal queries are blocked. */
import Database from 'better-sqlite3'

export function readUnavailableStudySummary(studyId, dbPath, database) {
  let sqlite
  let summary
  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
    // Do not attach the current ORM schema to an incompatible database. Only
    // read known label columns that actually exist, never media/observations.
    const columns = new Set(sqlite.pragma('table_info(metadata)').map((column) => column.name))
    const labels = ['name', 'title', 'created'].filter((column) => columns.has(column))
    if (labels.length) {
      summary = sqlite.prepare(`SELECT ${labels.join(', ')} FROM metadata LIMIT 1`).get()
    }
  } catch {
    // A corrupt, locked or missing database still needs a visible entry.
  } finally {
    sqlite?.close()
  }
  return {
    id: studyId,
    name: summary?.name || summary?.title || studyId,
    createdAt: summary?.created || null,
    path: null,
    data: null,
    database
  }
}
