/**
 * Pure helper that classifies a model's install status from the
 * installed-model and installed-environment lists returned by
 * `window.api.listInstalledMLModels()` and
 * `window.api.listInstalledMLModelEnvironments()`.
 *
 * Returns one of:
 *   - 'installed'      both model + env are present
 *   - 'env-missing'    model present, env missing (download was partial)
 *   - 'not-installed'  model missing (env may or may not be present)
 */
export function getModelInstallStatus(model, installedModels, installedEnvironments) {
  const modelOk = installedModels.some(
    (m) => m.id === model.reference.id && m.version === model.reference.version
  )
  if (!modelOk) return 'not-installed'

  const envOk = installedEnvironments.some(
    (e) =>
      e.id === model.pythonEnvironment.id && e.version === model.pythonEnvironment.version
  )
  return envOk ? 'installed' : 'env-missing'
}
