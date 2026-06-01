import * as htmlToImage from 'html-to-image'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LayersControl,
  MapContainer,
  Marker,
  Rectangle,
  TileLayer,
  useMap,
  useMapEvents
} from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import ActivityMapContextMenu from './ui/ActivityMapContextMenu'
import CircularTimeFilter, { DailyActivityRadar, DailyActivityLine } from './ui/clock'
import DayPeriodChips from './ui/dayPeriodChips'
import ChartShapeToggle from './ui/chartShapeToggle'
import {
  ALL_CHIPS_SELECTED,
  arcToRanges,
  chipsToRanges,
  DAY_PERIOD_ORDER,
  DAY_PERIOD_PRESETS,
  mergeChipRanges
} from './utils/dayPeriods'
import HideLeafletAttribution from './ui/HideLeafletAttribution'
import MarkerHoverCard from './ui/MarkerHoverCard'
import { useTheme } from './hooks/useTheme'
import PlaceholderMap from './ui/PlaceholderMap'
import { SequenceGapSlider } from './ui/SequenceGapSlider'
import FilterChartsToggle from './ui/FilterChartsToggle'
import ViewModeToggle from './ui/ViewModeToggle'
import ThumbnailBboxToggle from './ui/ThumbnailBboxToggle'
import Gallery from './media/Gallery'
import { useIsLgUp } from './hooks/useIsLgUp'
import { getAvailableViewModes, clampViewMode } from './utils/viewLayout'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'
import { useImportStatus } from './hooks/import'
import { buildScientificToCommonMap, getMapDisplayName } from './utils/commonNames'
import { formatScientificName } from './utils/scientificName'
import { getTopNonHumanSpecies } from './utils/speciesUtils'
import { useSequenceGap } from './hooks/useSequenceGap'
import { useShowFilterCharts } from './hooks/useShowFilterCharts'
import { useDateRange } from './hooks/useDateRange'
import { useAreaFilter } from './hooks/useAreaFilter'

// Inject the keyframes used by the skeleton markers once per page load.
// Guarded by an id check so HMR / multiple SpeciesMap mounts don't re-append
// the same <style> block.
const skeletonMarkerStyles = `
  @keyframes activity-skeleton-pulse {
    0%   { opacity: 0.55; }
    50%  { opacity: 1; }
    100% { opacity: 0.55; }
  }
  .activity-skeleton-marker, .activity-skeleton-cluster {
    animation: activity-skeleton-pulse 1.6s ease-in-out infinite;
  }
`
if (typeof document !== 'undefined' && !document.getElementById('activity-skeleton-styles')) {
  const style = document.createElement('style')
  style.id = 'activity-skeleton-styles'
  style.textContent = skeletonMarkerStyles
  document.head.appendChild(style)
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

// Bridges Leaflet's right-click event to React state in the parent
// SpeciesMap, and keeps a ref to the map instance so the export handler
// can read it after the menu has closed (which would otherwise drop the
// reference if it were stored alongside the menu position).
function MapContextMenuController({ onContextMenu, mapRef }) {
  const map = useMapEvents({
    contextmenu(e) {
      e.originalEvent.preventDefault()
      onContextMenu({
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY
      })
    }
  })
  useEffect(() => {
    mapRef.current = map
  }, [map, mapRef])
  return null
}

// Floating top-center pill for the map area filter. The pill body always
// snapshots the current viewport bounds on click — so when a filter is
// already active you can re-filter a freshly-panned area in one click (no
// clear-first dance). When a filter IS active the pill turns blue and a ✕
// appears inside it at the trailing edge; clicking the ✕ clears in one click
// without re-applying. The filter is a frozen snapshot: panning after
// applying does NOT recompute it until you click the pill again.
function AreaFilterControl({ areaFilter, onApplyAreaFilter }) {
  const map = useMap()
  const active = !!areaFilter

  const apply = () => {
    const b = map.getBounds()
    onApplyAreaFilter({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest()
    })
  }

  const clear = (e) => {
    e.stopPropagation()
    onApplyAreaFilter(null)
  }

  return (
    <div className="leaflet-top" style={{ left: '50%', transform: 'translateX(-50%)' }}>
      <div className="leaflet-control">
        <div
          role="button"
          tabIndex={0}
          onClick={apply}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') apply()
          }}
          className={`flex items-center gap-1.5 h-7 rounded-full text-xs font-medium border shadow-sm transition-colors cursor-pointer ${
            active ? 'pl-3 pr-1.5' : 'px-3'
          } ${
            active
              ? 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:border-blue-500/30 dark:hover:bg-blue-500/25'
              : 'text-muted-foreground bg-card border-border hover:bg-accent'
          }`}
          aria-label="Filter to this area"
          aria-pressed={active}
        >
          <MapPin size={14} />
          Filter to this area
          {active && (
            <button
              type="button"
              onClick={clear}
              className="flex items-center justify-center h-5 w-5 rounded-full hover:bg-blue-200/60 dark:hover:bg-blue-500/30 transition-colors"
              aria-label="Clear area filter"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const slugifyForFilename = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// Markers whose deployment falls outside the active area filter are kept on the
// map (so the user can still see where to widen the selection) but visually
// de-emphasized to OUTSIDE_OPACITY. With no filter, everything is fully opaque.
const OUTSIDE_OPACITY = 0.35
const isInsideArea = (lat, lng, area) => {
  if (!area) return true
  const { north, south, east, west } = area
  if ([north, south, east, west].some((v) => typeof v !== 'number' || Number.isNaN(v))) return true
  if (west > east) return true // antimeridian box: don't de-emphasize (matches buildBboxClause no-op)
  return lat >= south && lat <= north && lng >= west && lng <= east
}

// SpeciesMap component.
//
// Renders the leaflet map in two progressive modes so the user sees something
// at deployment locations as fast as possible:
//   1. `heatmapData` null (still loading in the worker) → uniform gray dots
//      clustered at the deployment coordinates. The map mounts with bounds
//      derived from `deploymentLocations`, which comes from the lightweight
//      getDeploymentLocations query (shared cache with Overview/Deployments,
//      ~ms). On gmu8_leuven this paints in ~50ms instead of waiting ~8s
//      for the heavy sequence-aware SQL.
//   2. `heatmapData` present → swap the MarkerClusterGroup contents to the
//      pie-chart markers. The MapContainer and LayersControl stay mounted,
//      so the user's zoom/pan/layer selection survive the swap.
//
// The cluster group's `key` is still `geoKey` so filter changes rebuild the
// clustering (same as before), plus an extra 'pies'/'dots' suffix so the
// initial dots → pies transition forces a fresh cluster layer rather than
// trying to reconcile pie icons onto gray markers.
const SpeciesMap = ({
  deploymentLocations,
  heatmapData,
  selectedSpecies,
  palette,
  geoKey,
  studyId,
  studyName,
  scientificToCommon,
  areaFilter,
  onApplyAreaFilter
}) => {
  // Persist map layer selection per study
  const mapLayerKey = `mapLayer:${studyId}`
  const [selectedLayer, setSelectedLayer] = useState(() => {
    const saved = localStorage.getItem(mapLayerKey)
    return saved || 'Satellite'
  })

  useEffect(() => {
    localStorage.setItem(mapLayerKey, selectedLayer)
  }, [selectedLayer, mapLayerKey])

  // Theme-aware Street Map tile layer (light: OpenStreetMap, dark: CartoDB Dark Matter).
  const { resolved: streetMapResolved } = useTheme()
  const streetMapUrl =
    streetMapResolved === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const streetMapAttribution =
    streetMapResolved === 'dark'
      ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

  // Right-click context menu for "Save map as PNG…"
  const mapRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)

  const handleSavePng = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    const container = map.getContainer()
    const slug = slugifyForFilename(studyName) || slugifyForFilename(studyId) || 'study'
    const date = new Date().toISOString().slice(0, 10)
    const defaultFilename = `activity-map-${slug}-${date}.png`
    toast.loading('Preparing map image…', { id: 'activity-map-export' })
    try {
      const dataUrl = await htmlToImage.toPng(container, {
        pixelRatio: 2,
        // skipFonts avoids html-to-image fetching @import url(fonts.googleapis.com)
        // through CSP `connect-src` — fonts in the export fall back to system UI fonts,
        // which is fine for the tile labels and our own legend text.
        skipFonts: true,
        // Strip Leaflet's UI controls from the export. Attribution stays
        // (legal requirement for OSM/Esri).
        filter: (node) => {
          const cl = node.classList
          if (!cl) return true
          if (cl.contains('leaflet-control-zoom')) return false
          if (cl.contains('leaflet-control-layers')) return false
          return true
        }
      })
      const result = await window.api.exportActivityMapPng({ dataUrl, defaultFilename })
      if (result?.cancelled) {
        toast.dismiss('activity-map-export')
      } else if (result?.success) {
        toast.success('Map saved', {
          id: 'activity-map-export',
          description: result.filePath
        })
      } else {
        toast.error('Export failed', {
          id: 'activity-map-export',
          description: result?.error || 'Unknown error'
        })
      }
    } catch (error) {
      toast.error('Export failed', {
        id: 'activity-map-export',
        description: error.message
      })
    }
  }, [studyId, studyName])
  // Function to create a pie chart icon. Memoized so re-renders (e.g. toggling
  // the area filter) don't rebuild every SVG — building the SVG + serializing +
  // base64-encoding it for ~hundreds of points on every render is what froze the
  // UI thread. `opacity` < 1 fades the whole pie (used for de-emphasized clusters).
  const createPieChartIcon = useCallback(
    (counts, opacity = 1) => {
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
      const size = Math.min(60, Math.max(10, Math.sqrt(total) * 3)) // Scale dot size based on count

      const createSVG = () => {
        // Create SVG for pie chart
        const svgNS = 'http://www.w3.org/2000/svg'
        const svg = document.createElementNS(svgNS, 'svg')
        svg.setAttribute('width', size)
        svg.setAttribute('height', size)
        svg.setAttribute('viewBox', `0 0 100 100`)
        if (opacity < 1) svg.setAttribute('opacity', String(opacity))

        // Add a circle background - only needed for multiple species
        if (Object.keys(counts).length > 1) {
          const circle = document.createElementNS(svgNS, 'circle')
          circle.setAttribute('cx', '50')
          circle.setAttribute('cy', '50')
          circle.setAttribute('r', '50')
          circle.setAttribute('fill', 'white')
          svg.appendChild(circle)
        }

        // Draw pie slices
        let startAngle = 0
        const colors = selectedSpecies.map((_, i) => palette[i % palette.length])

        // Use the same radius for pie slices as for the circle
        const radius = 50

        // Special case for single species - draw a full circle
        if (Object.keys(counts).length === 1) {
          const species = Object.keys(counts)[0]
          const index = selectedSpecies.findIndex((s) => s.scientificName === species)
          const colorIndex = index >= 0 ? index : 0
          const color = colors[colorIndex]

          const circle = document.createElementNS(svgNS, 'circle')
          circle.setAttribute('cx', '50')
          circle.setAttribute('cy', '50')
          circle.setAttribute('r', '50')
          circle.setAttribute('fill', color)
          svg.appendChild(circle)
        } else {
          // Multiple species - draw pie slices
          Object.entries(counts).forEach(([species, count]) => {
            const index = selectedSpecies.findIndex((s) => s.scientificName === species)
            if (index < 0) return // Skip if species not in selectedSpecies

            const portion = count / total
            const endAngle = startAngle + portion * 2 * Math.PI
            const color = colors[index]

            const largeArcFlag = portion > 0.5 ? 1 : 0

            const x1 = 50 + radius * Math.sin(startAngle)
            const y1 = 50 - radius * Math.cos(startAngle)
            const x2 = 50 + radius * Math.sin(endAngle)
            const y2 = 50 - radius * Math.cos(endAngle)

            const pathData = [
              `M 50 50`,
              `L ${x1} ${y1}`,
              `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
              `Z`
            ].join(' ')

            const path = document.createElementNS(svgNS, 'path')
            path.setAttribute('d', pathData)
            path.setAttribute('fill', color)
            path.setAttribute('stroke', color) // Match stroke color to fill color
            path.setAttribute('stroke-width', '0.5') // Very thin stroke just to smooth edges
            svg.appendChild(path)

            startAngle = endAngle
          })
        }

        return svg
      }

      const svgElement = createSVG()
      const svgString = new XMLSerializer().serializeToString(svgElement)
      const dataUrl = `data:image/svg+xml;base64,${btoa(svgString)}`

      return L.icon({
        iconUrl: dataUrl,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2]
      })
    },
    [selectedSpecies, palette]
  )

  // Render the React MarkerHoverCard to an HTML string. Leaflet's tooltip API
  // takes raw HTML, so we serialize the JSX once per call. Using a React
  // component (instead of a template-string builder) keeps the markup
  // testable, properly indented, and shared between per-marker and
  // per-cluster tooltips below.
  const createTooltipContent = (counts) =>
    renderToStaticMarkup(
      <MarkerHoverCard
        counts={counts}
        selectedSpecies={selectedSpecies}
        palette={palette}
        scientificToCommon={scientificToCommon}
      />
    )

  // PieChartMarker component with tooltip binding. Out-of-area de-emphasis is
  // applied imperatively (see the opacity effect below) rather than via an
  // `opacity` prop, so toggling the area filter never re-renders these markers.
  function PieChartMarker({ point, icon }) {
    const markerRef = useRef(null)

    useEffect(() => {
      const marker = markerRef.current
      if (!marker) return

      const tooltipHtml = createTooltipContent(point.counts)
      marker.unbindTooltip()
      marker.bindTooltip(tooltipHtml, {
        // 'auto' resolves to 'right' or 'left' depending on whether the
        // marker is left or right of map center, so the card sits BESIDE
        // the pie chart rather than above it. The CSS rule
        // `.leaflet-tooltip-{right,left}.species-map-tooltip` adds a
        // horizontal gap so the card doesn't overlap the marker.
        direction: 'auto',
        offset: [0, 0],
        opacity: 1,
        className: 'species-map-tooltip'
      })

      return () => marker.unbindTooltip()
    }, [point.counts])

    return (
      <Marker ref={markerRef} position={[point.lat, point.lng]} icon={icon} counts={point.counts} />
    )
  }

  // Process data points. Memoized on the underlying data/species so the point
  // set — and the `counts` object identities the tooltip effect depends on —
  // stay stable across re-renders (e.g. when the area filter toggles).
  const locationPoints = useMemo(() => {
    const locations = {}

    // Combine data from all species
    selectedSpecies.forEach((species) => {
      const speciesName = species.scientificName
      const points = heatmapData?.[speciesName] || []

      points.forEach((point) => {
        const key = `${point.lat},${point.lng}`
        if (!locations[key]) {
          locations[key] = {
            lat: parseFloat(point.lat),
            lng: parseFloat(point.lng),
            counts: {}
          }
        }

        locations[key].counts[speciesName] = point.count
      })
    })

    return Object.values(locations)
  }, [heatmapData, selectedSpecies])

  // Pie icons are expensive (SVG build + serialize + base64). Memoize them on the
  // data — crucially NOT on areaFilter — so applying/clearing the area filter
  // never rebuilds them; only the cheap per-marker opacity changes.
  const pieIcons = useMemo(
    () => locationPoints.map((point) => createPieChartIcon(point.counts)),
    [locationPoints, createPieChartIcon]
  )

  // Memoize the marker elements so they are NOT recreated/reconciled when the
  // area filter toggles (only when the underlying data changes). Recreating
  // ~hundreds of react-leaflet markers per render is the bulk of the freeze.
  const markerElements = useMemo(
    () =>
      locationPoints.map((point, index) => (
        <PieChartMarker key={index} point={point} icon={pieIcons[index]} />
      )),
    [locationPoints, pieIcons]
  )

  // De-emphasize markers outside the area filter imperatively: set each marker's
  // opacity directly on the Leaflet layer and re-fade the cluster icons. This
  // avoids touching the React tree, so applying/clearing the filter is cheap.
  const pieClusterRef = useRef(null)
  useEffect(() => {
    const group = pieClusterRef.current
    if (!group) return
    group.getLayers().forEach((layer) => {
      const ll = layer.getLatLng?.()
      if (ll && layer.setOpacity) {
        layer.setOpacity(isInsideArea(ll.lat, ll.lng, areaFilter) ? 1 : OUTSIDE_OPACITY)
      }
    })
    group.refreshClusters?.()
  }, [areaFilter, markerElements])

  // Bounds derive from deploymentLocations, not heatmapData, so the initial
  // viewport is fixed from the moment the map mounts — it doesn't shift
  // when the heavy heatmap query finally resolves.
  const bounds = (() => {
    const src = (deploymentLocations || []).filter((d) => d.latitude != null && d.longitude != null)
    if (src.length === 0) return null
    return src.reduce(
      (b, d) => [
        [Math.min(b[0][0], +d.latitude), Math.min(b[0][1], +d.longitude)],
        [Math.max(b[1][0], +d.latitude), Math.max(b[1][1], +d.longitude)]
      ],
      [
        [90, 180],
        [-90, -180]
      ]
    )
  })()

  // Options for bounds
  const boundsOptions = {
    padding: [20, 20]
  }

  // Skeleton mode: uniform gray dots at deployment coords while heatmap
  // loads. Dedup by (lat, lng) so co-located deployments share a single
  // marker — matches how the final pies are grouped.
  const skeletonMode = !heatmapData
  const skeletonPoints = (() => {
    if (!skeletonMode || !deploymentLocations) return []
    const seen = new Map()
    for (const d of deploymentLocations) {
      if (d.latitude == null || d.longitude == null) continue
      const key = `${d.latitude},${d.longitude}`
      if (!seen.has(key)) {
        seen.set(key, { lat: parseFloat(d.latitude), lng: parseFloat(d.longitude) })
      }
    }
    return Array.from(seen.values())
  })()

  // Small uniform gray dot with a soft pulse so the user reads the map as
  // "loading" rather than "done, just sparse". Pulse comes from the
  // `activity-skeleton-marker` keyframes injected at module load.
  const skeletonDotIcon = useMemo(() => {
    const size = 14
    return L.divIcon({
      html: `<div class="activity-skeleton-marker" style="width:${size}px;height:${size}px;background:#9ca3af;border:2px solid white;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,0.2);"></div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    })
  }, [])

  // Cluster icon matches the dots: same gray, same pulse, no count label
  // (the count would overstate certainty before species data arrives).
  // Size still scales with child count so dense areas read as bigger.
  const createSkeletonClusterIcon = (cluster) => {
    const count = cluster.getChildCount()
    const size = count >= 50 ? 40 : count >= 10 ? 34 : 28
    cluster.unbindTooltip()
    cluster.bindTooltip('Loading species data…', { direction: 'top', offset: [0, -10] })
    return L.divIcon({
      html: `<div class="activity-skeleton-cluster" style="width:${size}px;height:${size}px;background:#9ca3af;border-radius:50%;border:2px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.2);"></div>`,
      className: '',
      iconSize: L.point(size, size, true)
    })
  }

  return (
    <>
      <MapContainer bounds={bounds} boundsOptions={boundsOptions} className="rounded w-full h-full">
        <HideLeafletAttribution />
        <MapContextMenuController onContextMenu={setContextMenu} mapRef={mapRef} />
        <AreaFilterControl areaFilter={areaFilter} onApplyAreaFilter={onApplyAreaFilter} />
        {areaFilter && (
          <Rectangle
            bounds={[
              [areaFilter.south, areaFilter.west],
              [areaFilter.north, areaFilter.east]
            ]}
            pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.05 }}
            interactive={false}
          />
        )}
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="Satellite" checked={selectedLayer === 'Satellite'}>
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              crossOrigin=""
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Street Map" checked={selectedLayer === 'Street Map'}>
            <TileLayer
              key={`street-${streetMapResolved}`}
              attribution={streetMapAttribution}
              url={streetMapUrl}
              crossOrigin=""
            />
          </LayersControl.BaseLayer>

          <LayersControl.Overlay name="Species Distribution" checked={true}>
            {skeletonMode ? (
              <MarkerClusterGroup
                key={`skeleton:${skeletonPoints.length}`}
                chunkedLoading
                showCoverageOnHover={false}
                spiderfyOnEveryZoom={false}
                maxClusterRadius={100}
                animateAddingMarkers={false}
                iconCreateFunction={createSkeletonClusterIcon}
              >
                {skeletonPoints.map((point, index) => (
                  <Marker
                    key={`skeleton-${index}`}
                    position={[point.lat, point.lng]}
                    icon={skeletonDotIcon}
                  />
                ))}
              </MarkerClusterGroup>
            ) : (
              <MarkerClusterGroup
                ref={pieClusterRef}
                key={`pies:${geoKey}`}
                chunkedLoading
                showCoverageOnHover={false}
                spiderfyOnEveryZoom={false}
                maxClusterRadius={100}
                animateAddingMarkers={false}
                iconCreateFunction={(cluster) => {
                  // Get all markers in this cluster
                  const markers = cluster.getAllChildMarkers()

                  // A cluster is de-emphasized only when ALL its markers fall
                  // outside the area filter; any inside marker keeps it full.
                  const anyInside = markers.some((m) => {
                    const ll = m.getLatLng()
                    return isInsideArea(ll.lat, ll.lng, areaFilter)
                  })

                  // Combine counts from all markers
                  const combinedCounts = {}

                  // First, initialize counts for all selected species to ensure consistent ordering
                  selectedSpecies.forEach((species) => {
                    combinedCounts[species.scientificName] = 0
                  })

                  // Then add actual counts from markers
                  markers.forEach((marker) => {
                    Object.entries(marker.options.counts).forEach(([species, count]) => {
                      // Only add species that are in our selectedSpecies list
                      if (selectedSpecies.some((s) => s.scientificName === species)) {
                        combinedCounts[species] += count
                      }
                    })
                  })

                  // Filter out species with zero counts to avoid empty slices
                  const filteredCounts = Object.fromEntries(
                    Object.entries(combinedCounts).filter(([, count]) => count > 0)
                  )

                  // Bind tooltip to cluster. Same beside-the-pie behavior as
                  // individual markers — see the per-marker bindTooltip above.
                  const tooltipHtml = createTooltipContent(filteredCounts)
                  cluster.unbindTooltip()
                  cluster.bindTooltip(tooltipHtml, {
                    direction: 'auto',
                    offset: [0, 0],
                    opacity: 1,
                    className: 'species-map-tooltip'
                  })

                  return createPieChartIcon(filteredCounts, anyInside ? 1 : OUTSIDE_OPACITY)
                }}
              >
                {markerElements}
              </MarkerClusterGroup>
            )}
          </LayersControl.Overlay>

          {/* Add a legend */}
          <div className="absolute bottom-5 right-5 bg-card p-2 rounded shadow-md z-[1000] flex flex-col gap-2">
            {selectedSpecies.map((species, index) => {
              const common = getMapDisplayName(species.scientificName, scientificToCommon)
              const showSci = common && common !== species.scientificName
              return (
                <div key={index} className="flex items-start gap-2">
                  <div
                    className="w-3 h-3 rounded-full mt-0.5 flex-shrink-0"
                    style={{ backgroundColor: palette[index % palette.length] }}
                  ></div>
                  <div className="flex flex-col min-w-0 leading-tight">
                    <span className={`text-xs ${common ? 'capitalize' : 'italic'}`}>
                      {common || formatScientificName(species.scientificName)}
                    </span>
                    {showSci && (
                      <span className="text-[10px] text-muted-foreground italic">
                        {formatScientificName(species.scientificName)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </LayersControl>
        <LayerChangeHandler onLayerChange={setSelectedLayer} />
      </MapContainer>
      {contextMenu && (
        <ActivityMapContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onSave={handleSavePng}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

const palette = [
  'hsl(173 58% 39%)',
  'hsl(43 74% 66%)',
  'hsl(12 76% 61%)',
  'hsl(197 37% 24%)',
  'hsl(27 87% 67%)'
]

export default function Activity({ studyData, studyId }) {
  const { id } = useParams()
  const actualStudyId = studyId || id // Use passed studyId or from params

  const [selectedSpecies, setSelectedSpecies] = useState([])
  const [speciesInitialized, setSpeciesInitialized] = useState(false)
  const { dateRange, setDateRange } = useDateRange(actualStudyId)
  const [fullExtent, setFullExtent] = useState([null, null])
  const [chipSelection, setChipSelection] = useState(() => new Set(ALL_CHIPS_SELECTED))
  const [arc, setArc] = useState({ start: 0, end: 24 })
  const [chartShape, setChartShape] = useState('polar')

  // All four chips (the default) is treated as "no filter" — null-timestamp
  // media still flows through, mirroring the timeline's default behavior.
  const timeRange = useMemo(() => {
    if (chipSelection.size === DAY_PERIOD_ORDER.length) return { ranges: [] }
    const ranges = chipSelection.size > 0 ? chipsToRanges(chipSelection) : arcToRanges(arc)
    return { ranges }
  }, [chipSelection, arc])

  // Merged ranges for VISUAL highlighting (collapses contiguous chip
  // selections into single arcs/bands; all four → one full-day sweep).
  // With no chips, mirror the freeform drag-arc selection into the x-y
  // view too — same underlying filter.
  const visualRanges = useMemo(() => {
    if (chipSelection.size > 0) return mergeChipRanges(chipsToRanges(chipSelection))
    return arcToRanges(arc)
  }, [chipSelection, arc])

  const hasDateFilter = useMemo(() => !!(dateRange[0] && dateRange[1]), [dateRange])
  const isFiltering = useMemo(
    () => timeRange.ranges.length > 0 || hasDateFilter,
    [timeRange, hasDateFilter]
  )

  const dayFilterLabel = useMemo(() => {
    if (timeRange.ranges.length === 0) return null
    if (chipSelection.size > 0) {
      return DAY_PERIOD_ORDER.filter((k) => chipSelection.has(k))
        .map((k) => DAY_PERIOD_PRESETS[k].label)
        .join(', ')
    }
    const fmt = (h) => `${String(Math.floor(h)).padStart(2, '0')}:00`
    return `${fmt(arc.start)} → ${fmt(arc.end)}`
  }, [timeRange, chipSelection, arc])
  const dateFilterLabel = useMemo(() => {
    if (!hasDateFilter) return null
    const fmt = (d) =>
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${fmt(dateRange[0])} → ${fmt(dateRange[1])}`
  }, [hasDateFilter, dateRange])
  const { areaFilter, setAreaFilter } = useAreaFilter(actualStudyId)
  const areaFilterLabel = useMemo(() => {
    if (!areaFilter) return null
    const lat = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`
    const lng = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`
    return `${lat(areaFilter.south)}–${lat(areaFilter.north)}, ${lng(areaFilter.west)}–${lng(areaFilter.east)}`
  }, [areaFilter])
  const isFilteringWithArea = isFiltering || !!areaFilter
  const handleResetFilters = useCallback(() => {
    setChipSelection(new Set(ALL_CHIPS_SELECTED))
    setArc({ start: 0, end: 24 })
    setDateRange([null, null])
    setAreaFilter(null)
  }, [setDateRange, setAreaFilter])
  const { importStatus } = useImportStatus(actualStudyId, 5000)
  const { sequenceGap, setSequenceGap } = useSequenceGap(actualStudyId)
  const { showFilterCharts } = useShowFilterCharts(actualStudyId)

  // Explore view toggle: 'map' | 'gallery' | 'both'. Defaults to 'map'
  // (not persisted). 'both' is only available at lg+; clamp to 'map' if the
  // window is narrower so a stale 'both' selection can't render off-breakpoint.
  const isLgUp = useIsLgUp()
  const [viewModeRaw, setViewMode] = useState('map')
  const viewMode = clampViewMode(viewModeRaw, isLgUp)
  const availableViewModes = getAvailableViewModes(isLgUp)
  const showMap = viewMode === 'map' || viewMode === 'both'
  const showGallery = viewMode === 'gallery' || viewMode === 'both'

  // Suppress the filter-row's open/close transition until species + temporal
  // guards have settled. On tab navigation the wrapper otherwise flips
  // h-0 → h-[180px] when the async timeseries query resolves, which fires
  // the CSS ease-in animation even though no user toggle happened.
  const [filterRowTransitionsEnabled, setFilterRowTransitionsEnabled] = useState(false)

  // Lightweight deduped deployment-location query (shared cache with the
  // Overview tab). Used to paint the skeleton map immediately while the
  // heavy sequence-aware heatmap SQL runs in the worker.
  const { data: deploymentLocations } = useQuery({
    queryKey: ['deploymentLocations', actualStudyId],
    queryFn: async () => {
      const response = await window.api.getDeploymentLocations(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    staleTime: Infinity
  })

  // Get taxonomic data from studyData
  const taxonomicData = studyData?.taxonomic || null

  // scientificName -> English vernacular name from CamtrapDP imports.
  // Used by the map's marker tooltips and bottom-right legend so they can
  // show common names alongside (or instead of) scientific names. Same
  // helper feeds the species sidebar, so the two surfaces stay in sync.
  const scientificToCommon = useMemo(
    () => buildScientificToCommonMap(taxonomicData),
    [taxonomicData]
  )

  // Fetch sequence-aware species distribution data
  // sequenceGap in queryKey ensures refetch when slider changes (backend fetches from metadata)
  const { data: speciesDistributionData, error: speciesDistributionError } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', actualStudyId, sequenceGap, areaFilter],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(
        actualStudyId,
        sequenceGap,
        areaFilter
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId && sequenceGap !== undefined,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    placeholderData: (prev) => prev,
    staleTime: Infinity
  })

  // Initialize selectedSpecies when speciesDistributionData loads
  // Excludes humans/vehicles from default selection.
  // `speciesInitialized` gates the bottom-row mount so TimelineChart /
  // DailyActivityRadar / CircularTimeFilter don't fire their sequence-aware
  // queries twice (once with [] species, once with the top-2) on large
  // studies. Mirrors the same guard in media.jsx (PR b5c4dca).
  useEffect(() => {
    if (speciesDistributionData && !speciesInitialized) {
      setSelectedSpecies(getTopNonHumanSpecies(speciesDistributionData, 2))
      setSpeciesInitialized(true)
    }
  }, [speciesDistributionData, speciesInitialized])

  // Memoize speciesNames to avoid unnecessary re-renders
  const speciesNames = useMemo(
    () => selectedSpecies.map((s) => s.scientificName),
    [selectedSpecies]
  )

  const geoKey =
    selectedSpecies.map((s) => s.scientificName).join(',') +
    (dateRange[0]?.toISOString() || '') +
    (dateRange[1]?.toISOString() || '') +
    JSON.stringify(timeRange.ranges)

  // Fetch sequence-aware timeseries data
  // sequenceGap in queryKey ensures refetch when slider changes (backend fetches from metadata)
  const { data: timeseriesQueryData } = useQuery({
    queryKey: [
      'sequenceAwareTimeseries',
      actualStudyId,
      [...speciesNames].sort(),
      sequenceGap,
      areaFilter
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareTimeseries(
        actualStudyId,
        speciesNames,
        sequenceGap,
        areaFilter
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId && speciesNames.length > 0 && sequenceGap !== undefined,
    placeholderData: (prev) => prev,
    staleTime: Infinity
  })
  const timeseriesData = timeseriesQueryData?.timeseries ?? []

  // Check if dataset has temporal data
  const hasTemporalData = useMemo(() => {
    return timeseriesData && timeseriesData.length > 0
  }, [timeseriesData])

  // Set fullExtent from the timeseries data so downstream `isFullRange`
  // and components can reason about the data's outer bounds. dateRange
  // itself is NOT auto-initialised — [null, null] is the "no filter"
  // sentinel in the unified model, and a persisted range (if any) is
  // already restored by useDateRange.
  useEffect(() => {
    if (!hasTemporalData) return
    const startDate = new Date(timeseriesData[0].date)
    const endDate = new Date(timeseriesData[timeseriesData.length - 1].date)
    setFullExtent([startDate, endDate])
  }, [hasTemporalData, timeseriesData])

  // Compute if user has selected full temporal range (with 1 day tolerance).
  // True when dataset has no temporal data (to include all null-timestamp
  // media) AND when dateRange is [null, null] — the "no filter" sentinel
  // semantically means "include everything" (matches media.jsx).
  const isFullRange = useMemo(() => {
    if (!hasTemporalData) return true
    if (!dateRange[0] || !dateRange[1]) return true
    if (!fullExtent[0] || !fullExtent[1]) return false
    const tolerance = 86400000 // 1 day in milliseconds
    const startMatch = Math.abs(fullExtent[0].getTime() - dateRange[0].getTime()) < tolerance
    const endMatch = Math.abs(fullExtent[1].getTime() - dateRange[1].getTime()) < tolerance
    return startMatch && endMatch
  }, [hasTemporalData, fullExtent, dateRange])

  useEffect(() => {
    if (speciesInitialized && hasTemporalData) setFilterRowTransitionsEnabled(true)
  }, [speciesInitialized, hasTemporalData])

  // For backend queries, fall back to fullExtent when the user hasn't set
  // a date filter. dateRange itself stays [null, null] in the parent so
  // TimelineChart can render its cleared/zoomed visual state correctly;
  // this fallback is local to the query calls. Mirrors media.jsx.
  const effectiveStart = dateRange[0] ?? fullExtent[0]
  const effectiveEnd = dateRange[1] ?? fullExtent[1]

  // Fetch sequence-aware heatmap data. The `enabled` gate defers the
  // fetch until every queryKey input has settled (sequenceGap resolved,
  // timeseriesQueryData loaded), so the expensive (~11s on gmu8_leuven)
  // heatmap query fires once. dateRange=[null,null] is the "no filter"
  // sentinel — the backend treats it as "include everything," so we
  // don't need to gate on dateRange being populated.
  const { data: heatmapData, isLoading: isHeatmapLoading } = useQuery({
    queryKey: [
      'sequenceAwareHeatmap',
      actualStudyId,
      [...speciesNames].sort(),
      effectiveStart?.toISOString(),
      effectiveEnd?.toISOString(),
      JSON.stringify(timeRange.ranges),
      isFullRange,
      sequenceGap
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareHeatmap(
        actualStudyId,
        speciesNames,
        effectiveStart?.toISOString(),
        effectiveEnd?.toISOString(),
        timeRange,
        isFullRange
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled:
      !!actualStudyId &&
      speciesNames.length > 0 &&
      sequenceGap !== undefined &&
      timeseriesQueryData !== undefined &&
      // Studies without temporal data (e.g. ENA24): fullExtent stays
      // [null, null] forever; fire anyway and let the backend's
      // noDateFilter path return all media (heatmap is keyed by
      // species/lat/lng, not by timestamp).
      (!hasTemporalData || (!!effectiveStart && !!effectiveEnd)),
    placeholderData: (prev) => prev,
    staleTime: Infinity
  })

  // Derive heatmap status from query state and data
  const heatmapStatus = useMemo(() => {
    if (isHeatmapLoading || !heatmapData) return 'loading'
    const hasPoints = Object.values(heatmapData).some((points) => points && points.length > 0)
    return hasPoints ? 'hasData' : 'noData'
  }, [heatmapData, isHeatmapLoading])

  // Fetch sequence-aware daily activity data
  // sequenceGap in queryKey ensures refetch when slider changes (backend fetches from metadata)
  const { data: dailyActivityData } = useQuery({
    queryKey: [
      'sequenceAwareDailyActivity',
      actualStudyId,
      [...speciesNames].sort(),
      effectiveStart?.toISOString(),
      effectiveEnd?.toISOString(),
      sequenceGap,
      areaFilter
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareDailyActivity(
        actualStudyId,
        speciesNames,
        effectiveStart?.toISOString(),
        effectiveEnd?.toISOString(),
        sequenceGap,
        areaFilter
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled:
      !!actualStudyId &&
      speciesNames.length > 0 &&
      sequenceGap !== undefined &&
      !!effectiveStart &&
      !!effectiveEnd,
    placeholderData: (prev) => prev,
    staleTime: Infinity
  })

  const handleArcChange = useCallback((newArc) => {
    setArc(newArc)
  }, [])

  // Handle species selection changes
  const handleSpeciesChange = useCallback((newSelectedSpecies) => {
    // Ensure we have at least one species selected
    if (newSelectedSpecies.length === 0) {
      return
    }
    setSelectedSpecies(newSelectedSpecies)
  }, [])

  return (
    <div className="px-4 flex flex-col h-full">
      {speciesDistributionError ? (
        <div className="text-red-500 py-4 dark:text-red-400">
          Error: {speciesDistributionError.message}
        </div>
      ) : (
        <div className="flex flex-col h-full">
          {/* Top control bar — gap slider + view toggle + filter toggles.
              Lifted out of the right rail so the controls apply visibly to
              whatever the main pane shows (map, gallery, or both). */}
          {speciesInitialized && sequenceGap !== undefined && (
            {/* Mirrors the content row below (flex-1 main pane + w-xs rail with
                gap-4) so the two zones line up vertically: the view cluster
                sits over the map/gallery, and the data+filters group sits over
                the species rail. */}
            <div className="flex items-center gap-4 h-10 flex-shrink-0 mb-2">
              {/* View cluster — aligns with the map/gallery pane. The bbox
                  toggle sits next to the view toggle (not with the filters) so
                  it reads as a display option for the current view; it only
                  shows in gallery/both and self-hides for studies without
                  bounding boxes. */}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <ViewModeToggle value={viewMode} modes={availableViewModes} onChange={setViewMode} />
                {showGallery && <ThumbnailBboxToggle studyId={actualStudyId} />}
              </div>

              {/* Data + filters — same w-xs width as the species rail below, so
                  the gap slider's icon lines up with the species panel. The
                  slider's compact variant is flex-1 and fills the leftover
                  width beside the filter toggle. */}
              <div className="w-xs flex items-center gap-2">
                <SequenceGapSlider value={sequenceGap} onChange={setSequenceGap} variant="compact" />
                <FilterChartsToggle
                  studyId={actualStudyId}
                  // Optimistic while timeseries is loading — hide only once
                  // we've confirmed the study has no timestamps (ENA24, Biome
                  // Health Project, etc).
                  hasTemporalData={hasTemporalData || timeseriesQueryData === undefined}
                  isFiltering={isFilteringWithArea}
                  dayFilterLabel={dayFilterLabel}
                  dateFilterLabel={dateFilterLabel}
                  areaFilterLabel={areaFilterLabel}
                  onResetFilters={handleResetFilters}
                />
              </div>
            </div>
          )}

          {/* Content row — main pane (map / gallery / both) + species rail. */}
          <div className="flex flex-row gap-4 flex-1 min-h-0">
            {/* Main pane. In 'both' the two panes stack on lg–xl and sit
                side-by-side at 2xl+ so neither is cramped (see spec
                responsive table). */}
            <div className="h-full flex-1 min-w-0 flex flex-col 2xl:flex-row gap-4">
              {showMap && (
                <div className="h-full flex-1 min-h-0 min-w-0">
                  {/* Render SpeciesMap as soon as `deploymentLocations` arrives
                      (~ms), so the user sees clustered gray dots at the camera
                      locations while the heavy heatmap query resolves. The map
                      upgrades to pies when heatmapData lands. PlaceholderMap
                      only shows when we have deployment locations but the
                      heatmap explicitly came back empty. */}
                  {deploymentLocations &&
                    deploymentLocations.length > 0 &&
                    heatmapStatus !== 'noData' && (
                      <SpeciesMap
                        deploymentLocations={deploymentLocations}
                        heatmapData={heatmapStatus === 'hasData' ? heatmapData : null}
                        selectedSpecies={selectedSpecies}
                        palette={palette}
                        studyId={actualStudyId}
                        studyName={studyData?.name}
                        geoKey={geoKey}
                        scientificToCommon={scientificToCommon}
                        areaFilter={areaFilter}
                        onApplyAreaFilter={setAreaFilter}
                      />
                    )}
                  {heatmapStatus === 'noData' && !isHeatmapLoading && (
                    <PlaceholderMap
                      title="No Species Location Data"
                      description="Select species from the list and set up deployment coordinates in the Deployments tab to view the species distribution map."
                      linkTo="/deployments"
                      linkText="Go to Deployments"
                      icon={MapPin}
                      studyId={actualStudyId}
                    />
                  )}
                </div>
              )}
              {showGallery && (
                <div className="h-full flex-1 min-h-0 min-w-0">
                  <Gallery
                    species={selectedSpecies.map((s) => s.scientificName)}
                    dateRange={dateRange}
                    timeRange={timeRange}
                    includeNullTimestamps={isFullRange}
                    speciesReady={speciesInitialized}
                  />
                </div>
              )}
            </div>

            {/* Species rail — legend + filter, shown in all views. */}
            <div className="h-full w-xs flex flex-col gap-2 min-h-0">
              {speciesDistributionData && (
                <div className="flex-1 min-h-0">
                  <SpeciesDistribution
                    data={speciesDistributionData}
                    taxonomicData={taxonomicData}
                    selectedSpecies={selectedSpecies}
                    onSpeciesChange={handleSpeciesChange}
                    palette={palette}
                    studyId={actualStudyId}
                    showHeader={false}
                    hidePseudoSpecies
                  />
                </div>
              )}
            </div>
          </div>

          {/* Second row — wrapper is always mounted so the height/opacity/
              margin transition can run in both directions when the filter-
              charts toggle flips. Inner contents stay gated on
              speciesInitialized && sequenceGap !== undefined to prevent the
              empty-bordered flash and the double-fire of timeseries /
              daily-activity queries as queryKey inputs stabilize. Default
              OFF; when off, the map above grows to reclaim the 130px. */}
          <div
            className={`w-full flex-shrink-0 overflow-hidden ${
              filterRowTransitionsEnabled ? 'transition-all duration-300 ease-in-out' : ''
            } ${
              showFilterCharts && hasTemporalData
                ? 'h-[180px] opacity-100 mt-4'
                : 'h-0 opacity-0 mt-0'
            }`}
            aria-hidden={!(showFilterCharts && hasTemporalData)}
          >
            {speciesInitialized && sequenceGap !== undefined && (
              <div className="w-full flex h-[180px] gap-3">
                <div className="w-[180px] h-full rounded border border-border flex flex-col relative">
                  {chartShape === 'polar' ? (
                    <>
                      <div className="absolute top-1.5 right-2 z-10">
                        <ChartShapeToggle value={chartShape} onChange={setChartShape} />
                      </div>
                      <div className="flex-1 relative">
                        <DailyActivityRadar
                          activityData={dailyActivityData}
                          selectedSpecies={selectedSpecies}
                          palette={palette}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <CircularTimeFilter
                            onChange={handleArcChange}
                            startTime={arc.start}
                            endTime={arc.end}
                            mode={chipSelection.size > 0 ? 'chips' : 'drag'}
                            chipSectors={visualRanges}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-end px-2 pt-1.5">
                        <ChartShapeToggle value={chartShape} onChange={setChartShape} />
                      </div>
                      <div className="flex-1 relative">
                        <DailyActivityLine
                          activityData={dailyActivityData}
                          selectedSpecies={selectedSpecies}
                          palette={palette}
                          selectedRanges={visualRanges}
                          onArcChange={chipSelection.size === 0 ? handleArcChange : undefined}
                        />
                      </div>
                    </>
                  )}
                  <div className="flex justify-center px-2 pb-1.5">
                    <DayPeriodChips selection={chipSelection} onChange={setChipSelection} />
                  </div>
                </div>
                <div className="flex-grow rounded px-2 border border-border">
                  <TimelineChart
                    timeseriesData={timeseriesData}
                    selectedSpecies={selectedSpecies}
                    dateRange={dateRange}
                    setDateRange={setDateRange}
                    palette={palette}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
