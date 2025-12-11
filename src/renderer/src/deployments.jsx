import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Camera, MapPin, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOMServer from 'react-dom/server'
import { LayersControl, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
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

// Add style block for marker styles
const markerStyles = `
  .invisible-drag-marker {
    background: transparent !important;
    border: none !important;
    cursor: move;
  }

  .camera-marker-active {
    position: relative;
    cursor: move;
  }

  .marker-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 48px;
    height: 48px;
    border: 3px solid #3B82F6;
    border-radius: 50%;
    animation: pulse-ring 1.5s ease-out infinite;
    pointer-events: none;
  }

  @keyframes pulse-ring {
    0% {
      transform: translate(-50%, -50%) scale(0.7);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(1.3);
      opacity: 0;
    }
  }

  .camera-marker-active svg {
    filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.7));
  }

  .custom-camera-icon {
    background: transparent !important;
    border: none !important;
  }
`

// Add the style to the document head
if (typeof document !== 'undefined' && !document.getElementById('marker-styles')) {
  const style = document.createElement('style')
  style.id = 'marker-styles'
  style.textContent = markerStyles
  document.head.appendChild(style)
}

// Create camera icons once at module level for better performance
const createCameraIcon = (isActive) => {
  const cameraIcon = ReactDOMServer.renderToString(
    <div className={isActive ? 'camera-marker-active' : 'camera-marker'}>
      {isActive && <div className="marker-ring"></div>}
      {isActive ? (
        <Camera color="#1E40AF" fill="#93C5FD" size={32} />
      ) : (
        <Camera color="#777" fill="#bbb" size={28} />
      )}
    </div>
  )

  return L.divIcon({
    html: cameraIcon,
    className: 'custom-camera-icon',
    iconSize: isActive ? [32, 32] : [18, 18],
    iconAnchor: isActive ? [16, 16] : [14, 14]
  })
}

const cameraIcon = createCameraIcon(false)
const activeCameraIcon = createCameraIcon(true)

const ghostCameraIcon = (() => {
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
})()

// Custom cluster icon creator
const createClusterCustomIcon = (cluster) => {
  const count = cluster.getChildCount()
  let size = 'small'
  if (count >= 10) size = 'medium'
  if (count >= 50) size = 'large'

  const sizeClasses = {
    small: 'w-8 h-8 text-xs',
    medium: 'w-10 h-10 text-sm',
    large: 'w-12 h-12 text-base'
  }

  return L.divIcon({
    html: `<div class="flex items-center justify-center ${sizeClasses[size]} bg-blue-500 text-white rounded-full border-2 border-white shadow-lg font-semibold">${count}</div>`,
    className: 'custom-cluster-icon',
    iconSize: L.point(40, 40, true)
  })
}

// Component to handle map layer change events for persistence
function LayerChangeHandler({ onLayerChange }) {
  const map = useMap()
  useEffect(() => {
    const handleBaseLayerChange = (e) => {
      onLayerChange(e.name)
    }
    map.on('baselayerchange', handleBaseLayerChange)
    return () => map.off('baselayerchange', handleBaseLayerChange)
  }, [map, onLayerChange])
  return null
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

// Component to fly to selected location
function FlyToSelected({ selectedLocation }) {
  const map = useMap()

  useEffect(() => {
    if (selectedLocation?.latitude && selectedLocation?.longitude) {
      map.flyTo(
        [parseFloat(selectedLocation.latitude), parseFloat(selectedLocation.longitude)],
        16, // zoom level
        { duration: 0.8 }
      )
    }
  }, [selectedLocation, map])

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
  onExitPlaceMode,
  studyId
}) {
  const mapRef = useRef(null)
  const [mousePosition, setMousePosition] = useState(null)

  // Persist map layer selection per study
  const mapLayerKey = `mapLayer:${studyId}`
  const [selectedLayer, setSelectedLayer] = useState(() => {
    const saved = localStorage.getItem(mapLayerKey)
    return saved || 'Satellite'
  })

  useEffect(() => {
    localStorage.setItem(mapLayerKey, selectedLayer)
  }, [selectedLayer, mapLayerKey])

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

  // Memoize valid locations filter
  const validLocations = useMemo(
    () => locations.filter((location) => location.latitude && location.longitude),
    [locations]
  )

  // Memoize bounds calculation
  const bounds = useMemo(() => {
    if (validLocations.length === 0) return null
    const positions = validLocations.map((location) => [
      parseFloat(location.latitude),
      parseFloat(location.longitude)
    ])
    return L.latLngBounds(positions)
  }, [validLocations])

  if (!locations || locations.length === 0) {
    return <div className="text-gray-500">No location data available for map</div>
  }

  return (
    <div
      className={`w-full h-full bg-white rounded border border-gray-200 relative ${isPlaceMode ? 'place-mode-active' : ''}`}
    >
      <MapContainer
        {...(bounds
          ? { bounds: bounds, boundsOptions: { padding: [30, 30] } }
          : { center: [0, 0], zoom: 2 })}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="Satellite" checked={selectedLayer === 'Satellite'}>
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Street Map" checked={selectedLayer === 'Street Map'}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <LayerChangeHandler onLayerChange={setSelectedLayer} />

        {/* Fly to selected location when it changes */}
        <FlyToSelected selectedLocation={selectedLocation} />

        {/* Map event handler for place mode */}
        <MapEventHandler
          isPlaceMode={isPlaceMode}
          onMapClick={(latlng) => onPlaceLocation(latlng)}
          onMouseMove={(latlng) => setMousePosition(latlng)}
          onMouseOut={() => setMousePosition(null)}
        />

        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          maxClusterRadius={50}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
          zoomToBoundsOnClick
        >
          {validLocations.map((location) => (
            <Marker
              key={location.locationID}
              title={location.locationID}
              position={[parseFloat(location.latitude), parseFloat(location.longitude)]}
              icon={
                selectedLocation?.deploymentID === location.deploymentID
                  ? activeCameraIcon
                  : cameraIcon
              }
              draggable={selectedLocation?.deploymentID === location.deploymentID}
              zIndexOffset={selectedLocation?.deploymentID === location.deploymentID ? 1000 : 0}
              eventHandlers={{
                click: () => {
                  if (isPlaceMode) {
                    onExitPlaceMode()
                  }
                  setSelectedLocation(location)
                },
                dragend: (e) => {
                  const marker = e.target
                  const position = marker.getLatLng()
                  onNewLatitude(location.deploymentID, position.lat.toFixed(6))
                  onNewLongitude(location.deploymentID, position.lng.toFixed(6))
                }
              }}
            />
          ))}
        </MarkerClusterGroup>

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

// Memoized deployment row component
const DeploymentRow = memo(function DeploymentRow({
  location,
  isSelected,
  onSelect,
  onNewLatitude,
  onNewLongitude,
  onEnterPlaceMode,
  percentile90Count
}) {
  const handleLatitudeChange = useCallback(
    (e) => onNewLatitude(location.deploymentID, e.target.value),
    [location.deploymentID, onNewLatitude]
  )

  const handleLongitudeChange = useCallback(
    (e) => onNewLongitude(location.deploymentID, e.target.value),
    [location.deploymentID, onNewLongitude]
  )

  const handlePlaceClick = useCallback(
    (e) => {
      e.stopPropagation()
      onSelect(location)
      onEnterPlaceMode()
    },
    [location, onSelect, onEnterPlaceMode]
  )

  const handleRowClick = useCallback(() => onSelect(location), [location, onSelect])

  return (
    <div
      id={location.deploymentID}
      title={location.deploymentStart}
      onClick={handleRowClick}
      className={`flex gap-4 items-center py-4 first:pt-2 hover:bg-gray-50 cursor-pointer px-2 border-b border-gray-200 transition-all duration-200 ${
        isSelected
          ? 'bg-blue-50 border-l-4 border-l-blue-500 pl-3'
          : 'border-l-4 border-l-transparent'
      }`}
    >
      <div className="flex flex-col gap-2">
        <div
          className={`cursor-pointer text-sm w-62 truncate ${
            isSelected ? 'font-semibold text-blue-700' : 'text-gray-700'
          }`}
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
            value={location.latitude ?? ''}
            onChange={handleLatitudeChange}
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
            value={location.longitude ?? ''}
            onChange={handleLongitudeChange}
            placeholder="Lng"
            className="max-w-20 text-xs border border-zinc-950/10 rounded px-2 py-1"
            name="longitude"
          />
          <button
            onClick={handlePlaceClick}
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
                    ? `${Math.min((period.count / percentile90Count) * 100, 100)}%`
                    : '0%',
                minWidth: period.count > 0 ? '4px' : '0px'
              }}
            ></div>
          </div>
        ))}
      </div>
    </div>
  )
})

// Format date helper - defined outside component to avoid recreation
const formatDate = (dateString) => {
  if (!dateString) return 'N/A'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: '2-digit',
    month: 'short',
    day: 'numeric'
  })
}

function LocationsList({
  activity,
  selectedLocation,
  setSelectedLocation,
  onNewLatitude,
  onNewLongitude,
  onEnterPlaceMode
}) {
  const parentRef = useRef(null)

  // Memoize sorted deployments
  const sortedDeployments = useMemo(() => {
    if (!activity.deployments) return []
    return [...activity.deployments].sort((a, b) => {
      const aName = a.locationName || a.locationID || 'Unnamed Location'
      const bName = b.locationName || b.locationID || 'Unnamed Location'
      return aName.localeCompare(bName)
    })
  }, [activity.deployments])

  // Setup virtualizer
  const rowVirtualizer = useVirtualizer({
    count: sortedDeployments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88, // Estimated row height
    overscan: 5
  })

  // Scroll to selected location
  useEffect(() => {
    if (selectedLocation) {
      const index = sortedDeployments.findIndex(
        (d) => d.deploymentID === selectedLocation.deploymentID
      )
      if (index !== -1) {
        rowVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
      }
    }
  }, [selectedLocation, sortedDeployments, rowVirtualizer])

  if (!activity.deployments || activity.deployments.length === 0) {
    return <div className="text-gray-500">No deployment data available</div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="sticky top-0 bg-white z-10 pl-68 flex justify-between text-sm text-gray-700 py-2">
        <span>{formatDate(activity.startDate)} </span>
        <span>{formatDate(activity.endDate)}</span>
      </header>
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const location = sortedDeployments[virtualItem.index]
            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`
                }}
              >
                <DeploymentRow
                  location={location}
                  isSelected={selectedLocation?.deploymentID === location.deploymentID}
                  onSelect={setSelectedLocation}
                  onNewLatitude={onNewLatitude}
                  onNewLongitude={onNewLongitude}
                  onEnterPlaceMode={onEnterPlaceMode}
                  percentile90Count={activity.percentile90Count}
                />
              </div>
            )
          })}
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
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    refetchInterval: () => (importStatus?.isRunning ? 5000 : false),
    enabled: !!studyId
  })

  const onNewLatitude = useCallback(
    async (deploymentID, latitude) => {
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
          // Invalidate the Overview tab's deployments cache so map updates
          queryClient.invalidateQueries({ queryKey: ['deployments', studyId] })
          // Invalidate the Activity tab's heatmap cache so map updates
          queryClient.invalidateQueries({ queryKey: ['heatmapData', studyId] })
        }
      } catch (error) {
        console.error('Error updating latitude:', error)
      }
    },
    [studyId, queryClient]
  )

  const onNewLongitude = useCallback(
    async (deploymentID, longitude) => {
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
          // Invalidate the Overview tab's deployments cache so map updates
          queryClient.invalidateQueries({ queryKey: ['deployments', studyId] })
          // Invalidate the Activity tab's heatmap cache so map updates
          queryClient.invalidateQueries({ queryKey: ['heatmapData', studyId] })
        }
      } catch (error) {
        console.error('Error updating longitude:', error)
      }
    },
    [studyId, queryClient]
  )

  const handleEnterPlaceMode = useCallback(() => {
    if (!selectedLocation) {
      console.warn('Please select a deployment first')
      return
    }
    setIsPlaceMode(true)
  }, [selectedLocation])

  const handleExitPlaceMode = useCallback(() => {
    setIsPlaceMode(false)
  }, [])

  const handlePlaceLocation = useCallback(
    (latlng) => {
      if (selectedLocation) {
        onNewLatitude(selectedLocation.deploymentID, latlng.lat.toFixed(6))
        onNewLongitude(selectedLocation.deploymentID, latlng.lng.toFixed(6))
        setIsPlaceMode(false)
      }
    },
    [selectedLocation, onNewLatitude, onNewLongitude]
  )

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
            studyId={studyId}
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
