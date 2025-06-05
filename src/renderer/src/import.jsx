import { useNavigate } from 'react-router'
import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix for Leaflet marker icons in webpack environments
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png'
})

function TreeNode({ node }) {
  const hasChildren = node.children && node.children.length > 0

  return (
    <div className="ml-2">
      <div className="flex flex-col p-1">
        <span>{node.name}</span>
        {node.mediaCount !== undefined && node.mediaCount > 0 && (
          <span className="ml-4 text-sm text-gray-500">{node.mediaCount} media</span>
        )}
      </div>

      {hasChildren && (
        <div className="border-l-2 border-gray-200 pl-2">
          {node.children.map((child, index) => (
            <TreeNode key={index} node={child} />
          ))}
        </div>
      )}
    </div>
  )
}

function Tree({ data }) {
  if (!data) return <div className="p-4">No tree data available</div>
  return (
    <div className="overflow-auto h-full p-4">
      <TreeNode node={data} />
    </div>
  )
}

function DeploymentsList({ deployments }) {
  if (!deployments || deployments.length === 0) {
    return <div className="p-4">No deployments available</div>
  }

  return (
    <div className="overflow-auto h-full p-4">
      <div className="space-y-4">
        {deployments.map((deployment, index) => (
          <div key={index} className="border rounded-md p-3 bg-white shadow-sm">
            <div className="font-medium">{deployment.name}</div>
            <div className="text-sm text-gray-600">
              {deployment.minDate && deployment.maxDate ? (
                <>
                  <div>Start: {new Date(deployment.minDate).toLocaleDateString()}</div>
                  <div>End: {new Date(deployment.maxDate).toLocaleDateString()}</div>
                </>
              ) : (
                <div>Date range not available</div>
              )}
            </div>
            {deployment.mainLocation && (
              <div className="text-sm mt-1">
                Location: {deployment.mainLocation.lat.toFixed(5)},{' '}
                {deployment.mainLocation.lng.toFixed(5)}
              </div>
            )}
            <div className="mt-2">
              <div className="text-sm font-medium">Locations ({deployment.locations.length}):</div>
              <div className="max-h-20 overflow-auto">
                {deployment.locations.map((loc, i) => (
                  <div key={i} className="text-xs text-gray-600">
                    {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} ({loc.mediaCount} media)
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DeploymentsMap({ deployments }) {
  if (!deployments || deployments.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        No location data available
      </div>
    )
  }

  // Find center of map based on deployments
  const getCenter = () => {
    // Default to a central location if no deployments with locations
    if (!deployments.some((d) => d.mainLocation)) {
      return [0, 0]
    }

    // Use the first deployment with a location as center
    const firstWithLocation = deployments.find((d) => d.mainLocation)
    return [firstWithLocation.mainLocation.lat, firstWithLocation.mainLocation.lng]
  }

  return (
    <div className="w-full h-full">
      <MapContainer center={getCenter()} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {deployments.map((deployment, index) => {
          if (!deployment.mainLocation) return null
          return (
            <Marker
              key={index}
              position={[deployment.mainLocation.lat, deployment.mainLocation.lng]}
            >
              <Popup>
                <div>
                  <b>{deployment.name}</b>
                  <br />
                  Media: {deployment.mediaCount}
                  <br />
                  {deployment.minDate && (
                    <>
                      From: {new Date(deployment.minDate).toLocaleDateString()}
                      <br />
                    </>
                  )}
                  {deployment.maxDate && (
                    <>To: {new Date(deployment.maxDate).toLocaleDateString()}</>
                  )}
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}

function CreateDeployment({ tree, deployments }) {
  return (
    <div className="flex flex-col h-full w-full">
      {/* First row - 50% height with tree and deployments list */}
      <div className="flex flex-row h-1/2">
        {/* Left column - Tree display */}
        <div className="w-1/2 border-r border-gray-200 overflow-hidden">
          <Tree data={tree} />
        </div>

        {/* Right column - Deployments list */}
        <div className="w-1/2 overflow-hidden">
          <DeploymentsList deployments={deployments} />
        </div>
      </div>

      {/* Second row - Leaflet map */}
      <div className="h-1/2 border-t border-gray-200">
        <DeploymentsMap deployments={deployments} />
      </div>
    </div>
  )
}

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
  const [tree, setTree] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [media, setMedia] = useState([])
  const [showDeployments, setShowDeployments] = useState(false)

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
      {showDeployments ? (
        <div className="w-full h-full p-4">
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => setShowDeployments(false)}
              className="text-sm border rounded px-2 py-1 hover:bg-gray-100"
            >
              Back
            </button>
          </div>
          <CreateDeployment tree={tree} deployments={deployments} />
        </div>
      ) : (
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
      )}
    </div>
  )
}
