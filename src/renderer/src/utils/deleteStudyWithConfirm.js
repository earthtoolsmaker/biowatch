/**
 * Wrap `window.api.deleteStudyDatabase` so the caller doesn't have to know
 * about the merge-dependent confirmation flow.
 *
 * If the backend returns `{ needsConfirm: true, dependentBreaks: [...] }`,
 * we prompt the user with the list of studies whose merged-source files
 * would break, and only proceed with `{ force: true }` after confirmation.
 *
 * Returns the eventual backend result, or `{ cancelled: true }` if the user
 * declined the confirmation.
 */
export async function deleteStudyWithConfirm(studyId, studyTitle) {
  const result = await window.api.deleteStudyDatabase(studyId)
  if (result?.needsConfirm) {
    const dependents = result.dependentBreaks || []
    const lines = dependents.map(
      (d) =>
        `• ${d.title || d.studyId} — ${d.brokenMediaCount} media will become unavailable`
    )
    const message =
      `${studyTitle || 'This study'} has been merged into ${dependents.length} other ${
        dependents.length === 1 ? 'study' : 'studies'
      }:\n\n${lines.join('\n')}\n\nDelete anyway?`
    const ok = window.confirm(message)
    if (!ok) return { cancelled: true }
    return await window.api.deleteStudyDatabase(studyId, { force: true })
  }
  return result
}
