/* eslint-disable react-refresh/only-export-components -- Standalone E2E entry point, not a hot-reload boundary. */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MapContainer, useMap } from 'react-leaflet'
import * as Tooltip from '@radix-ui/react-tooltip'
import 'leaflet/dist/leaflet.css'
import '../../../src/renderer/src/assets/main.css'
import MapEncodingToggle from '../../../src/renderer/src/ui/MapEncodingToggle'
import ComparativeMapLayer from '../../../src/renderer/src/ui/ComparativeMapLayer'
import AreaFilterControl from '../../../src/renderer/src/ui/AreaFilterControl'
import {
  resolveComparativeMode,
  resolveMapEncoding
} from '../../../src/renderer/src/utils/comparativeDensity'

const groups = [
  { scientificName: 'a', label: 'Taxonomy A', color: 'hsl(173 58% 39%)' },
  { scientificName: 'b', label: 'Taxonomy B', color: 'hsl(43 74% 66%)' },
  { scientificName: 'c', label: 'Taxonomy C', color: 'hsl(12 76% 61%)' }
]
const observations = [
  { lat: 0, lng: -3, counts: { a: 5, c: 2 } },
  { lat: 0, lng: 0, counts: { a: 5, b: 50, c: 2 } },
  { lat: 0, lng: 3, counts: { b: 50, c: 2 } }
]

function TestMapController() {
  const map = useMap()
  useEffect(() => {
    window.comparativeTestMap = map
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => {
      observer.disconnect()
      delete window.comparativeTestMap
    }
  }, [map])
  return null
}

function Fixture() {
  const [encoding, setEncoding] = useState('pies')
  const [mode, setMode] = useState('overlap')
  const [width, setWidth] = useState(900)
  const [locations, setLocations] = useState(observations)
  const [species, setSpecies] = useState(groups.slice(0, 1))
  const [areaFilter, setAreaFilter] = useState(null)
  const selectionCount = species.length
  const effectiveEncoding = resolveMapEncoding(encoding, selectionCount)
  const effectiveMode = resolveComparativeMode(mode, selectionCount)
  const select = (count) => setSpecies(groups.slice(0, count))
  return (
    <Tooltip.Provider delayDuration={0}>
      <div className="flex gap-3 p-3">
        {[1, 2, 3].map((count) => (
          <button key={count} onClick={() => select(count)}>
            Select {count} taxonomies
          </button>
        ))}
        <button onClick={() => setWidth(width === 900 ? 400 : 900)}>Resize map</button>
        <button
          onClick={() =>
            setLocations([
              { lat: 0, lng: 179, counts: { a: 1 } },
              { lat: 0, lng: -179, counts: { b: 1 } }
            ])
          }
        >
          Use antimeridian observations
        </button>
      </div>
      <div style={{ width, height: 560 }}>
        <MapContainer center={[0, 0]} zoom={6} style={{ width: '100%', height: '100%' }}>
          <TestMapController />
          <AreaFilterControl areaFilter={areaFilter} onApplyAreaFilter={setAreaFilter} />
          {effectiveEncoding === 'comparative' && (
            <ComparativeMapLayer
              locations={locations}
              species={species}
              mode={effectiveMode}
              areaFilter={areaFilter}
            />
          )}
          <MapEncodingToggle
            value={effectiveEncoding}
            onChange={setEncoding}
            singleSpecies={selectionCount <= 1}
            selectionCount={selectionCount}
            comparativeMode={effectiveMode}
            onComparativeModeChange={setMode}
          />
        </MapContainer>
      </div>
    </Tooltip.Provider>
  )
}

createRoot(document.getElementById('root')).render(<Fixture />)
