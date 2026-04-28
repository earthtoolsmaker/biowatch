import 'leaflet/dist/leaflet.css'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { modelZoo } from '../../shared/mlmodels.js'
import { getGbifTitle, isGbifAvailable } from '../../shared/gbifTitles.js'
import { useQueryClient } from '@tanstack/react-query'
import CountryPickerModal from './CountryPickerModal.jsx'
import GbifImportProgress from './GbifImportProgress.jsx'
import DemoImportProgress from './DemoImportProgress.jsx'
import LilaImportProgress from './LilaImportProgress.jsx'
import CamtrapDPImportProgress from './CamtrapDPImportProgress.jsx'
import { toast } from 'sonner'
import {
  Database,
  FolderOpen,
  Camera,
  FileSpreadsheet,
  Globe,
  Sparkles,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Card, CardContent } from './ui/card.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'

function SourceRow({ icon: Icon, title, description, children, className = '' }) {
  return (
    <Card className={`shadow-none hover:border-blue-500/30 transition-colors ${className}`}>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="size-8 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
            <Icon className="size-4 text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium leading-tight">{title}</h4>
            {description && <p className="text-xs text-gray-500 truncate mt-0.5">{description}</p>}
          </div>
          {children}
        </div>
      </CardContent>
    </Card>
  )
}

export default function Import({ studiesCount = 0 }) {
  const navigate = useNavigate()
  const isFirstTimeUser = studiesCount === 0
  const [selectedModel, setSelectedModel] = useState(modelZoo[0]?.reference || null)
  const [installedModels, setInstalledModels] = useState([])
  const [installedEnvironments, setInstalledEnvironments] = useState([])
  const [showCountryPicker, setShowCountryPicker] = useState(false)
  const [pendingDirectoryPath, setPendingDirectoryPath] = useState(null)
  const [showMoreFormats, setShowMoreFormats] = useState(false)
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

  // CamtrapDP import progress state
  const [camtrapDPImportProgress, setCamtrapDPImportProgress] = useState(null)
  const [isCamtrapDPImporting, setIsCamtrapDPImporting] = useState(false)

  // GBIF datasets state
  const [gbifDatasets, setGbifDatasets] = useState([])
  const [selectedGbifDataset, setSelectedGbifDataset] = useState(null)
  const [loadingGbifDatasets, setLoadingGbifDatasets] = useState(false)

  // LILA datasets state
  const [lilaDatasets, setLilaDatasets] = useState([])
  const [selectedLilaDataset, setSelectedLilaDataset] = useState(null)
  const [loadingLilaDatasets, setLoadingLilaDatasets] = useState(false)

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

  // Listen for CamtrapDP import progress events
  useEffect(() => {
    const cleanup = window.api.onCamtrapDPImportProgress?.((progress) => {
      setCamtrapDPImportProgress(progress)
      if (progress.stage === 'error') {
        toast.error('CamtrapDP import failed', {
          description: progress.error?.message || 'Unknown error'
        })
      }
    })
    return cleanup
  }, [])

  // Fetch GBIF datasets on mount
  useEffect(() => {
    const fetchGbifDatasets = async () => {
      setLoadingGbifDatasets(true)
      try {
        const response = await fetch('https://api.gbif.org/v1/dataset/search?q=CAMTRAP_DP')
        const data = await response.json()
        const available = (data.results || []).filter((d) => isGbifAvailable(d.key))
        setGbifDatasets(available)
        if (available.length > 0) {
          setSelectedGbifDataset(available[0])
        }
      } catch (error) {
        console.error('Failed to fetch GBIF datasets:', error)
      } finally {
        setLoadingGbifDatasets(false)
      }
    }
    fetchGbifDatasets()
  }, [])

  // Fetch LILA datasets on mount
  useEffect(() => {
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
    fetchLilaDatasets()
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
          // Use functional update to avoid depending on selectedModel in deps
          setSelectedModel((currentSelected) => {
            if (!currentSelected) {
              return firstCompleteModel.reference
            }
            // Check if current selection is still valid
            const isCurrentValid = completelyInstalledModels.some(
              (m) =>
                m.reference.id === currentSelected.id &&
                m.reference.version === currentSelected.version
            )
            return isCurrentValid ? currentSelected : firstCompleteModel.reference
          })
        }
      } catch (error) {
        console.error('Failed to fetch installed models and environments:', error)
        setInstalledModels([])
        setInstalledEnvironments([])
      }
    }
    fetchInstalledData()
  }, []) // Run only on mount - callbacks close over current state

  const getCompletelyInstalledModels = () => {
    return modelZoo.filter(
      (model) =>
        isModelInstalled(model.reference) && isEnvironmentInstalled(model.pythonEnvironment)
    )
  }

  const handleCamTrapDP = async () => {
    try {
      setIsCamtrapDPImporting(true)
      setCamtrapDPImportProgress({
        stage: 'importing_csvs',
        stageIndex: 0,
        totalStages: 1,
        datasetTitle: 'CamTrap DP Dataset'
      })

      const result = await window.api.selectCamtrapDPDataset()

      if (!result || !result.id) {
        setIsCamtrapDPImporting(false)
        setCamtrapDPImportProgress(null)
        return
      }

      // Brief delay to show completion state, then navigate
      await new Promise((resolve) => setTimeout(resolve, 800))
      setIsCamtrapDPImporting(false)
      setCamtrapDPImportProgress(null)
      await queryClient.invalidateQueries({ queryKey: ['studies'] })
      navigate(`/study/${result.id}`)
    } catch (error) {
      console.error('Failed to import CamTrap DP dataset:', error)
      // Error state is already set via IPC progress event
    }
  }

  const handleCancelCamtrapDPImport = () => {
    setIsCamtrapDPImporting(false)
    setCamtrapDPImportProgress(null)
  }

  const handleWildlifeInsights = async () => {
    const { id, path } = await window.api.selectWildlifeDataset()
    console.log('Wildlife Insights select', path)
    if (!id) return
    await queryClient.invalidateQueries({ queryKey: ['studies'] })
    navigate(`/study/${id}`)
  }

  const handleDeepfauneCSV = async () => {
    const { id, path } = await window.api.selectDeepfauneDataset()
    console.log('Deepfaune CSV select', path)
    if (!id) return
    await queryClient.invalidateQueries({ queryKey: ['studies'] })
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
      await new Promise((resolve) => setTimeout(resolve, 800))
      setIsDemoImporting(false)
      setDemoImportProgress(null)
      await queryClient.invalidateQueries({ queryKey: ['studies'] })
      navigate(`/study/${id}`)
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
      await queryClient.invalidateQueries({ queryKey: ['studies'] })
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

    await queryClient.invalidateQueries({ queryKey: ['studies'] })
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

      const result = await window.api.importGbifDataset(key)

      if (!result || !result.id) {
        setIsGbifImporting(false)
        setGbifImportProgress(null)
        return
      }

      const { data, id } = result
      console.log('GBIF dataset imported:', data, id)

      // Brief delay to show completion state, then navigate
      await new Promise((resolve) => setTimeout(resolve, 800))
      setIsGbifImporting(false)
      setGbifImportProgress(null)
      await queryClient.invalidateQueries({ queryKey: ['studies'] })
      navigate(`/study/${id}`)
    } catch (error) {
      console.error('Failed to import GBIF dataset:', error)
      // Error state is already set via IPC progress event
      // Don't reset state here - let user see the error and dismiss manually
    }
  }

  const handleCancelGbifImport = async () => {
    try {
      await window.api.cancelGbifImport(selectedGbifDataset?.key)
    } catch (e) {
      console.error('Error cancelling GBIF import:', e)
    }
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

      const result = await window.api.importLilaDataset(datasetId)

      if (!result || !result.id) {
        setIsLilaImporting(false)
        setLilaImportProgress(null)
        return
      }

      const { data, id } = result
      console.log('LILA dataset imported:', data, id)

      // Brief delay to show completion state, then navigate
      await new Promise((resolve) => setTimeout(resolve, 800))
      setIsLilaImporting(false)
      setLilaImportProgress(null)
      await queryClient.invalidateQueries({ queryKey: ['studies'] })
      navigate(`/study/${id}`)
    } catch (error) {
      console.error('Failed to import LILA dataset:', error)
      // Error state is already set via IPC progress event
    }
  }

  const handleCancelLilaImport = async () => {
    try {
      await window.api.cancelLilaImport(selectedLilaDataset?.id)
    } catch (e) {
      console.error('Error cancelling LILA import:', e)
    }
    setIsLilaImporting(false)
    setLilaImportProgress(null)
  }

  // Direct handlers for inline buttons
  const handleGbifDataset = async () => {
    if (!selectedGbifDataset) return
    await handleGbifImport(selectedGbifDataset.key)
  }

  const handleLilaDataset = async () => {
    if (!selectedLilaDataset) return
    await handleLilaImport(selectedLilaDataset.id)
  }

  const hasInstalledModels = getCompletelyInstalledModels().length > 0

  const modelSelect = (
    <Select
      value={selectedModel ? `${selectedModel.id}-${selectedModel.version}` : ''}
      onValueChange={(value) => {
        const [id, version] = value.split('-')
        const model = modelZoo.find((m) => m.reference.id === id && m.reference.version === version)
        if (model && isModelCompletelyInstalled(model.reference)) {
          setSelectedModel(model.reference)
        }
      }}
    >
      <SelectTrigger className="w-full sm:max-w-lg bg-white border-gray-200">
        <SelectValue>
          {selectedModel
            ? (() => {
                const model = modelZoo.find(
                  (m) =>
                    m.reference.id === selectedModel.id &&
                    m.reference.version === selectedModel.version
                )
                return model ? `${model.name} v${model.reference.version}` : ''
              })()
            : 'Select a model'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
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
            <SelectItem
              key={`${model.reference.id}-${model.reference.version}`}
              value={`${model.reference.id}-${model.reference.version}`}
              disabled={!completelyInstalled}
              className={!completelyInstalled ? 'opacity-50 cursor-not-allowed' : ''}
            >
              {model.name} v{model.reference.version}
              {statusText}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold mb-1">
            {studiesCount === 0 ? 'Create Your First Study' : 'Create New Study'}
          </h1>
          <p className="text-sm text-gray-500">Choose a data source below.</p>
        </div>

        {/* Hero — recommended path (lighter treatment) */}
        {isFirstTimeUser ? (
          <Card className="mb-3 shadow-none border-l-[3px] border-l-blue-500">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="size-9 rounded-md bg-blue-50 flex items-center justify-center shrink-0">
                  <Sparkles className="size-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">Demo Dataset</h3>
                    <span className="text-xs text-blue-600">Recommended</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Explore all features with sample camera trap data.
                  </p>
                </div>
                <Button
                  onClick={handleDemoDataset}
                  data-testid="import-demo-btn"
                  className="shrink-0"
                >
                  Get Started
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-3 shadow-none border-l-[3px] border-l-blue-500">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="size-9 rounded-md bg-blue-50 flex items-center justify-center shrink-0">
                  <FolderOpen className="size-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">Images Directory</h3>
                    <span className="text-xs text-blue-600">Recommended</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Import images and detect species using AI models.
                    {!hasInstalledModels && ' Install an AI model to get started.'}
                  </p>
                </div>
                {!hasInstalledModels && (
                  <Button onClick={() => navigate('/settings/ml_zoo')} className="shrink-0">
                    Install AI Models
                  </Button>
                )}
              </div>
              {hasInstalledModels && (
                <div className="flex flex-col sm:flex-row gap-2 mt-3 sm:items-center">
                  {modelSelect}
                  <Button onClick={handleImportImages} className="shrink-0 sm:ml-auto sm:w-40">
                    <FolderOpen className="size-4 mr-2" />
                    Select Folder
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tier 1 — primary alternates */}
        <div className="space-y-2">
          {isFirstTimeUser ? (
            // Images Directory as alternate for first-time users
            <Card className="shadow-none hover:border-blue-500/30 transition-colors">
              <CardContent className="p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="size-8 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                    <FolderOpen className="size-4 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium leading-tight">Images Directory</h4>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {hasInstalledModels
                        ? 'Import images and classify species using AI'
                        : 'Install an AI model to import an images folder'}
                    </p>
                  </div>
                  {!hasInstalledModels ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => navigate('/settings/ml_zoo')}
                    >
                      Install AI Models
                    </Button>
                  ) : (
                    <div className="flex flex-1 sm:flex-none sm:basis-auto basis-full min-w-[240px] gap-2 sm:ml-auto">
                      <div className="flex-1">{modelSelect}</div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={handleImportImages}
                      >
                        Select Folder
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            // Demo Dataset as alternate for returning users
            <SourceRow
              icon={Sparkles}
              title="Demo Dataset"
              description="Explore features with sample data"
            >
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleDemoDataset}
                data-testid="import-demo-btn"
              >
                Select
              </Button>
            </SourceRow>
          )}

          <SourceRow icon={Camera} title="Camtrap DP" description="Camera Trap Data Package format">
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={handleCamTrapDP}
              data-testid="import-camtrap-btn"
            >
              Select
            </Button>
          </SourceRow>
        </div>

        {/* Tier 2 — Online datasets */}
        <h4 className="text-xs font-medium text-gray-500 mt-6 mb-2 uppercase tracking-wide">
          Online datasets
        </h4>
        <div className="space-y-2">
          <Card className="shadow-none hover:border-blue-500/30 transition-colors">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="size-8 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                  <Globe className="size-4 text-gray-500" />
                </div>
                <h4 className="text-sm font-medium leading-tight">GBIF</h4>
                <div className="flex flex-1 basis-full sm:basis-auto min-w-[240px] gap-2 sm:ml-auto">
                  <Select
                    value={selectedGbifDataset?.key || ''}
                    onValueChange={(value) => {
                      const dataset = gbifDatasets.find((d) => d.key === value)
                      setSelectedGbifDataset(dataset || null)
                    }}
                    disabled={loadingGbifDatasets}
                  >
                    <SelectTrigger className="flex-1 bg-white border-gray-200">
                      <SelectValue className="truncate">
                        {loadingGbifDatasets
                          ? 'Loading datasets...'
                          : gbifDatasets.length === 0
                            ? 'No datasets available'
                            : selectedGbifDataset
                              ? getGbifTitle(selectedGbifDataset.key, selectedGbifDataset.title)
                              : 'Select a dataset'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {!loadingGbifDatasets &&
                        gbifDatasets.length > 0 &&
                        gbifDatasets.map((dataset) => (
                          <SelectItem key={dataset.key} value={dataset.key}>
                            {getGbifTitle(dataset.key, dataset.title)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={handleGbifDataset}
                    disabled={!selectedGbifDataset || loadingGbifDatasets}
                  >
                    Select
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none hover:border-blue-500/30 transition-colors">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="size-8 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                  <Database className="size-4 text-gray-500" />
                </div>
                <h4 className="text-sm font-medium leading-tight">LILA</h4>
                <div className="flex flex-1 basis-full sm:basis-auto min-w-[240px] gap-2 sm:ml-auto">
                  <Select
                    value={selectedLilaDataset?.id || ''}
                    onValueChange={(value) => {
                      const dataset = lilaDatasets.find((d) => d.id === value)
                      setSelectedLilaDataset(dataset || null)
                    }}
                    disabled={loadingLilaDatasets}
                  >
                    <SelectTrigger className="flex-1 bg-white border-gray-200">
                      <SelectValue className="truncate">
                        {loadingLilaDatasets
                          ? 'Loading datasets...'
                          : lilaDatasets.length === 0
                            ? 'No datasets available'
                            : selectedLilaDataset
                              ? `${selectedLilaDataset.name} (${selectedLilaDataset.imageCount?.toLocaleString()} images)`
                              : 'Select a dataset'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {!loadingLilaDatasets &&
                        lilaDatasets.length > 0 &&
                        lilaDatasets.map((dataset) => (
                          <SelectItem key={dataset.id} value={dataset.id}>
                            {dataset.name} ({dataset.imageCount?.toLocaleString()} images)
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={handleLilaDataset}
                    disabled={!selectedLilaDataset || loadingLilaDatasets}
                  >
                    Select
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tier 3 — More import formats (collapsed) */}
        <button
          type="button"
          onClick={() => setShowMoreFormats((v) => !v)}
          className="flex items-center gap-1 mt-4 mb-2 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors uppercase tracking-wide"
        >
          {showMoreFormats ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          More import formats
        </button>

        {showMoreFormats && (
          <div className="space-y-2">
            <SourceRow
              icon={Camera}
              title="Wildlife Insights"
              description="Wildlife Insights downloaded archive or directory"
            >
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleWildlifeInsights}
                data-testid="import-wildlife-btn"
              >
                Select
              </Button>
            </SourceRow>

            <SourceRow
              icon={FileSpreadsheet}
              title="Deepfaune CSV"
              description="Deepfaune predictions"
            >
              <Button variant="outline" size="sm" className="shrink-0" onClick={handleDeepfauneCSV}>
                Select
              </Button>
            </SourceRow>
          </div>
        )}
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

      <CamtrapDPImportProgress
        isOpen={isCamtrapDPImporting}
        progress={camtrapDPImportProgress}
        onCancel={handleCancelCamtrapDPImport}
      />
    </div>
  )
}
