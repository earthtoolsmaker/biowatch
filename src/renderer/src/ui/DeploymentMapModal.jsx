import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Camera, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayersControl, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { useQuery } from '@tanstack/react-query'
import ReactDOMServer from 'react-dom/server'
import { filterDeploymentsByBounds } from './DeploymentMapFilter'

// Debounce utility
function useDebounce(callback, delay) {
  const timeoutRef = useRef(null)

  const debouncedCallback = useCallback(
    (...args) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args)
      }, delay)
    },
    [callback, delay]
  )

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return debouncedCallback
}

// Create camera icon
function createCameraIcon(size = 24) {
  const cameraIcon = ReactDOMServer.renderToString(
    <div className="deployment-modal-marker">
      <Camera color="#1E40AF" fill="#93C5FD" size={size} />
    </div>
  )

  return L.divIcon({
    html: cameraIcon,
    className: 'custom-camera-icon-modal',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  })
}

// Internal component to track viewport changes and emit view (zoom + center)
function ViewportTracker({ deployments, onChange, onViewChange }) {
  const map = useMap()
  const initializedRef = useRef(false)
  const userHasInteractedRef = useRef(false)

  // Update deployment selection (always runs)
  const updateDeploymentSelection = useCallback(() => {
    const bounds = map.getBounds()
    const visibleDeployments = filterDeploymentsByBounds(deployments, bounds)
    const deploymentIDs = visibleDeployments.map((d) => d.deploymentID)
    onChange(deploymentIDs)
  }, [map, deployments, onChange])

  // Handle view change from user interaction (pan/zoom)
  const handleUserInteraction = useCallback(() => {
    userHasInteractedRef.current = true
    const bounds = map.getBounds()
    const center = map.getCenter()
    const zoom = map.getZoom()

    const visibleDeployments = filterDeploymentsByBounds(deployments, bounds)
    const deploymentIDs = visibleDeployments.map((d) => d.deploymentID)
    onChange(deploymentIDs)

    // Emit view (zoom + center) for sync - only when user actually interacts
    onViewChange({
      zoom,
      center: [center.lat, center.lng],
      bounds
    })
  }, [map, deployments, onChange, onViewChange])

  const debouncedHandleUserInteraction = useDebounce(handleUserInteraction, 300)

  useMapEvents({
    moveend: debouncedHandleUserInteraction,
    zoomend: debouncedHandleUserInteraction
  })

  // Initial deployment selection on mount (but don't propagate view)
  useEffect(() => {
    if (!initializedRef.current && deployments.length > 0) {
      initializedRef.current = true
      setTimeout(() => {
        // Only update deployment selection, don't propagate view back to mini-map
        updateDeploymentSelection()
      }, 100)
    }
  }, [deployments, updateDeploymentSelection])

  return null
}

// Component to set initial view (zoom + center from mini-map)
function InitialViewSetter({ initialView, deployments }) {
  const map = useMap()
  const fittedRef = useRef(false)

  useEffect(() => {
    if (!fittedRef.current) {
      if (initialView) {
        // Use exact zoom and center from mini-map - this ensures same view
        map.setView(initialView.center, initialView.zoom, { animate: false })
      } else if (deployments.length > 0) {
        // Fallback to fitting all deployments
        const positions = deployments.map((d) => [d.latitude, d.longitude])
        const bounds = L.latLngBounds(positions)
        map.fitBounds(bounds, { padding: [50, 50] })
      }
      fittedRef.current = true
    }
  }, [initialView, deployments, map])

  return null
}

export default function DeploymentMapModal({
  studyId,
  onChange,
  onClose,
  initialView,
  onViewChange
}) {
  const [visibleCount, setVisibleCount] = useState(0)

  // Fetch deployments with coordinates
  const { data: activityData, isLoading } = useQuery({
    queryKey: ['deploymentsActivity', studyId],
    queryFn: async () => {
      const response = await window.api.getDeploymentsActivity(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId
  })

  // Filter to deployments with valid coordinates
  const deploymentsWithCoords = useMemo(() => {
    if (!activityData?.deployments) return []
    return activityData.deployments.filter((d) => d.latitude && d.longitude)
  }, [activityData])

  // Handle deployment selection change
  const handleDeploymentsChange = useCallback(
    (deploymentIDs) => {
      setVisibleCount(deploymentIDs.length)
      onChange(deploymentIDs)
    },
    [onChange]
  )

  // Handle escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Create the camera icon
  const cameraIcon = useMemo(() => createCameraIcon(24), [])

  // Default bounds for MapContainer (will be overridden by InitialViewSetter)
  const defaultBounds = useMemo(() => {
    // If we have initialView, we'll use setView instead of bounds, but MapContainer needs bounds
    if (initialView?.bounds) return initialView.bounds
    if (deploymentsWithCoords.length === 0) return null
    if (deploymentsWithCoords.length === 1) {
      const d = deploymentsWithCoords[0]
      return L.latLngBounds(
        [d.latitude - 0.05, d.longitude - 0.05],
        [d.latitude + 0.05, d.longitude + 0.05]
      )
    }
    const positions = deploymentsWithCoords.map((d) => [d.latitude, d.longitude])
    return L.latLngBounds(positions)
  }, [initialView, deploymentsWithCoords])

  // Handle click on backdrop (outside modal content)
  const handleBackdropClick = useCallback(
    (e) => {
      // Only close if clicking directly on the backdrop, not on children
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [onClose]
  )

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl w-[90vw] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-800">Select Deployments by Area</h2>
            <span className="text-sm text-gray-500">
              {visibleCount}/{deploymentsWithCoords.length} deployments in view
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            title="Close (Esc)"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Map area - same aspect ratio as mini-map (160:130 = 16:13) for consistent bounds */}
        <div className="relative aspect-[16/13] w-full">
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-100">
              <div className="animate-pulse text-gray-400">Loading deployments...</div>
            </div>
          ) : deploymentsWithCoords.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-500">
              No deployments with coordinates available
            </div>
          ) : (
            <MapContainer
              bounds={defaultBounds}
              boundsOptions={{ padding: [0, 0] }}
              style={{ height: '100%', width: '100%' }}
              zoomControl={true}
            >
              <LayersControl position="topright">
                <LayersControl.BaseLayer name="Street Map" checked={true}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                </LayersControl.BaseLayer>

                <LayersControl.BaseLayer name="Satellite">
                  <TileLayer
                    attribution='&copy; <a href="https://www.esri.com">Esri</a>'
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  />
                </LayersControl.BaseLayer>
              </LayersControl>

              <InitialViewSetter initialView={initialView} deployments={deploymentsWithCoords} />
              <ViewportTracker
                deployments={deploymentsWithCoords}
                onChange={handleDeploymentsChange}
                onViewChange={onViewChange}
              />

              {deploymentsWithCoords.map((deployment) => (
                <Marker
                  key={deployment.deploymentID}
                  position={[deployment.latitude, deployment.longitude]}
                  icon={cameraIcon}
                />
              ))}
            </MapContainer>
          )}
        </div>

        {/* Footer with instructions */}
        <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 text-sm text-gray-600 flex-shrink-0">
          Pan and zoom the map to select deployments. Media will be filtered to show only content
          from deployments visible in the current view.
        </div>
      </div>
    </div>
  )
}
