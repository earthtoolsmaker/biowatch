import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'

// Esri World Imagery — the same satellite basemap the Overview/Deployments maps
// use. Satellite is more useful than a street map for a camera-trap location.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Compact, non-interactive map preview shown in a hover card over a deployment
// row in the filter drawer — centers on the deployment's coordinates with a
// marker. Falls back to a note when the deployment has no coordinates. Below the
// map, a composition bar breaks the deployment's media into detections vs blanks.
export default function DeploymentHoverMap({
  lat,
  lon,
  label,
  detectionCount = 0,
  blankCount = 0
}) {
  const latNum = typeof lat === 'string' ? parseFloat(lat) : lat
  const lonNum = typeof lon === 'string' ? parseFloat(lon) : lon
  const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum)

  // Fill the bar to full width, split by the deployment's own detection/blank
  // share (vs the filter list's bars, which normalize across deployments).
  const total = detectionCount + blankCount
  const detW = total > 0 ? (detectionCount / total) * 100 : 0
  const blankW = total > 0 ? (blankCount / total) * 100 : 0

  // Match the species hover card exactly: w-[320px] with a 180px-tall media area
  // (the map stands in for the species image) and a name/meta line below.
  return (
    <div className="w-[320px]">
      {hasCoords ? (
        <MapContainer
          center={[latNum, lonNum]}
          zoom={13}
          className="h-[180px] w-full"
          dragging={false}
          zoomControl={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          boxZoom={false}
          keyboard={false}
          attributionControl={false}
        >
          <TileLayer url={SATELLITE_URL} attribution="&copy; Esri" />
          <CircleMarker
            center={[latNum, lonNum]}
            radius={6}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }}
          />
        </MapContainer>
      ) : (
        <div className="h-[180px] w-full flex items-center justify-center bg-muted text-xs text-muted-foreground">
          No location coordinates
        </div>
      )}
      <div className="px-3 py-2">
        <div className="text-xs text-foreground font-medium truncate">{label}</div>
        <div className="mt-1.5 w-full bg-muted rounded-full h-1.5 overflow-hidden flex">
          <div className="h-1.5" style={{ width: `${detW}%`, backgroundColor: '#2563eb' }} />
          <div className="h-1.5" style={{ width: `${blankW}%`, backgroundColor: '#cbd5e1' }} />
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#2563eb' }} />
            <span className="text-foreground font-medium">{detectionCount.toLocaleString()}</span>
            <span className="text-muted-foreground">detections</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#cbd5e1' }} />
            <span className="text-foreground font-medium">{blankCount.toLocaleString()}</span>
            <span className="text-muted-foreground">blank</span>
          </span>
        </div>
      </div>
    </div>
  )
}
