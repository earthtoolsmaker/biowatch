import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Camera, MapPin, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactDOMServer from 'react-dom/server'
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useImportStatus } from '@renderer/hooks/import'
import SkeletonMap from './ui/SkeletonMap'
import SkeletonDeploymentsList from './ui/SkeletonDeploymentsList'

// Fix the default marker icon issue in react-leaflet
// This is needed because the CSS assets are not properly loaded
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png'
})

// Add this style block at the top of the file after imports
const invisibleMarkerStyle = `
  .invisible-drag-marker {
    background: transparent !important;
    border: none !important;
    cursor: move;
  }
`

// Add the style to the document head
if (typeof document !== 'undefined' && !document.getElementById('invisible-marker-styles')) {
  const style = document.createElement('style')
  style.id = 'invisible-marker-styles'
  style.textContent = invisibleMarkerStyle
  document.head.appendChild(style)
}

// Component to handle map events for place mode
function MapEventHandler({ isPlaceMode, onMapClick, onMouseMove, onMouseOut }) {
  useMapEvents({
    click: (e) => {
      if (isPlaceMode) {
        onMapClick(e.latlng)
      }
    },
    mousemove: (e) => {
      if (isPlaceMode) {
        onMouseMove(e.latlng)
      }
    },
    mouseout: () => {
      onMouseOut()
    }
  })
  return null
}

function LocationMap({
  locations,
  selectedLocation,
  setSelectedLocation,
  onNewLatitude,
  onNewLongitude,
  isPlaceMode,
  onPlaceLocation,
  onExitPlaceMode
}) {
  const mapRef = useRef(null)
  const [mousePosition, setMousePosition] = useState(null)

  // useEffect(() => {
  //   if (mapRef.current && selectedLocation) {
  //     mapRef.current.setView(
  //       [parseFloat(selectedLocation.latitude), parseFloat(selectedLocation.longitude)],
  //       16
  //     )
  //   }
  // }, [selectedLocation])
  useEffect(() => {
    console.log('mount')
  }, [])

  // Escape key handler to exit place mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isPlaceMode) {
        onExitPlaceMode()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaceMode, onExitPlaceMode])

  if (!locations || locations.length === 0) {
    return <div className="text-gray-500">No location data available for map</div>
  }

  // Filter to include only locations with valid coordinates
  const validLocations = locations.filter((location) => location.latitude && location.longitude)

  // if (validLocations.length === 0) {
  //   return <div className="text-gray-500">No valid geographic coordinates found for locations</div>
  // }

  // Create bounds from all valid location coordinates
  const positions = validLocations.map((location) => [
    parseFloat(location.latitude),
    parseFloat(location.longitude)
  ])

  // Create a bounds object that encompasses all markers
  const bounds = L.latLngBounds(positions)

  // Create camera icon as a custom marker
  const createCameraIcon = (isActive) => {
    const cameraIcon = ReactDOMServer.renderToString(
      <div className="camera-marker">
        {isActive ? (
          <Camera color="#1E40AF" fill="#93C5FD" size={28} />
        ) : (
          <Camera color="#777" fill="#bbb" size={28} />
        )}
      </div>
    )

    return L.divIcon({
      html: cameraIcon,
      className: 'custom-camera-icon',
      iconSize: [18, 18],
      iconAnchor: [14, 14]
    })
  }

  // Create the camera icon outside of the map loop for better performance
  const cameraIcon = createCameraIcon(false)
  const activeCameraIcon = createCameraIcon(true)

  // Create ghost camera icon for place mode preview
  const createGhostCameraIcon = () => {
    const ghostIcon = ReactDOMServer.renderToString(
      <div className="ghost-camera-marker" style={{ opacity: 0.6 }}>
        <Camera color="#1E40AF" fill="#93C5FD" size={28} />
      </div>
    )

    return L.divIcon({
      html: ghostIcon,
      className: 'ghost-camera-icon',
      iconSize: [18, 18],
      iconAnchor: [14, 14]
    })
  }

  const ghostCameraIcon = createGhostCameraIcon()

  return (
    <div
      className={`w-full h-full bg-white rounded border border-gray-200 relative ${isPlaceMode ? 'place-mode-active' : ''}`}
    >
      <MapContainer
        {...(validLocations.length > 0
          ? { bounds: bounds, boundsOptions: { padding: [30, 30] } }
          : { center: [0, 0], zoom: 2 })}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Map event handler for place mode */}
        <MapEventHandler
          isPlaceMode={isPlaceMode}
          onMapClick={(latlng) => onPlaceLocation(latlng)}
          onMouseMove={(latlng) => setMousePosition(latlng)}
          onMouseOut={() => setMousePosition(null)}
        />

        {validLocations.map((location) => (
          <Marker
            key={location.locationID}
            title={location.locationID}
            position={[parseFloat(location.latitude), parseFloat(location.longitude)]}
            icon={
              selectedLocation?.locationID === location.locationID ? activeCameraIcon : cameraIcon
            }
            draggable={selectedLocation?.locationID === location.locationID}
            zIndexOffset={selectedLocation?.locationID === location.locationID ? 1000 : 0}
            eventHandlers={{
              click: () => {
                console.log('clicked', location.locationID)
                if (isPlaceMode) {
                  onExitPlaceMode()
                }
                setSelectedLocation(location)
              },
              dragend: (e) => {
                const marker = e.target
                const position = marker.getLatLng()
                console.log('marker dragged to:', position.lat, position.lng)
                onNewLatitude(location.deploymentID, position.lat.toFixed(6))
                onNewLongitude(location.deploymentID, position.lng.toFixed(6))
              }
            }}
          />
        ))}

        {/* Ghost marker for place mode preview */}
        {isPlaceMode && mousePosition && (
          <Marker
            position={[mousePosition.lat, mousePosition.lng]}
            icon={ghostCameraIcon}
            interactive={false}
            zIndexOffset={2000}
          />
        )}
      </MapContainer>

      {/* Place mode indicator */}
      {isPlaceMode && selectedLocation && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000]">
          <div className="bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium flex items-center gap-2">
            <MapPin size={16} />
            <span>
              Click to place: {selectedLocation?.locationName || selectedLocation?.locationID}
            </span>
            <button
              onClick={onExitPlaceMode}
              className="ml-2 hover:bg-blue-700 rounded-full p-1"
              title="Cancel (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function LocationsList({
  activity,
  selectedLocation,
  setSelectedLocation,
  onNewLatitude,
  onNewLongitude,
  onEnterPlaceMode
}) {
  useEffect(() => {
    if (selectedLocation && selectedLocation) {
      document
        .getElementById(selectedLocation.deploymentID)
        .scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectedLocation])

  if (!activity.deployments || activity.deployments.length === 0) {
    return <div className="text-gray-500">No deployment data available</div>
  }

  console.log('activity.deployments', activity.deployments)

  // Format date to a more readable format
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: '2-digit',
      month: 'short',
      day: 'numeric'
    })
  }

  console.log('selectedLocation', selectedLocation)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2">
        <header className="sticky top-0 bg-white z-10 pl-68 flex justify-between text-sm text-gray-700 py-2">
          <span>{formatDate(activity.startDate)} </span>
          <span>{formatDate(activity.endDate)}</span>
        </header>
        <div className="flex flex-col divide-y divide-gray-200 mb-4">
          {activity.deployments
            .sort(
              (a, b) => {
                const aName = a.locationName || a.locationID || 'Unnamed Location'
                const bName = b.locationName || b.locationID || 'Unnamed Location'
                return aName.localeCompare(bName)
              }
              // a.localCompare(b)
              // new Date(a.periods.find((p) => p.count > 0)?.start) -
              // new Date(b.periods.find((p) => p.count > 0)?.start)
            )
            .map((location) => (
              <div
                key={location.deploymentID}
                id={location.deploymentID} // Use deploymentID as the ID for scrolling
                title={location.deploymentStart}
                onClick={() => setSelectedLocation(location)}
                className={`flex gap-4 items-center py-4 first:pt-2 hover:bg-gray-50 cursor-pointer px-2 ${selectedLocation?.locationID === location.locationID ? 'bg-gray-50' : ''}`}
              >
                <div className="flex flex-col gap-2">
                  <div
                    className={`cursor-pointer text-sm w-62 truncate text-gray-700 ${selectedLocation?.locationID === location.locationID ? 'font-medium' : ''}`}
                    title={location.deploymentStart}
                  >
                    {location.locationName || location.locationID || 'Unnamed Location'}
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      step={0.00001}
                      min={-90}
                      max={90}
                      title="Latitude"
                      value={location.latitude}
                      onChange={(e) => onNewLatitude(location.deploymentID, e.target.value)}
                      placeholder="Lat"
                      className="max-w-20 text-xs border border-zinc-950/10 rounded px-2 py-1"
                      name="Latitude"
                    />
                    <input
                      step={0.00001}
                      min="-180"
                      max="180"
                      type="number"
                      title="Longitude"
                      value={location.longitude}
                      onChange={(e) => onNewLongitude(location.deploymentID, e.target.value)}
                      placeholder="Lng"
                      className="max-w-20 text-xs border border-zinc-950/10 rounded px-2 py-1"
                      name="longitude"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedLocation(location)
                        onEnterPlaceMode()
                      }}
                      className="p-1.5 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors"
                      title="Click on map to set location"
                    >
                      <MapPin size={16} />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 flex-1">
                  {location.periods.map((period) => (
                    <div
                      key={period.start}
                      title={`${period.count} observations`}
                      className="flex items-center justify-center aspect-square w-[5%]"
                    >
                      <div
                        className="rounded-full bg-[#77b7ff] aspect-square max-w-[25px]"
                        style={{
                          width:
                            period.count > 0
                              ? `${Math.min((period.count / activity.percentile90Count) * 100, 100)}%`
                              : '0%',
                          minWidth: period.count > 0 ? '4px' : '0px'
                        }}
                      ></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

export default function Deployments({ studyId }) {
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [isPlaceMode, setIsPlaceMode] = useState(false)
  const queryClient = useQueryClient()
  const { importStatus } = useImportStatus(studyId)

  const { data: activity, isLoading } = useQuery({
    queryKey: ['deploymentsActivity', studyId],
    queryFn: async () => {
      const response = await window.api.getDeploymentsActivity(studyId)
      console.log('Activity response:', response)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    refetchInterval: () => (importStatus?.isRunning ? 5000 : false),
    enabled: !!studyId
  })

  const onNewLatitude = async (deploymentID, latitude) => {
    try {
      const lat = parseFloat(latitude)
      const result = await window.api.setDeploymentLatitude(studyId, deploymentID, lat)

      // Optimistic update via queryClient
      queryClient.setQueryData(['deploymentsActivity', studyId], (prevActivity) => {
        if (!prevActivity) return prevActivity
        const updatedDeployments = prevActivity.deployments.map((deployment) => {
          if (deployment.deploymentID === deploymentID) {
            return { ...deployment, latitude: lat }
          }
          return deployment
        })
        return { ...prevActivity, deployments: updatedDeployments }
      })

      if (result.error) {
        console.error('Error updating latitude:', result.error)
      } else {
        console.log('Latitude updated successfully')
      }
    } catch (error) {
      console.error('Error updating latitude:', error)
    }
  }

  const onNewLongitude = async (deploymentID, longitude) => {
    try {
      const lng = parseFloat(longitude)
      const result = await window.api.setDeploymentLongitude(studyId, deploymentID, lng)

      // Optimistic update via queryClient
      queryClient.setQueryData(['deploymentsActivity', studyId], (prevActivity) => {
        if (!prevActivity) return prevActivity
        const updatedDeployments = prevActivity.deployments.map((deployment) => {
          if (deployment.deploymentID === deploymentID) {
            return { ...deployment, longitude: lng }
          }
          return deployment
        })
        return { ...prevActivity, deployments: updatedDeployments }
      })

      if (result.error) {
        console.error('Error updating longitude:', result.error)
      } else {
        console.log('Longitude updated successfully')
      }
    } catch (error) {
      console.error('Error updating longitude:', error)
    }
  }

  const handleEnterPlaceMode = () => {
    if (!selectedLocation) {
      console.warn('Please select a deployment first')
      return
    }
    setIsPlaceMode(true)
  }

  const handleExitPlaceMode = () => {
    setIsPlaceMode(false)
  }

  const handlePlaceLocation = (latlng) => {
    if (selectedLocation) {
      onNewLatitude(selectedLocation.deploymentID, latlng.lat.toFixed(6))
      onNewLongitude(selectedLocation.deploymentID, latlng.lng.toFixed(6))
      setIsPlaceMode(false)
    }
  }

  console.log('Activity data:', activity)

  return (
    <div className="flex flex-col px-4 h-full gap-4">
      <div className="flex-[0.7]">
        {isLoading ? (
          <SkeletonMap title="Loading Deployments" message="Loading deployment locations..." />
        ) : activity ? (
          <LocationMap
            locations={activity.deployments}
            selectedLocation={selectedLocation}
            setSelectedLocation={setSelectedLocation}
            onNewLatitude={onNewLatitude}
            onNewLongitude={onNewLongitude}
            isPlaceMode={isPlaceMode}
            onPlaceLocation={handlePlaceLocation}
            onExitPlaceMode={handleExitPlaceMode}
          />
        ) : null}
      </div>
      {isLoading ? (
        <SkeletonDeploymentsList itemCount={6} />
      ) : activity ? (
        <LocationsList
          activity={activity}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
          onNewLatitude={onNewLatitude}
          onNewLongitude={onNewLongitude}
          onEnterPlaceMode={handleEnterPlaceMode}
        />
      ) : null}
    </div>
  )
}
