import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Camera, ChevronDown, ChevronRight, MapPin, X } from 'lucide-react'
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
function MapEventHandler({ isPlaceMode, onMapClick }) {
  useMapEvents({
    click: (e) => {
      if (isPlaceMode) {
        onMapClick(e.latlng)
      }
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
  onExpandGroup,
  studyId
}) {
  const mapRef = useRef(null)

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

  return (
    <div className="w-full h-full bg-white rounded border border-gray-200 relative">
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
        <MapEventHandler isPlaceMode={isPlaceMode} onMapClick={onPlaceLocation} />

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
                  // Expand the location group in the list
                  onExpandGroup?.(location.locationID)
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
  isPlaceMode,
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
      onEnterPlaceMode(location)
    },
    [location, onEnterPlaceMode]
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
            className={`p-1.5 rounded transition-colors ${
              isSelected && isPlaceMode
                ? 'bg-blue-100 text-blue-600'
                : 'hover:bg-blue-100 text-gray-500 hover:text-blue-600'
            }`}
            title={
              isSelected && isPlaceMode ? 'Click on map to place' : 'Click on map to set location'
            }
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

// Memoized location group header component for multi-deployment locations
const LocationGroupHeader = memo(function LocationGroupHeader({
  group,
  isExpanded,
  onToggle,
  percentile90Count,
  isSelected
}) {
  const handleClick = useCallback(() => {
    onToggle(group.locationID)
  }, [group.locationID, onToggle])

  return (
    <div
      onClick={handleClick}
      className={`flex gap-4 items-center py-4 hover:bg-gray-50 cursor-pointer px-2 border-b border-gray-200 transition-all duration-200 ${
        isSelected
          ? 'bg-blue-50 border-l-4 border-l-blue-500 pl-1'
          : 'border-l-4 border-l-transparent'
      }`}
    >
      <div className="flex-shrink-0 w-5">
        {isExpanded ? (
          <ChevronDown size={18} className="text-gray-500" />
        ) : (
          <ChevronRight size={18} className="text-gray-500" />
        )}
      </div>

      <div className="flex flex-col gap-1 w-56">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm truncate ${isSelected ? 'font-semibold text-blue-700' : 'font-medium text-gray-700'}`}
          >
            {group.locationName || group.locationID || 'Unnamed Location'}
          </span>
          <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
            {group.deployments.length}
          </span>
        </div>
        {group.latitude && group.longitude && (
          <span className="text-xs text-gray-400">
            {Number(group.latitude).toFixed(4)}, {Number(group.longitude).toFixed(4)}
          </span>
        )}
      </div>

      <div className="flex gap-2 flex-1">
        {group.aggregatedPeriods.map((period) => (
          <div
            key={period.start}
            title={`${period.count} observations (aggregated)`}
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
            />
          </div>
        ))}
      </div>
    </div>
  )
})

// Wrapper for deployment rows within a group (indented)
const GroupedDeploymentRow = memo(function GroupedDeploymentRow({
  location,
  isSelected,
  isPlaceMode,
  onSelect,
  onNewLatitude,
  onNewLongitude,
  onEnterPlaceMode,
  percentile90Count
}) {
  return (
    <div className="ml-6">
      <DeploymentRow
        location={location}
        isSelected={isSelected}
        isPlaceMode={isPlaceMode}
        onSelect={onSelect}
        onNewLatitude={onNewLatitude}
        onNewLongitude={onNewLongitude}
        onEnterPlaceMode={onEnterPlaceMode}
        percentile90Count={percentile90Count}
      />
    </div>
  )
})

// Generate evenly-spaced date markers for timeline
const getDateMarkers = (startDate, endDate, count = 5) => {
  if (!startDate || !endDate) return []
  const start = new Date(startDate)
  const end = new Date(endDate)
  const step = (end - start) / (count - 1)
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + step * i))
}

// Format date as "Jan 24" for timeline markers
const formatDateShort = (date) => {
  return date.toLocaleDateString('en-US', { year: '2-digit', month: 'short' })
}

// Aggregate observation periods across multiple deployments
const aggregatePeriods = (deployments) => {
  if (deployments.length === 0) return []
  return deployments[0].periods.map((period, i) => ({
    start: period.start,
    end: period.end,
    count: deployments.reduce((sum, d) => sum + (d.periods[i]?.count || 0), 0)
  }))
}

// Group deployments by locationID and compute aggregated timelines
const groupDeploymentsByLocation = (deployments) => {
  if (!deployments || deployments.length === 0) return []

  const groups = new Map()

  deployments.forEach((deployment) => {
    const key = deployment.locationID || deployment.deploymentID
    if (!groups.has(key)) {
      groups.set(key, {
        locationID: deployment.locationID || deployment.deploymentID,
        locationName: deployment.locationName,
        latitude: deployment.latitude,
        longitude: deployment.longitude,
        deployments: []
      })
    }
    groups.get(key).deployments.push(deployment)
  })

  // Sort deployments within each group by deploymentStart (descending - most recent first)
  groups.forEach((group) => {
    group.deployments.sort((a, b) => new Date(b.deploymentStart) - new Date(a.deploymentStart))
  })

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      aggregatedPeriods: aggregatePeriods(group.deployments),
      isSingleDeployment: group.deployments.length === 1
    }))
    .sort((a, b) => {
      // Show multi-deployment groups first, then single deployments
      if (a.isSingleDeployment !== b.isSingleDeployment) {
        return a.isSingleDeployment ? 1 : -1
      }
      // Within each category, sort alphabetically by name
      const aName = a.locationName || a.locationID || ''
      const bName = b.locationName || b.locationID || ''
      return aName.localeCompare(bName)
    })
}

function LocationsList({
  activity,
  selectedLocation,
  setSelectedLocation,
  onNewLatitude,
  onNewLongitude,
  onEnterPlaceMode,
  isPlaceMode,
  groupToExpand,
  onGroupExpanded
}) {
  const parentRef = useRef(null)

  // Track which groups are expanded (collapsed by default)
  const [expandedGroups, setExpandedGroups] = useState(new Set())

  // Toggle group expansion
  const toggleGroup = useCallback((locationID) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(locationID)) {
        next.delete(locationID)
      } else {
        next.add(locationID)
      }
      return next
    })
  }, [])

  // Handle external group expansion request (from map marker click)
  useEffect(() => {
    if (groupToExpand) {
      setExpandedGroups((prev) => new Set(prev).add(groupToExpand))
      onGroupExpanded?.()
    }
  }, [groupToExpand, onGroupExpanded])

  // Group deployments by location
  const locationGroups = useMemo(
    () => groupDeploymentsByLocation(activity.deployments),
    [activity.deployments]
  )

  // Flatten groups into virtual items for the virtualizer
  const virtualItems = useMemo(() => {
    const items = []
    locationGroups.forEach((group) => {
      if (group.isSingleDeployment) {
        // Single deployment - render as simple row (no grouping)
        items.push({
          type: 'single',
          deployment: group.deployments[0],
          locationID: group.locationID
        })
      } else {
        // Multi-deployment group - render header
        items.push({
          type: 'group-header',
          group: group,
          isExpanded: expandedGroups.has(group.locationID)
        })
        // If expanded, add individual deployments
        if (expandedGroups.has(group.locationID)) {
          group.deployments.forEach((deployment) => {
            items.push({
              type: 'group-deployment',
              deployment: deployment,
              locationID: group.locationID
            })
          })
        }
      }
    })
    return items
  }, [locationGroups, expandedGroups])

  // Memoize date markers for timeline header
  const dateMarkers = useMemo(
    () => getDateMarkers(activity.startDate, activity.endDate, 5),
    [activity.startDate, activity.endDate]
  )

  // Setup virtualizer with dynamic sizing
  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = virtualItems[index]
      if (item.type === 'group-header') return 60
      return 88 // deployment row height
    },
    overscan: 5
  })

  // Scroll to selected location
  useEffect(() => {
    if (selectedLocation) {
      const index = virtualItems.findIndex((item) => {
        if (item.type === 'single' || item.type === 'group-deployment') {
          return item.deployment.deploymentID === selectedLocation.deploymentID
        }
        if (item.type === 'group-header') {
          // If selecting a deployment in a collapsed group, find the header
          return item.group.deployments.some(
            (d) => d.deploymentID === selectedLocation.deploymentID
          )
        }
        return false
      })
      if (index !== -1) {
        rowVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
      }
    }
  }, [selectedLocation, virtualItems, rowVirtualizer])

  if (!activity.deployments || activity.deployments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="text-gray-400 mb-3">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <p className="text-gray-500 font-medium">No deployments found</p>
        <p className="text-gray-400 text-sm mt-1">Import deployment data to see camera locations</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <header className="bg-white z-10 pl-68 py-3 border-b border-gray-300">
        <div className="flex justify-between text-xs text-gray-600">
          {dateMarkers.map((date, i) => (
            <div key={i} className="flex flex-col items-center" style={{ width: '20%' }}>
              <span>{formatDateShort(date)}</span>
              <div className="w-px h-2 bg-gray-400 mt-1" />
            </div>
          ))}
        </div>
      </header>
      <div ref={parentRef} className="flex-1 overflow-auto min-h-0">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = virtualItems[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {item.type === 'single' && (
                  <DeploymentRow
                    location={item.deployment}
                    isSelected={selectedLocation?.deploymentID === item.deployment.deploymentID}
                    isPlaceMode={isPlaceMode}
                    onSelect={setSelectedLocation}
                    onNewLatitude={onNewLatitude}
                    onNewLongitude={onNewLongitude}
                    onEnterPlaceMode={onEnterPlaceMode}
                    percentile90Count={activity.percentile90Count}
                  />
                )}

                {item.type === 'group-header' && (
                  <LocationGroupHeader
                    group={item.group}
                    isExpanded={item.isExpanded}
                    onToggle={toggleGroup}
                    percentile90Count={activity.percentile90Count}
                    isSelected={item.group.deployments.some(
                      (d) => d.deploymentID === selectedLocation?.deploymentID
                    )}
                  />
                )}

                {item.type === 'group-deployment' && (
                  <GroupedDeploymentRow
                    location={item.deployment}
                    isSelected={selectedLocation?.deploymentID === item.deployment.deploymentID}
                    isPlaceMode={isPlaceMode}
                    onSelect={setSelectedLocation}
                    onNewLatitude={onNewLatitude}
                    onNewLongitude={onNewLongitude}
                    onEnterPlaceMode={onEnterPlaceMode}
                    percentile90Count={activity.percentile90Count}
                  />
                )}
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
  const [groupToExpand, setGroupToExpand] = useState(null)
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

  const handleEnterPlaceMode = useCallback(
    (location) => {
      // Use provided location or fall back to selectedLocation
      if (!location && !selectedLocation) {
        console.warn('Please select a deployment first')
        return
      }
      if (location) {
        setSelectedLocation(location)
      }
      setIsPlaceMode(true)
    },
    [selectedLocation]
  )

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

  const handleExpandGroup = useCallback((locationID) => {
    setGroupToExpand(locationID)
  }, [])

  const handleGroupExpanded = useCallback(() => {
    setGroupToExpand(null)
  }, [])

  return (
    <div
      className={`flex flex-col px-4 h-full gap-4 overflow-hidden ${isPlaceMode ? 'place-mode-active' : ''}`}
    >
      <div className="h-96">
        {isLoading ? (
          <SkeletonMap title="Loading Deployments" message="Loading deployment locations..." />
        ) : (
          <LocationMap
            locations={activity?.deployments || []}
            selectedLocation={selectedLocation}
            setSelectedLocation={setSelectedLocation}
            onNewLatitude={onNewLatitude}
            onNewLongitude={onNewLongitude}
            isPlaceMode={isPlaceMode}
            onPlaceLocation={handlePlaceLocation}
            onExitPlaceMode={handleExitPlaceMode}
            onExpandGroup={handleExpandGroup}
            studyId={studyId}
          />
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
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
            isPlaceMode={isPlaceMode}
            groupToExpand={groupToExpand}
            onGroupExpanded={handleGroupExpanded}
          />
        ) : null}
      </div>
    </div>
  )
}
