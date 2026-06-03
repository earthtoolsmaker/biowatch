import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'

// Esri World Imagery — the same satellite basemap the Overview/Deployments maps
// use. Satellite is more useful than a street map for a camera-trap location.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Compact, non-interactive map preview shown in a hover card over a deployment
// row in the filter drawer — centers on the deployment's coordinates with a
// marker. Falls back to a note when the deployment has no coordinates.
export default function DeploymentHoverMap({ lat, lon, label, count }) {
  const latNum = typeof lat === 'string' ? parseFloat(lat) : lat
  const lonNum = typeof lon === 'string' ? parseFloat(lon) : lon
  const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum)

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
        <div className="text-[11px] text-muted-foreground">
          {(count ?? 0).toLocaleString()} observations
        </div>
      </div>
    </div>
  )
}
