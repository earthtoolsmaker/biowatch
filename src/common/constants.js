const PYTHON_ENVIRONMENTS = [
  {
    type: 'conda',
    reference: {
      id: 'common',
      version: '0.1.0',
      downloadURL: {
        mac: 'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.0-macOS.tar.gz',
        linux:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.0-Linux.tar.gz',
        windows:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/common-0.1.0-Windows.tar.gz'
      }
    },
    size_in_MiB: {
      mac: 367,
      windows: 522,
      linux: 3220
    }
  }
]

const MODEL_ZOO = [
  {
    name: 'SpeciesNet',
    python_environment: { id: 'common', version: '0.1.0' },
    size_in_MiB: 468,
    reference: {
      id: 'speciesnet',
      version: '4.0.1a',
      downloadURL:
        'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true'
    },
    description:
      "Google's SpeciesNet is an open-source AI model launched in 2025, specifically designed for identifying animal species from images captured by camera traps. It boasts the capability to classify images into over 2,000 species labels, greatly enhancing the efficiency of wildlife data analysis for conservation initiatives.",
    website: 'https://github.com/google/cameratrapai'
  }
]
export default { PYTHON_ENVIRONMENTS, MODEL_ZOO }
