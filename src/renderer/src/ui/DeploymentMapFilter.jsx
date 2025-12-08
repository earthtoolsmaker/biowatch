import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Camera, Expand } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { useQuery } from '@tanstack/react-query'
import ReactDOMServer from 'react-dom/server'

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

// Filter deployments by viewport bounds
export function filterDeploymentsByBounds(deployments, bounds) {
  if (!bounds || !deployments) return []

  return deployments.filter((d) => {
    if (!d.latitude || !d.longitude) return false
    return bounds.contains([d.latitude, d.longitude])
  })
}

// Create camera icon
function createCameraIcon(size = 16) {
  const cameraIcon = ReactDOMServer.renderToString(
    <div className="deployment-filter-marker">
      <Camera color="#1E40AF" fill="#93C5FD" size={size} />
    </div>
  )

  return L.divIcon({
    html: cameraIcon,
    className: 'custom-camera-icon-small',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  })
}

// Internal component to track viewport changes and emit view (zoom + center)
function ViewportTracker({ deployments, onViewChange, isSyncingRef }) {
  const map = useMap()
  const initializedRef = useRef(false)
  const pendingEmitRef = useRef(false)

  const emitViewChange = useCallback(() => {
    if (!pendingEmitRef.current) return
    pendingEmitRef.current = false

    const bounds = map.getBounds()
    const center = map.getCenter()
    const zoom = map.getZoom()

    // Emit view (zoom + center) for synchronization, plus bounds for filtering
    onViewChange({
      zoom,
      center: [center.lat, center.lng],
      bounds
    })
  }, [map, onViewChange])

  const debouncedEmit = useDebounce(emitViewChange, 300)

  // Check sync flag IMMEDIATELY when event fires, before debouncing
  const onMapMove = useCallback(() => {
    // Skip if we're syncing from external source (modal)
    if (isSyncingRef?.current) {
      pendingEmitRef.current = false
      return
    }
    pendingEmitRef.current = true
    debouncedEmit()
  }, [isSyncingRef, debouncedEmit])

  useMapEvents({
    moveend: onMapMove,
    zoomend: onMapMove
  })

  // Initial view calculation on mount
  useEffect(() => {
    if (!initializedRef.current && deployments.length > 0) {
      initializedRef.current = true
      // Small delay to ensure map is ready
      setTimeout(() => {
        pendingEmitRef.current = true
        emitViewChange()
      }, 100)
    }
  }, [deployments, emitViewChange])

  return null
}

// Component to set view on initial load or when external view changes
function ViewSetter({ deployments, externalView, isSyncingRef }) {
  const map = useMap()
  const fittedRef = useRef(false)
  const lastViewRef = useRef(null)

  // Fit to all deployments on initial load
  useEffect(() => {
    if (!fittedRef.current && deployments.length > 0 && !externalView) {
      const positions = deployments.map((d) => [d.latitude, d.longitude])
      const bounds = L.latLngBounds(positions)
      map.fitBounds(bounds, { padding: [10, 10] })
      fittedRef.current = true
    }
  }, [deployments, map, externalView])

  // Sync to external view (zoom + center) when it changes (from modal)
  useEffect(() => {
    if (externalView) {
      // Mark as fitted on first external view (allows sync to work even if
      // externalView was present before the initial fit useEffect ran)
      if (!fittedRef.current) {
        fittedRef.current = true
      }

      // Check if view actually changed to avoid infinite loops
      const viewKey = `${externalView.zoom},${externalView.center[0]},${externalView.center[1]}`
      if (lastViewRef.current !== viewKey) {
        lastViewRef.current = viewKey

        // Set flag BEFORE setView to suppress ViewportTracker emission
        if (isSyncingRef) {
          isSyncingRef.current = true
        }

        // Use setView with exact zoom and center
        map.setView(externalView.center, externalView.zoom, { animate: false })

        // Reset after map events have fired
        if (isSyncingRef) {
          requestAnimationFrame(() => {
            isSyncingRef.current = false
          })
        }
      }
    }
  }, [externalView, map, isSyncingRef])

  return null
}

export default function DeploymentMapFilter({
  studyId,
  onChange,
  onOpenModal,
  externalView,
  onViewChange
}) {
  const [visibleCount, setVisibleCount] = useState(0)
  const isSyncingRef = useRef(false) // Track when syncing from external source

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

  // Calculate initial bounds
  const initialBounds = useMemo(() => {
    if (deploymentsWithCoords.length === 0) return null
    if (deploymentsWithCoords.length === 1) {
      // For single deployment, create bounds around it with some padding
      const d = deploymentsWithCoords[0]
      return L.latLngBounds(
        [d.latitude - 0.01, d.longitude - 0.01],
        [d.latitude + 0.01, d.longitude + 0.01]
      )
    }
    const positions = deploymentsWithCoords.map((d) => [d.latitude, d.longitude])
    return L.latLngBounds(positions)
  }, [deploymentsWithCoords])

  // Handle view change from viewport tracker
  const handleViewChange = useCallback(
    (view) => {
      const visibleDeployments = filterDeploymentsByBounds(deploymentsWithCoords, view.bounds)
      const deploymentIDs = visibleDeployments.map((d) => d.deploymentID)
      setVisibleCount(deploymentIDs.length)
      onChange(deploymentIDs)
      if (onViewChange) {
        onViewChange(view)
      }
    },
    [deploymentsWithCoords, onChange, onViewChange]
  )

  // Update visibleCount when receiving external view (from modal)
  useEffect(() => {
    if (externalView?.bounds) {
      const visibleDeployments = filterDeploymentsByBounds(
        deploymentsWithCoords,
        externalView.bounds
      )
      setVisibleCount(visibleDeployments.length)
    }
  }, [externalView, deploymentsWithCoords])

  // Create the camera icon
  const cameraIcon = useMemo(() => createCameraIcon(16), [])

  // Loading state
  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <div className="animate-pulse text-gray-400 text-xs">Loading...</div>
      </div>
    )
  }

  // Render placeholder if no coordinates
  if (deploymentsWithCoords.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400 text-xs text-center p-2">
        <span>No deployment coordinates</span>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <MapContainer
        bounds={initialBounds}
        boundsOptions={{ padding: [10, 10] }}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <ViewSetter
          deployments={deploymentsWithCoords}
          externalView={externalView}
          isSyncingRef={isSyncingRef}
        />
        <ViewportTracker
          deployments={deploymentsWithCoords}
          onViewChange={handleViewChange}
          isSyncingRef={isSyncingRef}
        />

        {deploymentsWithCoords.map((deployment) => (
          <Marker
            key={deployment.deploymentID}
            position={[deployment.latitude, deployment.longitude]}
            icon={cameraIcon}
          />
        ))}
      </MapContainer>

      {/* Expand button */}
      <button
        onClick={onOpenModal}
        className="absolute top-1 right-1 z-[1000] p-1 bg-white rounded shadow hover:bg-gray-100 transition-colors"
        title="Expand map for precise selection"
      >
        <Expand size={14} />
      </button>

      {/* Deployment count indicator */}
      <div className="absolute bottom-1 left-1 z-[1000] bg-white/90 px-1.5 py-0.5 rounded text-xs font-medium shadow">
        {visibleCount}/{deploymentsWithCoords.length}
      </div>
    </div>
  )
}
