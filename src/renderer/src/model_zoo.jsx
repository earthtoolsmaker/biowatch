import { useNavigate } from 'react-router'
import { useState, useEffect } from 'react'
import { Download, Loader2Icon, LucideLoader, CircleX } from 'lucide-react'

const PYTHON_ENVIRONMENTS = [
  {
    type: 'conda',
    reference: {
      id: 'common',
      version: '0.1.0',
      downloadURL: {
        mac: 'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/species-env-macOS.tar.gz',
        linux:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/species-env-Linux.tar.gz',
        windows:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/species-env-Windows.tar.gz'
      }
    },
    size_in_MiB: {
      mac: 345,
      windows: 500,
      linux: 3900
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
      // version: '4.0.1a',
      // FIXME:
      version: '4.0.1z',
      downloadURL:
        'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1z.tar.gz?download=true'
      // FIXME:
      // downloadURL:
      //   'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/README.md?download=true'
    },
    description:
      "Google's SpeciesNet is an open-source AI model launched in 2025, specifically designed for identifying animal species from images captured by camera traps. It boasts the capability to classify images into over 2,000 species labels, greatly enhancing the efficiency of wildlife data analysis for conservation initiatives.",
    website: 'https://github.com/google/cameratrapai'
  }
]

const platformToKey = (platform) => {
  return platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'mac'
}

function findPythonEnvironment({ id, version }) {
  const matchingEnvironments = PYTHON_ENVIRONMENTS.filter(
    (env) => env.reference.id === id && env.reference.version === version
  )

  // Return the first matching environment or null if none found
  return matchingEnvironments.length > 0 ? matchingEnvironments[0] : null
}

function ModelCard({ model, pythonEnvironment, platform }) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDownloaded, setIsDownloaded] = useState(false)

  // Function to check if the model is downloaded
  const isMLModelDownloaded = async (reference) => {
    try {
      const downloaded = await window.api.isMLModelDownloaded(reference)
      return downloaded // Assuming this returns a boolean
    } catch (error) {
      console.error('Failed to check if model is downloaded:', error)
      return false // Default to false on error
    }
  }

  useEffect(() => {
    const isMLModelDownloaded = async () => {
      const isDownloaded = await window.api.isMLModelDownloaded(model.reference)
      setIsDownloaded(isDownloaded)
    }

    isMLModelDownloaded()
  }, [model.reference]) // Run this effect when the model reference changes

  const handleDelete = async (reference) => {
    console.log('handling delete...')
    try {
      await window.api.deleteLocalMLModel(reference)
      setIsDownloaded(false)
    } catch (error) {
      console.error('Failed to delete the local model:', error)
    }
  }
  const handleDownload = async ({ modelReference, pythonEnvironment }) => {
    console.log('handling download...')
    setIsDownloading(true)
    try {
      await window.api.downloadMLModel(modelReference)
      console.log('downloading python environment')
      const platformKey = platformToKey(platform)
      const downloadURL = pythonEnvironment.reference.downloadURL[platformKey]
      await window.api.downloadPythonEnvironment({
        version: pythonEnvironment.reference.version,
        id: pythonEnvironment.reference.id,
        // FIXME:
        downloadURL:
          'https://pub-5a51774bae6b4020a4948aaf91b72172.r2.dev/conda-environments/species-env-macOS.tar.gz'
        // downloadURL: downloadURL
      })
      setIsDownloaded(true)
      setIsDownloading(false)
    } catch (error) {
      setIsDownloading(false)
      console.error('Failed to download model:', error)
    }
  }

  const { name, description, reference, size_in_MiB } = model
  const classNameMainContainer = isDownloaded
    ? 'flex flex-col justify-around border-gray-200 border p-4 rounded-md w-96 gap-2 shadow-sm'
    : 'flex bg-gray-50 flex-col justify-around border-gray-200 border p-4 rounded-md w-96 gap-2 shadow-sm'
  return (
    <div className={classNameMainContainer}>
      <div className="p-2 text-l text-center">{name}</div>
      <div className="text-sm p-2">{description}</div>
      <ul className="text-sm p-2">
        <li>🧠 Model Size: {size_in_MiB} MiB</li>
        <li>
          🐍 Python Environment Size: {pythonEnvironment.size_in_MiB[platformToKey(platform)]} MiB
        </li>
      </ul>
      <div className="flex justify-center p-2">
        {isDownloading ? (
          <button
            className={`bg-gray-200 text-gray-500 cursor-not-allowed w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-300 px-2 h-8 text-sm shadow-sm rounded-md`}
          >
            <LucideLoader color="black" size={14} />
            Downloading
          </button>
        ) : isDownloaded ? (
          <button
            onClick={() => handleDelete(reference)}
            className={` bg-red-300 cursor-pointer w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-red-400`}
          >
            <CircleX color="black" size={14} />
            Delete
          </button>
        ) : (
          <button
            onClick={() =>
              handleDownload({ modelReference: reference, pythonEnvironment: pythonEnvironment })
            }
            className={` bg-blue-100 cursor-pointer w-[60%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-blue-200`}
          >
            <Download color="black" size={14} />
            Download
          </button>
        )}
      </div>
    </div>
  )
}

export default function Zoo() {
  const handleClearAllMLModels = async () => {
    console.log('handling clear all...')
    try {
      await window.api.clearAllLocalMLModels()
    } catch (error) {
      console.error('Failed to clear all the local models:', error)
    }
  }
  return (
    <div>
      <button
        onClick={() => handleClearAllMLModels()}
        className={` bg-white cursor-pointer w-[80%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
      >
        <CircleX color="black" size={14} />
        Clear All
      </button>
      <div className="flex h-full p-2">
        {MODEL_ZOO.map((entry) => (
          <ModelCard
            key={entry.reference.id}
            model={entry}
            pythonEnvironment={findPythonEnvironment(entry.python_environment)}
            platform={window.electron.process.platform}
          />
        ))}
      </div>
    </div>
  )
}
