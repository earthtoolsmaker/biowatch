import 'leaflet/dist/leaflet.css'
import { useState } from 'react'
import { useNavigate } from 'react-router'

function ImportButton({ onClick, children, className = '' }) {
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
      disabled={isImporting}
      className={`cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50 ${
        isImporting ? 'opacity-70' : ''
      } ${className}`}
    >
      {isImporting ? <span className="animate-pulse">Importing...</span> : children}
    </button>
  )
}

export default function Import({ onNewStudy }) {
  let navigate = useNavigate()

  const handleCamTrapDP = async () => {
    const { data, id, path } = await window.api.selectCamtrapDPDataset()
    console.log('select', path)
    if (!id) return
    onNewStudy({ id, name: data.name, data, path })
    navigate(`/study/${id}`)
  }

  const handleWildlifeInsights = async () => {
    const { data, id, path } = await window.api.selectWildlifeDataset()
    console.log('Wildlife Insights select', path)
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
    const { data, id, path, importerName } = await window.api.selectImagesDirectory()
    onNewStudy({ id, name: data.name, data, path, importerName })
    navigate(`/study/${id}`)
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col justify-around border-gray-200 border p-4 rounded-md w-96 gap-2">
        <h2 className="font-medium">Import</h2>
        <p className="text-sm text-gray-500">
          Import a dataset using one of the supported formats. After importing, we will generate
          summary and visualisations.
        </p>
        <ImportButton onClick={handleCamTrapDP} className="mt-8">
          Select CamtrapDP folder
        </ImportButton>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">or</span>
          </div>
        </div>
        <ImportButton onClick={handleWildlifeInsights}>
          Select Wildlife Insights folder
        </ImportButton>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">or</span>
          </div>
        </div>
        <ImportButton onClick={handleImportImages}>Select Images folder</ImportButton>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">or</span>
          </div>
        </div>
        <ImportButton onClick={handleDemoDataset}>Use Demo Dataset</ImportButton>
      </div>
    </div>
  )
}
