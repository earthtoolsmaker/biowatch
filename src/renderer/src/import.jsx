import 'leaflet/dist/leaflet.css'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { modelZoo } from '../../shared/mlmodels.js'
import { useQueryClient } from '@tanstack/react-query'

function ImportButton({ onClick, children, className = '', disabled = false }) {
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
        Import camera trap datasets from GBIF with standardized occurrence data.
      </p>
      <div className="flex gap-2 justify-start">
        <ImportButton
          onClick={handleGbifDataset}
          className="whitespace-nowrap flex-1"
          disabled={!selectedGbifDataset || loadingGbifDatasets}
        >
          Import GBIF Dataset
        </ImportButton>
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
      </div>
    </div>
  )
}

export default function Import({ onNewStudy }) {
  let navigate = useNavigate()
  const [selectedModel, setSelectedModel] = useState(modelZoo[0]?.reference || null)
  const queryClient = useQueryClient()

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
    const { data, id } = await window.api.downloadDemoDataset()
    if (!id) return
    console.log('Demo dataset downloaded:', data, id)
    onNewStudy({ id, name: data.name, data })
    navigate(`/study/${id}`)
  }

  const handleImportImages = async () => {
    const { id } = await window.api.selectImagesDirectory()
    // onNewStudy({ id, name: data.name, data, path, importerName, selectedModel })
    queryClient.invalidateQueries(['studies'])
    navigate(`/study/${id}`)
  }

  const handleGbifImport = async (key) => {
    try {
      const { data, id, path } = await window.api.importGbifDataset(key)
      if (!id) return
      console.log('GBIF dataset imported:', data, id)
      onNewStudy({ id, name: data.name, data, path })
      navigate(`/study/${id}`)
    } catch (error) {
      console.error('Failed to import GBIF dataset:', error)
      throw error // Re-throw to ensure ImportButton shows error state
    }
  }

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <p className="text-gray-500">
            Import a dataset using one of the supported formats. After importing, we will generate
            summary and visualisations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CamtrapDP Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">CamtrapDP</h3>
            <p className="text-sm text-gray-500 mb-4">
              Import camera trap data in Camera Trap Data Package format with standardized metadata
              and observations.
            </p>
            <div className="flex justify-start">
              <ImportButton onClick={handleCamTrapDP} className="">
                Select CamtrapDP
              </ImportButton>
            </div>
          </div>

          {/* Wildlife Insights Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">Wildlife Insights</h3>
            <p className="text-sm text-gray-500 mb-4">
              Import data from Wildlife Insights platform with species identifications and metadata.
            </p>
            <div className="flex justify-start">
              <ImportButton onClick={handleWildlifeInsights} className="">
                Select Wildlife Insights
              </ImportButton>
            </div>
          </div>

          {/* Deepfaune CSV Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">Deepfaune CSV</h3>
            <p className="text-sm text-gray-500 mb-4">
              Import predictions from Deepfaune CSV files with species identifications and
              confidence scores.
            </p>
            <div className="flex justify-start">
              <ImportButton onClick={handleDeepfauneCSV} className="">
                Select Deepfaune CSV
              </ImportButton>
            </div>
          </div>

          {/* GBIF Dataset Card */}
          <GbifImportCard onImport={handleGbifImport} />

          {/* Images Directory Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">Images Directory</h3>
            <p className="text-sm text-gray-500 mb-4">
              Import a directory of images and automatically extract metadata from file names and
              EXIF data. Work in progress!
            </p>
            <div className="flex gap-2 justify-start">
              <ImportButton onClick={handleImportImages} className="whitespace-nowrap flex-1">
                Select Images folder (WIP)
              </ImportButton>
              <select
                value={selectedModel ? `${selectedModel.id}-${selectedModel.version}` : ''}
                onChange={(e) => {
                  const [id, version] = e.target.value.split('-')
                  const model = modelZoo.find(
                    (m) => m.reference.id === id && m.reference.version === version
                  )
                  setSelectedModel(model?.reference || null)
                }}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {modelZoo.map((model) => (
                  <option
                    key={`${model.reference.id}-${model.reference.version}`}
                    value={`${model.reference.id}-${model.reference.version}`}
                  >
                    {model.name} v{model.reference.version}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Demo Dataset Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-lg mb-2">Demo Dataset</h3>
            <p className="text-sm text-gray-500 mb-4">
              Download and use a sample dataset to explore the application features and
              functionality.
            </p>
            <div className="flex justify-start">
              <ImportButton onClick={handleDemoDataset} className="">
                Use Demo Dataset
              </ImportButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
