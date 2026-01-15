import 'leaflet/dist/leaflet.css'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { modelZoo } from '../../shared/mlmodels.js'
import { useQueryClient } from '@tanstack/react-query'
import CountryPickerModal from './CountryPickerModal.jsx'
import GbifImportProgress from './GbifImportProgress.jsx'
import DemoImportProgress from './DemoImportProgress.jsx'
import LilaImportProgress from './LilaImportProgress.jsx'

function ImportButton({ onClick, children, className = '', disabled = false, ...props }) {
  const [isImporting, setIsImporting] = useState(false)

  const handleClick = async () => {
    setIsImporting(true)
    try {
      await onClick()
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isImporting || disabled}
      className={`cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50 ${
        isImporting || disabled ? 'opacity-70' : ''
      } ${className}`}
      {...props}
    >
      {isImporting ? <span className="animate-pulse">Importing...</span> : children}
    </button>
  )
}

function GbifImportCard({ onImport }) {
  const [gbifDatasets, setGbifDatasets] = useState([])
  const [selectedGbifDataset, setSelectedGbifDataset] = useState(null)
  const [loadingGbifDatasets, setLoadingGbifDatasets] = useState(false)

  useEffect(() => {
    fetchGbifDatasets()
  }, [])

  const fetchGbifDatasets = async () => {
    setLoadingGbifDatasets(true)
    try {
      const response = await fetch('https://api.gbif.org/v1/dataset/search?q=CAMTRAP_DP')
      const data = await response.json()
      setGbifDatasets(data.results || [])
      if (data.results && data.results.length > 0) {
        setSelectedGbifDataset(data.results[0])
      }
    } catch (error) {
      console.error('Failed to fetch GBIF datasets:', error)
    } finally {
      setLoadingGbifDatasets(false)
    }
  }

  const handleGbifDataset = async () => {
    if (!selectedGbifDataset) return

    await onImport(selectedGbifDataset.key)
  }

  return (
    <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
      <h3 className="text-lg mb-2">GBIF Dataset</h3>
      <p className="text-sm text-gray-500 mb-4">
        Import a published camera trap dataset in the Camera Trap Data Package format from GBIF.
      </p>
      <div className="flex gap-2 justify-start">
        <select
          value={selectedGbifDataset?.key || ''}
          onChange={(e) => {
            const dataset = gbifDatasets.find((d) => d.key === e.target.value)
            setSelectedGbifDataset(dataset || null)
          }}
          disabled={loadingGbifDatasets}
          className="w-full flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
        >
          {loadingGbifDatasets ? (
            <option>Loading datasets...</option>
          ) : gbifDatasets.length === 0 ? (
            <option>No datasets available</option>
          ) : (
            gbifDatasets.map((dataset) => (
              <option key={dataset.key} value={dataset.key}>
                {dataset.title}
              </option>
            ))
          )}
        </select>
        <ImportButton
          onClick={handleGbifDataset}
          className="whitespace-nowrap flex-1"
          disabled={!selectedGbifDataset || loadingGbifDatasets}
        >
          Import GBIF Dataset
        </ImportButton>
      </div>
    </div>
  )
}

function LilaImportCard({ onImport }) {
  const [lilaDatasets, setLilaDatasets] = useState([])
  const [selectedLilaDataset, setSelectedLilaDataset] = useState(null)
  const [loadingLilaDatasets, setLoadingLilaDatasets] = useState(false)

  useEffect(() => {
    fetchLilaDatasets()
  }, [])

  const fetchLilaDatasets = async () => {
    setLoadingLilaDatasets(true)
    try {
      const datasets = await window.api.getLilaDatasets()
      setLilaDatasets(datasets || [])
      if (datasets && datasets.length > 0) {
        setSelectedLilaDataset(datasets[0])
      }
    } catch (error) {
      console.error('Failed to fetch LILA datasets:', error)
    } finally {
      setLoadingLilaDatasets(false)
    }
  }

  const handleLilaDataset = async () => {
    if (!selectedLilaDataset) return
    await onImport(selectedLilaDataset.id)
  }

  return (
    <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
      <h3 className="text-lg mb-2">LILA Dataset</h3>
      <p className="text-sm text-gray-500 mb-4">
        Import a camera trap dataset from LILA. Images are loaded remotely - no download required.
      </p>
      <div className="flex gap-2 justify-start">
        <select
          value={selectedLilaDataset?.id || ''}
          onChange={(e) => {
            const dataset = lilaDatasets.find((d) => d.id === e.target.value)
            setSelectedLilaDataset(dataset || null)
          }}
          disabled={loadingLilaDatasets}
          className="w-full flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
        >
          {loadingLilaDatasets ? (
            <option>Loading datasets...</option>
          ) : lilaDatasets.length === 0 ? (
            <option>No datasets available</option>
          ) : (
            lilaDatasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name} ({dataset.imageCount?.toLocaleString()} images)
              </option>
            ))
          )}
        </select>
        <ImportButton
          onClick={handleLilaDataset}
          className="whitespace-nowrap flex-1"
          disabled={!selectedLilaDataset || loadingLilaDatasets}
        >
          Import LILA Dataset
        </ImportButton>
      </div>
    </div>
  )
}

export default function Import({ onNewStudy }) {
  let navigate = useNavigate()
  const [selectedModel, setSelectedModel] = useState(modelZoo[0]?.reference || null)
  const [installedModels, setInstalledModels] = useState([])
  const [installedEnvironments, setInstalledEnvironments] = useState([])
  const [showCountryPicker, setShowCountryPicker] = useState(false)
  const [pendingDirectoryPath, setPendingDirectoryPath] = useState(null)
  const queryClient = useQueryClient()

  // GBIF import progress state
  const [gbifImportProgress, setGbifImportProgress] = useState(null)
  const [isGbifImporting, setIsGbifImporting] = useState(false)

  // Demo import progress state
  const [demoImportProgress, setDemoImportProgress] = useState(null)
  const [isDemoImporting, setIsDemoImporting] = useState(false)

  // LILA import progress state
  const [lilaImportProgress, setLilaImportProgress] = useState(null)
  const [isLilaImporting, setIsLilaImporting] = useState(false)

  // Listen for GBIF import progress events
  useEffect(() => {
    const cleanup = window.api.onGbifImportProgress?.((progress) => {
      setGbifImportProgress(progress)
    })
    return cleanup
  }, [])

  // Listen for Demo import progress events
  useEffect(() => {
    const cleanup = window.api.onDemoImportProgress?.((progress) => {
      setDemoImportProgress(progress)
    })
    return cleanup
  }, [])

  // Listen for LILA import progress events
  useEffect(() => {
    const cleanup = window.api.onLilaImportProgress?.((progress) => {
      setLilaImportProgress(progress)
    })
    return cleanup
  }, [])

  const isModelInstalled = useCallback(
    (modelReference) => {
      return installedModels.some(
        (installed) =>
          installed.id === modelReference.id && installed.version === modelReference.version
      )
    },
    [installedModels]
  )

  const isEnvironmentInstalled = useCallback(
    (environmentReference) => {
      return installedEnvironments.some(
        (installed) =>
          installed.id === environmentReference.id &&
          installed.version === environmentReference.version
      )
    },
    [installedEnvironments]
  )

  const isModelCompletelyInstalled = useCallback(
    (modelReference) => {
      const model = modelZoo.find(
        (m) =>
          m.reference.id === modelReference.id && m.reference.version === modelReference.version
      )
      if (!model) return false

      return isModelInstalled(model.reference) && isEnvironmentInstalled(model.pythonEnvironment)
    },
    [isModelInstalled, isEnvironmentInstalled]
  )

  useEffect(() => {
    const fetchInstalledData = async () => {
      try {
        const [models, environments] = await Promise.all([
          window.api.listInstalledMLModels(),
          window.api.listInstalledMLModelEnvironments()
        ])

        setInstalledModels(models)
        setInstalledEnvironments(environments)

        // Set the selected model to the first completely installed model
        const completelyInstalledModels = modelZoo.filter((model) => {
          const modelInstalled = models.some(
            (inst) => inst.id === model.reference.id && inst.version === model.reference.version
          )
          const envInstalled = environments.some(
            (env) =>
              env.id === model.pythonEnvironment.id &&
              env.version === model.pythonEnvironment.version
          )
          return modelInstalled && envInstalled
        })

        if (completelyInstalledModels.length > 0) {
          const firstCompleteModel = completelyInstalledModels[0]
          if (!selectedModel || !isModelCompletelyInstalled(selectedModel)) {
            setSelectedModel(firstCompleteModel.reference)
          }
        }
      } catch (error) {
        console.error('Failed to fetch installed models and environments:', error)
        setInstalledModels([])
        setInstalledEnvironments([])
      }
    }
    fetchInstalledData()
  }, [selectedModel, isModelCompletelyInstalled])

  const getCompletelyInstalledModels = () => {
    return modelZoo.filter(
      (model) =>
        isModelInstalled(model.reference) && isEnvironmentInstalled(model.pythonEnvironment)
    )
  }

  const getInstalledModels = () => {
    return modelZoo.filter((model) => isModelInstalled(model.reference))
  }

  const handleCamTrapDP = async () => {
    const { id } = await window.api.selectCamtrapDPDataset()
    if (!id) return
    // onNewStudy({ id, name: data.name, data, path })
    queryClient.invalidateQueries(['studies'])
    navigate(`/study/${id}`)
  }

  const handleWildlifeInsights = async () => {
    const { data, id, path } = await window.api.selectWildlifeDataset()
    console.log('Wildlife Insights select', path)
    if (!id) return
    onNewStudy({ id, name: data.name, data, path })
    navigate(`/study/${id}`)
  }

  const handleDeepfauneCSV = async () => {
    const { data, id, path } = await window.api.selectDeepfauneDataset()
    console.log('Deepfaune CSV select', path)
    if (!id) return
    onNewStudy({ id, name: data.name, data, path })
    navigate(`/study/${id}`)
  }

  const handleDemoDataset = async () => {
    try {
      setIsDemoImporting(true)
      setDemoImportProgress({
        stage: 'downloading',
        stageIndex: 0,
        totalStages: 3,
        datasetTitle: 'Demo Dataset'
      })

      const { data, id } = await window.api.downloadDemoDataset()

      if (!id) {
        setIsDemoImporting(false)
        setDemoImportProgress(null)
        return
      }

      console.log('Demo dataset downloaded:', data, id)

      // Brief delay to show completion state, then navigate
      setTimeout(() => {
        setIsDemoImporting(false)
        setDemoImportProgress(null)
        onNewStudy({ id, name: data.name, data })
        navigate(`/study/${id}`)
      }, 800)
    } catch (error) {
      console.error('Failed to import demo dataset:', error)
      // Error state is already set via IPC progress event
      // Don't reset state here - let user see the error and dismiss manually
    }
  }

  const handleCloseDemoImport = () => {
    setIsDemoImporting(false)
    setDemoImportProgress(null)
  }

  const handleImportImages = async () => {
    // Check if the selected model is SpeciesNet
    const isSpeciesNet = selectedModel && selectedModel.id === 'speciesnet'

    // First select directory
    const result = await window.api.selectImagesDirectoryOnly()
    if (!result.success || !result.directoryPath) return

    if (isSpeciesNet) {
      // For SpeciesNet, show country picker then import with model + country
      setPendingDirectoryPath(result.directoryPath)
      setShowCountryPicker(true)
    } else {
      // For DeepFaune and other models, import directly with model (no country needed)
      const { id } = await window.api.selectImagesDirectoryWithModel(
        result.directoryPath,
        selectedModel,
        null // no country needed
      )
      // Errors (e.g., ML server failed to start) are handled via IPC event in base.jsx
      if (!id) return
      queryClient.invalidateQueries(['studies'])
      navigate(`/study/${id}`)
    }
  }

  const handleCountrySelected = async (countryCode) => {
    if (!pendingDirectoryPath) return

    // Close modal immediately - don't wait for server startup
    const directoryPath = pendingDirectoryPath
    setShowCountryPicker(false)
    setPendingDirectoryPath(null)

    const { id } = await window.api.selectImagesDirectoryWithModel(
      directoryPath,
      selectedModel,
      countryCode
    )
    // Errors (e.g., ML server failed to start) are handled via IPC event in base.jsx
    if (!id) return

    queryClient.invalidateQueries(['studies'])
    navigate(`/study/${id}`)
  }

  const handleCountryPickerCancel = () => {
    setShowCountryPicker(false)
    setPendingDirectoryPath(null)
  }

  const handleGbifImport = async (key) => {
    try {
      setIsGbifImporting(true)
      setGbifImportProgress({
        stage: 'fetching_metadata',
        stageIndex: 0,
        totalStages: 4,
        stageName: 'Starting import...'
      })

      const { data, id, path } = await window.api.importGbifDataset(key)

      if (!id) {
        setIsGbifImporting(false)
        setGbifImportProgress(null)
        return
      }

      console.log('GBIF dataset imported:', data, id)

      // Brief delay to show completion state, then navigate
      setTimeout(() => {
        setIsGbifImporting(false)
        setGbifImportProgress(null)
        onNewStudy({ id, name: data.name, data, path })
        navigate(`/study/${id}`)
      }, 800)
    } catch (error) {
      console.error('Failed to import GBIF dataset:', error)
      // Error state is already set via IPC progress event
      // Don't reset state here - let user see the error and dismiss manually
    }
  }

  const handleCancelGbifImport = () => {
    setIsGbifImporting(false)
    setGbifImportProgress(null)
  }

  const handleLilaImport = async (datasetId) => {
    try {
      setIsLilaImporting(true)
      setLilaImportProgress({
        stage: 'downloading',
        stageIndex: 0,
        totalStages: 3,
        datasetTitle: 'LILA Dataset'
      })

      const { data, id } = await window.api.importLilaDataset(datasetId)

      if (!id) {
        setIsLilaImporting(false)
        setLilaImportProgress(null)
        return
      }

      console.log('LILA dataset imported:', data, id)

      // Brief delay to show completion state, then navigate
      setTimeout(() => {
        setIsLilaImporting(false)
        setLilaImportProgress(null)
        onNewStudy({ id, name: data.name, data })
        navigate(`/study/${id}`)
      }, 800)
    } catch (error) {
      console.error('Failed to import LILA dataset:', error)
      // Error state is already set via IPC progress event
    }
  }

  const handleCancelLilaImport = () => {
    setIsLilaImporting(false)
    setLilaImportProgress(null)
  }

  return (
    <div className="flex h-full p-8 overflow-auto">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <p className="text-gray-500">
            Import your dataset and we'll generate summaries and visualizations for you.
          </p>
        </div>

        {/* Images Directory Card - Full Width Row */}
        <div className="mb-6">
          <div className="border border-gray-300 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
            <h3 className="text-xl font-semibold mb-2">Images Directory</h3>
            <p className="text-sm text-gray-600 mb-4">
              Import a directory of images and automatically detect and classify species using AI
              models.
            </p>
            {getCompletelyInstalledModels().length === 0 ? (
              /* No complete models installed - show Install AI Models button */
              <div className="flex gap-2 justify-start">
                <button
                  onClick={() => navigate('/settings/ml_zoo')}
                  className="cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-blue-200 bg-blue-50 hover:bg-blue-100 px-4 h-10 text-sm shadow-sm rounded-md text-blue-700 font-medium"
                >
                  {getInstalledModels().length === 0
                    ? 'Install AI Models'
                    : 'Install AI Environments'}
                </button>
              </div>
            ) : (
              /* Some models installed - show enhanced dropdown */
              <div className="flex gap-2 justify-start">
                <select
                  value={selectedModel ? `${selectedModel.id}-${selectedModel.version}` : ''}
                  onChange={(e) => {
                    const [id, version] = e.target.value.split('-')
                    const model = modelZoo.find(
                      (m) => m.reference.id === id && m.reference.version === version
                    )
                    // Only allow selecting completely installed models
                    if (model && isModelCompletelyInstalled(model.reference)) {
                      setSelectedModel(model.reference)
                    }
                  }}
                  className="w-full flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {modelZoo.map((model) => {
                    const modelInstalled = isModelInstalled(model.reference)
                    const envInstalled = isEnvironmentInstalled(model.pythonEnvironment)
                    const completelyInstalled = modelInstalled && envInstalled

                    let statusText = ''
                    if (!modelInstalled) {
                      statusText = ' (not installed)'
                    } else if (!envInstalled) {
                      statusText = ' (environment missing)'
                    }

                    return (
                      <option
                        key={`${model.reference.id}-${model.reference.version}`}
                        value={`${model.reference.id}-${model.reference.version}`}
                        disabled={!completelyInstalled}
                        style={{
                          color: completelyInstalled ? 'black' : '#9ca3af',
                          fontStyle: completelyInstalled ? 'normal' : 'italic'
                        }}
                      >
                        {model.name} v{model.reference.version}
                        {statusText}
                      </option>
                    )
                  })}
                </select>
                <ImportButton onClick={handleImportImages} className="whitespace-nowrap flex-2 ">
                  Select Images folder
                </ImportButton>
              </div>
            )}
          </div>
        </div>

        {/* Other Import Methods - Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-8">
          {/* Demo Dataset Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">Demo Dataset</h3>
            <p className="text-sm text-gray-500 mb-4">
              Import a sample dataset to explore the application features and functionality.
            </p>
            <div className="flex justify-start">
              <ImportButton onClick={handleDemoDataset} data-testid="import-demo-btn" className="">
                Use Demo Dataset
              </ImportButton>
            </div>
          </div>

          {/* Camtrap DP Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">Camtrap DP</h3>
            <p className="text-sm text-gray-500 mb-4">
              Import a camera trap dataset in the Camera Trap Data Package format.
            </p>
            <div className="flex justify-start">
              <ImportButton onClick={handleCamTrapDP} data-testid="import-camtrap-btn" className="">
                Select Camtrap DP
              </ImportButton>
            </div>
          </div>

          {/* Wildlife Insights Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">Wildlife Insights</h3>
            <p className="text-sm text-gray-500 mb-4">
              Import a camera trap dataset in the Wildlife Insights format.
            </p>
            <div className="flex justify-start">
              <ImportButton
                onClick={handleWildlifeInsights}
                data-testid="import-wildlife-btn"
                className=""
              >
                Select Wildlife Insights
              </ImportButton>
            </div>
          </div>

          {/* Deepfaune CSV Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">Deepfaune CSV</h3>
            <p className="text-sm text-gray-500 mb-4">
              Import Deepfaune predictions (species identifications + confidence scores).
            </p>
            <div className="flex justify-start">
              <ImportButton onClick={handleDeepfauneCSV} className="">
                Select Deepfaune CSV
              </ImportButton>
            </div>
          </div>

          {/* GBIF Dataset Card */}
          <GbifImportCard onImport={handleGbifImport} />

          {/* LILA Dataset Card */}
          <LilaImportCard onImport={handleLilaImport} />
        </div>
      </div>

      <CountryPickerModal
        isOpen={showCountryPicker}
        onConfirm={handleCountrySelected}
        onCancel={handleCountryPickerCancel}
      />

      <GbifImportProgress
        isOpen={isGbifImporting}
        progress={gbifImportProgress}
        onCancel={handleCancelGbifImport}
      />

      <DemoImportProgress
        isOpen={isDemoImporting}
        progress={demoImportProgress}
        onClose={handleCloseDemoImport}
      />

      <LilaImportProgress
        isOpen={isLilaImporting}
        progress={lilaImportProgress}
        onCancel={handleCancelLilaImport}
      />
    </div>
  )
}
