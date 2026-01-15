import 'leaflet/dist/leaflet.css'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { modelZoo } from '../../shared/mlmodels.js'
import { useQueryClient } from '@tanstack/react-query'
import CountryPickerModal from './CountryPickerModal.jsx'
import GbifImportProgress from './GbifImportProgress.jsx'
import DemoImportProgress from './DemoImportProgress.jsx'
import LilaImportProgress from './LilaImportProgress.jsx'
import { Database, FolderOpen, Camera, FileSpreadsheet, Globe, Sparkles } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Card, CardContent } from './ui/card.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'

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

  // Fetch GBIF datasets on mount
  useEffect(() => {
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

  const selectedModelDisplayText = useMemo(() => {
    if (!selectedModel) return 'Select a model'
    
    const model = modelZoo.find(
      (m) =>
        m.reference.id === selectedModel.id &&
        m.reference.version === selectedModel.version
    )
    return model ? `${model.name} v${model.reference.version}` : 'Model not found'
  }, [selectedModel])

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
      if (!id) return
      queryClient.invalidateQueries(['studies'])
      navigate(`/study/${id}`)
    }
  }

  const handleCountrySelected = async (countryCode) => {
    if (!pendingDirectoryPath) return

    const { id } = await window.api.selectImagesDirectoryWithModel(
      pendingDirectoryPath,
      selectedModel,
      countryCode
    )
    if (!id) return

    setShowCountryPicker(false)
    setPendingDirectoryPath(null)
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

  // Direct handlers for inline buttons
  const handleGbifDataset = async () => {
    if (!selectedGbifDataset) return
    await handleGbifImport(selectedGbifDataset.key)
  }

  const handleLilaDataset = async () => {
    if (!selectedLilaDataset) return
    await handleLilaImport(selectedLilaDataset.id)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="size-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Database className="size-5 text-blue-600" />
            </div>
            <h1 className="text-2xl font-semibold">Import Dataset</h1>
          </div>
          <p className="text-gray-500">
            Import a dataset using one of the supported formats. After importing, we will generate
            summary and visualisations.
          </p>
        </div>

        {/* Primary Import - Featured */}
        <Card className="mb-8 border-2 border-blue-500/20 bg-linear-to-br from-blue-50/50 to-blue-100/30 shadow-lg">
          <CardContent className="p-6">
            <div className="flex gap-5 items-start mb-5">
              <div className="size-14 rounded-2xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0 shadow-lg">
                <FolderOpen className="size-7 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl font-semibold">Images Directory</h3>
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-xs border border-blue-500/20">
                    Recommended
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  Import images and automatically detect and classify species using AI models.
                </p>
              </div>
            </div>

            {getCompletelyInstalledModels().length === 0 ? (
              /* No complete models installed - show Install AI Models button */
              <div className="flex gap-3 items-end">
                <Button onClick={() => navigate('/settings/ml_zoo')} className="h-11 px-6">
                  {getInstalledModels().length === 0
                    ? 'Install AI Models'
                    : 'Install AI Environments'}
                </Button>
              </div>
            ) : (
              /* Some models installed - show enhanced dropdown */
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block mb-2 text-sm font-medium">Classification Model</label>
                  <div className="flex gap-3">
                    <div className="relative w-60">
                      <Select
                        value={selectedModel ? `${selectedModel.id}-${selectedModel.version}` : ''}
                        onValueChange={(value) => {
                          const [id, version] = value.split('-')
                          const model = modelZoo.find(
                            (m) => m.reference.id === id && m.reference.version === version
                          )
                          if (model && isModelCompletelyInstalled(model.reference)) {
                            setSelectedModel(model.reference)
                          }
                        }}
                      >
                        <SelectTrigger className="bg-white border-gray-200 h-11 w-full">
                          <SelectValue>{selectedModelDisplayText}</SelectValue>
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
                                className={
                                  !completelyInstalled ? 'opacity-50 cursor-not-allowed' : ''
                                }
                              >
                                {model.name} v{model.reference.version}
                                {statusText}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleImportImages} className="h-11 px-6">
                      <FolderOpen className="size-4 mr-2" />
                      Select Folder
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alternative Import Methods */}
        <div className="mb-3">
          <h4 className="text-sm font-medium text-gray-500">Alternative Import Formats</h4>
        </div>

        <div className="space-y-3">
          {/* Demo Dataset Card */}
          <Card className="group hover:border-blue-500/20 transition-all hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                  <Sparkles className="size-5 text-gray-500 group-hover:text-blue-600 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="mb-1 font-medium">Demo Dataset</h4>
                  <p className="text-sm text-gray-500">Explore features with sample data</p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0 w-40"
                  onClick={handleDemoDataset}
                  data-testid="import-demo-btn"
                >
                  Select
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Camtrap DP Card */}
          <Card className="group hover:border-blue-500/20 transition-all hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                  <Camera className="size-5 text-gray-500 group-hover:text-blue-600 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="mb-1 font-medium">Camtrap DP</h4>
                  <p className="text-sm text-gray-500">Camera Trap Data Package format</p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0 w-40"
                  onClick={handleCamTrapDP}
                  data-testid="import-camtrap-btn"
                >
                  Select
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Wildlife Insights Card */}
          <Card className="group hover:border-blue-500/20 transition-all hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                  <Camera className="size-5 text-gray-500 group-hover:text-blue-600 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="mb-1 font-medium">Wildlife Insights</h4>
                  <p className="text-sm text-gray-500">Wildlife Insights format</p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0 w-40"
                  onClick={handleWildlifeInsights}
                  data-testid="import-wildlife-btn"
                >
                  Select
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Deepfaune CSV Card */}
          <Card className="group hover:border-blue-500/20 transition-all hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                  <FileSpreadsheet className="size-5 text-gray-500 group-hover:text-blue-600 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="mb-1 font-medium">Deepfaune CSV</h4>
                  <p className="text-sm text-gray-500">Deepfaune predictions</p>
                </div>
                <Button variant="outline" className="shrink-0 w-40" onClick={handleDeepfauneCSV}>
                  Select
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* GBIF Dataset Card */}
          <Card className="group hover:border-blue-500/20 transition-all hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                  <Globe className="size-5 text-gray-500 group-hover:text-blue-600 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="mb-1 font-medium">GBIF Dataset</h4>
                  <p className="text-sm text-gray-500 mb-3">Published Camera Trap format</p>
                  <div className="flex gap-3">
                    <select
                      value={selectedGbifDataset?.key || ''}
                      onChange={(e) => {
                        const dataset = gbifDatasets.find((d) => d.key === e.target.value)
                        setSelectedGbifDataset(dataset || null)
                      }}
                      disabled={loadingGbifDatasets}
                      className="w-full max-w-lg px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 truncate"
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
                    <Button
                      variant="outline"
                      className="shrink-0 w-40 ml-auto"
                      onClick={handleGbifDataset}
                      disabled={!selectedGbifDataset || loadingGbifDatasets}
                    >
                      Select
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LILA Dataset Card */}
          <Card className="group hover:border-blue-500/20 transition-all hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                  <Database className="size-5 text-gray-500 group-hover:text-blue-600 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="mb-1 font-medium">LILA Dataset</h4>
                  <p className="text-sm text-gray-500 mb-3">
                    LILA camera trap datasets (remote access)
                  </p>
                  <div className="flex gap-3">
                    <select
                      value={selectedLilaDataset?.id || ''}
                      onChange={(e) => {
                        const dataset = lilaDatasets.find((d) => d.id === e.target.value)
                        setSelectedLilaDataset(dataset || null)
                      }}
                      disabled={loadingLilaDatasets}
                      className="w-full max-w-lg px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 truncate"
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
                    <Button
                      variant="outline"
                      className="shrink-0 w-40 ml-auto"
                      onClick={handleLilaDataset}
                      disabled={!selectedLilaDataset || loadingLilaDatasets}
                    >
                      Select
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
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
