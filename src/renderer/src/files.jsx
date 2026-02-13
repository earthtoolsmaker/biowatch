import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router'
import { FolderIcon, PencilIcon } from 'lucide-react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useImportStatus } from '@renderer/hooks/import'
import { modelZoo } from '../../shared/mlmodels.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'
import CountryPickerModal from './CountryPickerModal.jsx'

export default function Files({ studyId }) {
  const { id } = useParams()
  const actualStudyId = studyId || id
  const queryClient = useQueryClient()
  const { importStatus } = useImportStatus(actualStudyId)

  // Model picker state
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [selectedModel, setSelectedModel] = useState(null)
  const [installedModels, setInstalledModels] = useState([])
  const [installedEnvironments, setInstalledEnvironments] = useState([])
  const [showCountryPicker, setShowCountryPicker] = useState(false)

  const isModelInstalled = useCallback(
    (modelReference) =>
      installedModels.some(
        (inst) => inst.id === modelReference.id && inst.version === modelReference.version
      ),
    [installedModels]
  )

  const isEnvironmentInstalled = useCallback(
    (envReference) =>
      installedEnvironments.some(
        (inst) => inst.id === envReference.id && inst.version === envReference.version
      ),
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

  // Fetch installed models/environments on mount
  useEffect(() => {
    const fetchInstalled = async () => {
      try {
        const [models, environments] = await Promise.all([
          window.api.listInstalledMLModels(),
          window.api.listInstalledMLModelEnvironments()
        ])
        setInstalledModels(models)
        setInstalledEnvironments(environments)
      } catch (error) {
        console.error('Failed to fetch installed models:', error)
      }
    }
    fetchInstalled()
  }, [])

  const handleAddFolder = async () => {
    // Fetch latest model run for pre-selection
    const latestRunResult = await window.api.getLatestModelRun(id)
    const latestData = latestRunResult?.data

    if (latestData?.modelReference && isModelCompletelyInstalled(latestData.modelReference)) {
      setSelectedModel(latestData.modelReference)
    } else {
      // Default to first completely installed model
      const firstInstalled = modelZoo.find(
        (m) => isModelInstalled(m.reference) && isEnvironmentInstalled(m.pythonEnvironment)
      )
      setSelectedModel(firstInstalled?.reference || null)
    }

    setShowModelPicker(true)
  }

  const handleModelPickerConfirm = async () => {
    setShowModelPicker(false)

    if (!selectedModel) return

    const isSpeciesNet = selectedModel.id === 'speciesnet'
    if (isSpeciesNet) {
      setShowCountryPicker(true)
    } else {
      await startImport(selectedModel, null)
    }
  }

  const handleCountrySelected = async (countryCode) => {
    setShowCountryPicker(false)
    await startImport(selectedModel, countryCode)
  }

  const startImport = async (modelReference, country) => {
    await window.api.selectMoreImagesDirectory(id, modelReference, country)
    queryClient.invalidateQueries({ queryKey: ['importStatus', id] })
    queryClient.invalidateQueries({ queryKey: ['filesData', actualStudyId] })
  }

  const {
    data: filesData,
    isLoading: loading,
    error
  } = useQuery({
    queryKey: ['filesData', actualStudyId, importStatus?.isRunning],
    queryFn: async () => {
      const response = await window.api.getFilesData(actualStudyId)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    refetchInterval: () => {
      // Only poll if import is running
      return importStatus?.isRunning ? 3000 : false
    },
    enabled: !!actualStudyId
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading files data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Error: {error.message}</div>
      </div>
    )
  }

  if (!filesData || filesData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">No files data available</div>
      </div>
    )
  }

  const formatPercentage = (processed, total) => {
    if (total === 0) return '0%'
    return `${Math.round((processed / total) * 100)}%`
  }

  const importFolders = Object.groupBy(filesData, (c) => c.importFolder)

  console.log('Files data:', filesData, importFolders)

  const handleEditImportFolder = async (importFolder) => {
    const result = await window.api.updateImportFolder(actualStudyId, importFolder)
    if (result?.data) {
      // Invalidate all queries so updated file paths are picked up everywhere
      queryClient.invalidateQueries()
    }
  }

  return (
    <div className="px-8 py-3 h-full overflow-y-auto space-y-6">
      <header>
        <button
          onClick={handleAddFolder}
          className={`cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50`}
        >
          Add Folder
        </button>
      </header>

      {/* Model Picker Modal */}
      {showModelPicker && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowModelPicker(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Select Model</h2>
              <p className="text-sm text-gray-500 mt-1">
                Choose a model to classify images in the new folder.
              </p>
            </div>

            <div className="px-6 py-4">
              <Select
                value={selectedModel ? `${selectedModel.id}-${selectedModel.version}` : ''}
                onValueChange={(value) => {
                  const [modelId, version] = value.split('-')
                  const model = modelZoo.find(
                    (m) => m.reference.id === modelId && m.reference.version === version
                  )
                  if (model && isModelCompletelyInstalled(model.reference)) {
                    setSelectedModel(model.reference)
                  }
                }}
              >
                <SelectTrigger className="w-full bg-white border-gray-200 h-11">
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
                    const completelyInstalled =
                      isModelInstalled(model.reference) &&
                      isEnvironmentInstalled(model.pythonEnvironment)

                    let statusText = ''
                    if (!isModelInstalled(model.reference)) {
                      statusText = ' (not installed)'
                    } else if (!isEnvironmentInstalled(model.pythonEnvironment)) {
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
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowModelPicker(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleModelPickerConfirm}
                disabled={!selectedModel}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Select Folder
              </button>
            </div>
          </div>
        </div>
      )}

      <CountryPickerModal
        isOpen={showCountryPicker}
        onConfirm={handleCountrySelected}
        onCancel={() => setShowCountryPicker(false)}
      />
      <div className="space-y-6">
        {Object.entries(importFolders).map(([importFolder, directories]) => (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200" key={importFolder}>
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{importFolder}</span>
                  <button
                    onClick={() => handleEditImportFolder(importFolder)}
                    className="cursor-pointer flex-shrink-0 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Change folder path"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-sm text-gray-500 flex-shrink-0 ml-4">
                  {directories.length} {directories.length === 1 ? 'directory' : 'directories'}
                </div>
              </div>
            </div>

            <div className="divide-y divide-gray-200">
              {directories.map((directory, index) => (
                <div key={index} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-3">
                      <FolderIcon className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {directory.folderName}
                        </div>
                        {directory.lastModelUsed && (
                          <div className="text-xs text-gray-500 truncate">
                            Model: {directory.lastModelUsed}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-6 ml-4">
                      <div className="text-right">
                        <div className="text-sm font-medium text-gray-900">
                          {directory.imageCount === 0 && directory.videoCount === 0
                            ? '0 media files'
                            : directory.imageCount === 0
                              ? `${directory.videoCount} videos`
                              : directory.videoCount > 0
                                ? `${directory.imageCount} images, ${directory.videoCount} videos`
                                : `${directory.imageCount} images`}
                        </div>
                        <div className="text-sm text-gray-500">
                          {directory.processedCount} processed
                        </div>
                      </div>

                      <div className="text-right min-w-[60px]">
                        <div className="text-sm font-medium text-gray-900">
                          {formatPercentage(
                            directory.processedCount,
                            directory.imageCount + (directory.videoCount || 0)
                          )}
                        </div>
                        <div className="w-16 bg-gray-200 rounded-full h-2 mt-1">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(
                                (directory.processedCount /
                                  (directory.imageCount + (directory.videoCount || 0))) *
                                  100,
                                100
                              )}%`
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
