/**
 * This module contains configuration for Python environments
 * and model specifications for the machine learning models
 * used in the application. It exports the available Python
 * environments and models in the model zoo, along with their
 * metadata such as size, version, and download URLs.
 */

export const pythonEnvironments = [
  /**
   * An array of Python environment configurations.
   * Each environment includes details such as type, reference information,
   * size in MiB for various operating systems, and download URLs.
   */
  {
    type: 'conda',
    reference: { id: 'common', version: '0.1.0' },
    platform: {
      mac: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.0-macOS.tar.gz',
        size_in_MiB: 349,
        size_in_MiB_installed: 1300,
        files: 54414
      },
      linux: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.0-Linux.tar.gz',
        size_in_MiB: 3220,
        size_in_MiB_installed: 6200,
        files: 54247
      },
      windows: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.0-Windows.tar.gz',
        size_in_MiB: 522,
        files: 52231
      }
    }
  },
  {
    type: 'conda',
    reference: { id: 'common', version: '0.1.1' },
    platform: {
      mac: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.1-macOS.tar.gz',
        size_in_MiB: 349,
        size_in_MiB_installed: 1300,
        files: 54414
      },
      linux: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.1-Linux.tar.gz',
        size_in_MiB: 3220,
        size_in_MiB_installed: 6200,
        files: 54247
      },
      windows: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.1-Windows.tar.gz',
        size_in_MiB: 499,
        size_in_MiB_installed: 2100,
        files: 52231
      }
    }
  },
  {
    type: 'conda',
    reference: { id: 'common', version: '0.1.2' },
    platform: {
      mac: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.2-macOS.tar.gz',
        size_in_MiB: 354,
        size_in_MiB_installed: 1300,
        files: 55470
      },
      linux: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.2-Linux.tar.gz',
        size_in_MiB: 3200,
        size_in_MiB_installed: 6200,
        files: 55869
      },
      windows: {
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.2-Windows.tar.gz',
        size_in_MiB: 505,
        size_in_MiB_installed: 2200,
        files: 53286
      }
    }
  }
]

export const modelZoo = [
  /**
   * An array of models available in the model zoo.
   * Each model includes details such as name, associated Python environment,
   * size in MiB, reference information including version and download URL,
   * a description of the model, and a link to the model's website.
   */
  {
    reference: { id: 'speciesnet', version: '4.0.1a' },
    pythonEnvironment: { id: 'common', version: '0.1.2' },
    name: 'SpeciesNet',
    size_in_MiB: 468,
    files: 6,
    downloadURL:
      'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true',
    description:
      "Google's SpeciesNet is an open-source AI model launched in 2025, specifically designed for identifying animal species from images captured by camera traps. It boasts the capability to classify images into over 2,000 species labels, greatly enhancing the efficiency of wildlife data analysis for conservation initiatives.",
    website: 'https://github.com/google/cameratrapai'
  },
  {
    reference: { id: 'deepfaune', version: '1.3' },
    pythonEnvironment: { id: 'common', version: '0.1.2' },
    name: 'DeepFaune',
    size_in_MiB: 1200,
    files: 2,
    downloadURL:
      'https://huggingface.co/earthtoolsmaker/deepfaune/resolve/main/1.3.tar.gz?download=true',
    description:
      "Launched in 2022, CNRS' DeepFaune is an open-source AI model developed to identify animal species from images captured by camera traps, focusing specifically on European fauna.",
    website: 'https://www.deepfaune.cnrs.fr/en/'
  }
]

/**
 * Finds and returns a Python environment configuration that matches the given
 * id and version. If no matching environment is found, returns null.
 *
 * @param {Object} params - The parameters for finding the Python environment.
 * @param {string} params.id - The identifier of the Python environment.
 * @param {string} params.version - The version of the Python environment.
 * @returns {Object|null} The matching Python environment object or null if not found.
 */
export function findPythonEnvironment({ id, version }) {
  const matchingEnvironments = pythonEnvironments.filter(
    (env) => env.reference.id === id && env.reference.version === version
  )

  // Return the first matching environment or null if none found
  return matchingEnvironments.length > 0 ? matchingEnvironments[0] : null
}

/**
 * Finds and returns a model configuration that matches the given
 * id and version. If no matching model is found, returns null.
 *
 * @param {Object} params - The parameters for finding the model.
 * @param {string} params.id - The identifier of the model.
 * @param {string} params.version - The version of the model.
 * @returns {Object|null} The matching model object or null if not found.
 */
export function findModel({ id, version }) {
  const matchingModels = modelZoo.filter(
    (env) => env.reference.id === id && env.reference.version === version
  )

  // Return the first matching environment or null if none found
  return matchingModels.length > 0 ? matchingModels[0] : null
}

/**
 * Converts a platform string to its corresponding key used in the environment configuration.
 *
 * @param {string} platform - The platform string (e.g., 'win32', 'linux', 'darwin').
 * @returns {string} The corresponding key for the platform ('windows', 'linux', or 'mac').
 */
export function platformToKey(platform) {
  return platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'mac'
}

export default {
  pythonEnvironments,
  modelZoo,
  findPythonEnvironment,
  findModel,
  platformToKey
}
