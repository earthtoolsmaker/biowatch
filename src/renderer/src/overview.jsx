import { useEffect, useRef, useState } from 'react'
import ReactDOMServer from 'react-dom/server'
import L from 'leaflet'
import { LayersControl, MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Camera, MapPin } from 'lucide-react'
import HideLeafletAttribution from './ui/HideLeafletAttribution'
import PlaceholderMap from './ui/PlaceholderMap'
import { useImportStatus } from '@renderer/hooks/import'
import { useQuery } from '@tanstack/react-query'
import { useSequenceGap } from './hooks/useSequenceGap'
import EditorialHeader from './overview/EditorialHeader'
import KpiBand from './overview/KpiBand'
import BestCapturesSection from './overview/BestCapturesSection'
import SpeciesDistribution from './overview/SpeciesDistribution'
import { useTheme } from './hooks/useTheme'

// ──────────────────────────────────────────────────────────────────────────
// DeploymentMap — kept here for now. Self-contained.
// ──────────────────────────────────────────────────────────────────────────

function LayerChangeHandler({ onLayerChange }) {
  const map = useMap()
  useEffect(() => {
    const handle = (e) => onLayerChange(e.name)
    map.on('baselayerchange', handle)
    return () => map.off('baselayerchange', handle)
  }, [map, onLayerChange])
  return null
}

function FitBoundsOnResize({ bounds }) {
  const map = useMap()
  const boundsRef = useRef(bounds)

  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])

  useEffect(() => {
    const container = map.getContainer()
    const userInteracted = { current: false }
    const markInteracted = () => {
      userInteracted.current = true
    }
    container.addEventListener('mousedown', markInteracted)
    container.addEventListener('wheel', markInteracted, { passive: true })
    container.addEventListener('touchstart', markInteracted, { passive: true })
    container.addEventListener('keydown', markInteracted)

    const observer = new ResizeObserver(() => {
      map.invalidateSize()
      if (!userInteracted.current && boundsRef.current) {
        map.fitBounds(boundsRef.current, { padding: [30, 30] })
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      container.removeEventListener('mousedown', markInteracted)
      container.removeEventListener('wheel', markInteracted)
      container.removeEventListener('touchstart', markInteracted)
      container.removeEventListener('keydown', markInteracted)
    }
  }, [map])

  return null
}

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

  const icon = L.divIcon({
    html: `<div class="flex items-center justify-center ${sizeClasses[size]} bg-blue-500 dark:bg-blue-600 text-white rounded-full border-2 border-white dark:border-slate-900 shadow-lg font-semibold">${count}</div>`,
    className: 'custom-cluster-icon',
    iconSize: L.point(40, 40, true)
  })

  cluster.options.title = ''
  cluster.unbindTooltip()
  cluster.bindTooltip(`${count} deployments`, { direction: 'top', offset: [0, -15] })

  return icon
}

function DeploymentMap({ deployments, studyId }) {
  const mapLayerKey = `mapLayer:${studyId}`
  const [selectedLayer, setSelectedLayer] = useState(() => {
    const saved = localStorage.getItem(mapLayerKey)
    return saved || 'Satellite'
  })

  useEffect(() => {
    localStorage.setItem(mapLayerKey, selectedLayer)
  }, [selectedLayer, mapLayerKey])

  const { resolved: streetMapResolved } = useTheme()
  const streetMapUrl =
    streetMapResolved === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const streetMapAttribution =
    streetMapResolved === 'dark'
      ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

  if (!deployments || deployments.length === 0) {
    return (
      <PlaceholderMap
        title="No Deployment Data"
        description="Set up deployments in the Deployments tab to see camera trap locations on this map."
        linkTo="/deployments"
        linkText="Go to Deployments"
        icon={MapPin}
        studyId={studyId}
      />
    )
  }

  const valid = deployments.filter((d) => d.latitude && d.longitude)

  if (valid.length === 0) {
    return (
      <PlaceholderMap
        title="No Geographic Coordinates"
        description="Set up deployment coordinates in the Deployments tab to see camera trap locations on this map."
        linkTo="/deployments"
        linkText="Go to Deployments"
        icon={MapPin}
        studyId={studyId}
      />
    )
  }

  const positions = valid.map((d) => [parseFloat(d.latitude), parseFloat(d.longitude)])
  const bounds = L.latLngBounds(positions)

  const formatDate = (s) => {
    if (!s) return 'N/A'
    return new Date(s).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const cameraIcon = L.divIcon({
    html: ReactDOMServer.renderToString(
      <div className="camera-marker">
        <Camera color="#1E40AF" fill="#93C5FD" size={28} />
      </div>
    ),
    className: 'custom-camera-icon',
    iconSize: [18, 18],
    iconAnchor: [14, 14]
  })

  return (
    <div className="w-full h-full bg-card rounded-xl border border-border shadow-md overflow-hidden">
      <MapContainer
        key={studyId}
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        style={{ height: '100%', width: '100%' }}
      >
        <HideLeafletAttribution />
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="Satellite" checked={selectedLayer === 'Satellite'}>
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Street Map" checked={selectedLayer === 'Street Map'}>
            <TileLayer
              key={`street-${streetMapResolved}`}
              attribution={streetMapAttribution}
              url={streetMapUrl}
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <LayerChangeHandler onLayerChange={setSelectedLayer} />
        <FitBoundsOnResize bounds={bounds} />
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          maxClusterRadius={50}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
          zoomToBoundsOnClick
          polygonOptions={{ opacity: 0 }}
          singleMarkerMode={false}
        >
          {valid.map((d) => (
            <Marker
              key={d.deploymentID}
              position={[parseFloat(d.latitude), parseFloat(d.longitude)]}
              icon={cameraIcon}
            >
              <Popup>
                <div>
                  <h3 className="text-base font-semibold">
                    {d.locationName || d.locationID || 'Unnamed Location'}
                  </h3>
                  <p className="text-sm">
                    {formatDate(d.deploymentStart)} - {formatDate(d.deploymentEnd)}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Overview — the editorial showcase tab.
// ──────────────────────────────────────────────────────────────────────────

// Pixels the bottom panel needs to keep visible: BestCaptures band
// (~220px) + species header + 3 rows (~108px) + tightened IUCN legend +
// vertical padding/gaps. Used to compute a dynamic `minSize` % on the
// bottom panel so the resizer can never crush the species list below
// 3 visible rows.
const BOTTOM_MIN_PX = 440

export default function Overview({ data, studyId, studyName }) {
  const { importStatus } = useImportStatus(studyId)
  const { sequenceGap } = useSequenceGap(studyId)

  const containerRef = useRef(null)
  const [bottomMinPercent, setBottomMinPercent] = useState(40)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () => {
      const h = el.clientHeight
      if (h <= 0) return
      // Cap at 65 so the user can still grow the top section meaningfully.
      // Floor at 30 so very tall windows don't pin the resizer too high.
      const pct = Math.min(65, Math.max(30, Math.ceil((BOTTOM_MIN_PX / h) * 100)))
      setBottomMinPercent(pct)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { data: deploymentsData, error: deploymentsError } = useQuery({
    queryKey: ['deploymentsAll', studyId],
    queryFn: async () => {
      const response = await window.api.getAllDeployments(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })

  const { data: speciesData, error: speciesError } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', studyId, sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId && sequenceGap !== undefined,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    placeholderData: (prev) => prev,
    staleTime: Infinity
  })

  const error = speciesError?.message || deploymentsError?.message || null

  return (
    <div
      ref={containerRef}
      className="@container flex flex-col px-6 h-full overflow-x-hidden max-w-[1950px]"
    >
      <PanelGroup direction="vertical" autoSaveId="overview-layout">
        <Panel defaultSize={50} minSize={30} className="flex flex-col">
          <div className="flex flex-col gap-4 h-full pt-4 pb-2 pr-1 min-h-0">
            <div className="flex-1 min-h-0">
              <EditorialHeader
                studyId={studyId}
                studyName={studyName}
                studyData={data}
                mapSlot={
                  <DeploymentMap key={studyId} deployments={deploymentsData} studyId={studyId} />
                }
              />
            </div>
            <div className="flex-shrink-0">
              <KpiBand studyId={studyId} studyData={data} isImporting={importStatus?.isRunning} />
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="h-1 my-1.5 rounded-full bg-muted hover:bg-accent data-[resize-handle-state=drag]:bg-blue-300 dark:data-[resize-handle-state=drag]:bg-blue-500 cursor-row-resize transition-colors" />

        <Panel defaultSize={50} minSize={bottomMinPercent} className="flex flex-col">
          <div className="flex flex-col gap-4 h-full pt-2 pb-1 pr-1 min-h-0">
            <div className="flex-shrink-0">
              <BestCapturesSection studyId={studyId} isRunning={importStatus?.isRunning} />
            </div>
            <div className="flex-1 min-h-0">
              <SpeciesDistribution
                studyId={studyId}
                speciesData={speciesData}
                taxonomicData={data?.taxonomic || null}
              />
            </div>
            {error && (
              <div className="text-red-500 text-sm flex-shrink-0 dark:text-red-400">
                Error: {error}
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
