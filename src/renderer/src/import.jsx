import { useNavigate } from 'react-router'
import { useState } from 'react'

export default function Import({ onNewStudy }) {
  let navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [isDemoImporting, setIsDemoImporting] = useState(false)
  const [isImportingImages, setIsImportingImages] = useState(false)

  const handleSelect = async () => {
    setImporting(true)
    const { data, id, path } = await window.api.selectDataset()
    console.log('select', path)
    if (!id) return
    onNewStudy({ id, name: data.name, data, path })
    navigate(`/study/${id}`)
  }

  const handleDemoDataset = async () => {
    setIsDemoImporting(true)
    try {
      const { data, id } = await window.api.downloadDemoDataset()
      if (!id) {
        setIsDemoImporting(false)
        return
      }
      console.log('Demo dataset downloaded:', data, id)
      onNewStudy({ id, name: data.name, data })
      navigate(`/study/${id}`)
    } catch (error) {
      console.error('Failed to import demo dataset:', error)
      setIsDemoImporting(false)
    }
  }

  const handleImportImages = async () => {
    setIsImportingImages(true)
    try {
      const { data, id, path } = await window.api.selectImagesDirectory()
      if (!id) {
        setIsImportingImages(false)
        return
      }
      onNewStudy({ id, name: data.name, data, path })
      navigate(`/study/${id}`)
      // TODO: Handle the imported images appropriately when this feature is expanded
      setIsImportingImages(false)
    } catch (error) {
      console.error('Failed to import images:', error)
      setIsImportingImages(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col justify-around border-gray-200 border p-4 rounded-md w-96 gap-2">
        <h2 className="font-medium">Import</h2>
        <p className="text-sm text-gray-500">
          Select or drop a Camtrap DP folder. After importing, we will generate summary and
          visualisations.
        </p>
        <button
          onClick={handleSelect}
          className={`cursor-pointer transition-colors mt-8 flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50`}
        >
          {importing ? <span className="animate-pulse">Importing...</span> : 'Select Folder'}
        </button>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">or</span>
          </div>
        </div>
        <button
          onClick={handleDemoDataset}
          disabled={isDemoImporting}
          className={`cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50 ${isDemoImporting ? 'opacity-70' : ''
            }`}
        >
          {isDemoImporting ? (
            <span className="animate-pulse">Downloading demo dataset...</span>
          ) : (
            'Use Demo Dataset'
          )}
        </button>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">or</span>
          </div>
        </div>
        <button
          onClick={handleImportImages}
          disabled={isImportingImages}
          className={`cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50 ${
            isImportingImages ? 'opacity-70' : ''
          }`}
        >
          {isImportingImages ? (
            <span className="animate-pulse">Importing images...</span>
          ) : (
            'Import Images Directory'
          )}
        </button>
      </div>
    </div>
  )
}
