import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import { Film, Image as ImageIcon, MapPinOff } from 'lucide-react'
import Sparkline from '../deployments/Sparkline'

// Compact survey-window date label (e.g. "Mar 2024") for the heatmap axis ends.
function fmtSurveyDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

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
  currentId,
  others = [],
  detectionCount = 0,
  blankCount = 0,
  imageCount = 0,
  videoCount = 0,
  periods,
  percentile90Count,
  surveyStart,
  surveyEnd
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
          dragging={true}
          zoomControl={false}
          scrollWheelZoom={true}
          doubleClickZoom={false}
          touchZoom={false}
          boxZoom={false}
          keyboard={false}
          attributionControl={false}
        >
          <TileLayer url={SATELLITE_URL} attribution="&copy; Esri" />
          {/* Other survey deployments, faint — gives spatial context to confirm
              the highlighted spot against its neighbours. Drawn first so the
              current marker sits on top. */}
          {others.map((o) => {
            if (o.value === currentId) return null
            const oLat = typeof o.lat === 'string' ? parseFloat(o.lat) : o.lat
            const oLon = typeof o.lon === 'string' ? parseFloat(o.lon) : o.lon
            if (!Number.isFinite(oLat) || !Number.isFinite(oLon)) return null
            return (
              <CircleMarker
                key={o.value}
                center={[oLat, oLon]}
                radius={4}
                pathOptions={{
                  color: '#ffffff',
                  weight: 1,
                  opacity: 0.5,
                  fillColor: '#3b82f6',
                  fillOpacity: 0.35
                }}
              />
            )
          })}
          <CircleMarker
            center={[latNum, lonNum]}
            radius={6}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }}
          />
        </MapContainer>
      ) : (
        // No coordinates yet: stand in for the map with a faint map-grid panel
        // so the layout reads as "this is where the location preview goes",
        // plus a clear "not set" cue and where to fix it.
        <div className="relative h-[180px] w-full overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
          <div
            className="absolute inset-0 opacity-40 dark:opacity-20"
            style={{
              backgroundImage:
                'linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)',
              backgroundSize: '22px 22px'
            }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-5 text-center">
            <MapPinOff className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-xs font-medium text-foreground">No location set</span>
            <span className="text-[11px] leading-snug text-muted-foreground">
              Add coordinates in the Deployments tab to place this camera on the map.
            </span>
          </div>
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
        {imageCount + videoCount > 0 && (
          <div className="mt-1.5 flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <ImageIcon size={12} className="text-muted-foreground" />
              <span className="text-foreground font-medium">{imageCount.toLocaleString()}</span>
              <span className="text-muted-foreground">images</span>
            </span>
            <span className="flex items-center gap-1">
              <Film size={12} className="text-muted-foreground" />
              <span className="text-foreground font-medium">{videoCount.toLocaleString()}</span>
              <span className="text-muted-foreground">videos</span>
            </span>
          </div>
        )}
        {periods && periods.length > 0 && (
          <div className="mt-2.5 pt-2.5 border-t border-border">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Activity over survey
            </div>
            <Sparkline periods={periods} mode="heatmap" percentile90Count={percentile90Count} />
            {(surveyStart || surveyEnd) && (
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{fmtSurveyDate(surveyStart)}</span>
                <span>{fmtSurveyDate(surveyEnd)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
