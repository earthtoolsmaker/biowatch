import { useEffect, useMemo, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  buildComparativeDensities,
  colorizeComparison,
  compareDensityGrids
} from '../utils/comparativeDensity'

// Resolve CSS colors (including the species palette's HSL) without duplicating
// a color parser. Canvas normalizes them to RGBA for the raster's endpoints.
function colorChannels(color) {
  const context = document.createElement('canvas').getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
}

/** A geographically anchored raster and scores for the applied area filter. */
export default function ComparativeMapLayer({ locations, species, mode, areaFilter }) {
  const map = useMap()
  const legendRef = useRef(null)
  const analysis = useMemo(() => {
    const density = buildComparativeDensities(
      locations,
      species.map((group) => group.scientificName),
      areaFilter
    )
    return { ...density, ...compareDensityGrids(density.grids, mode) }
  }, [locations, species, mode, areaFilter])

  useEffect(() => {
    const element = legendRef.current
    L.DomEvent.disableClickPropagation(element)
    L.DomEvent.disableScrollPropagation(element)
  }, [])

  useEffect(() => {
    const { bounds, columns, rows } = analysis
    if (!bounds) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = columns
    canvas.height = rows
    const context = canvas.getContext('2d')
    const image = context.createImageData(columns, rows)
    image.data.set(
      colorizeComparison(
        analysis,
        mode,
        species.map((group) => colorChannels(group.color))
      )
    )
    context.putImageData(image, 0, 0)
    const layer = L.imageOverlay(
      canvas.toDataURL(),
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east]
      ],
      { interactive: false }
    ).addTo(map)
    layer.getElement().dataset.comparativeRaster = mode
    // Leaflet repositions/scales this fixed geographical image when navigating;
    // it never recomputes the analysis or changes its normalization domain.
    let worldOffset = 0
    const updateWorldCopy = () => {
      const centerLongitude = (bounds.east + bounds.west) / 2
      const nextOffset = 360 * Math.round((map.getCenter().lng - centerLongitude) / 360)
      if (nextOffset === worldOffset) return
      worldOffset = nextOffset
      layer.setBounds([
        [bounds.south, bounds.west + worldOffset],
        [bounds.north, bounds.east + worldOffset]
      ])
    }
    updateWorldCopy()
    map.on('moveend', updateWorldCopy)
    return () => {
      map.off('moveend', updateWorldCopy)
      map.removeLayer(layer)
    }
  }, [map, analysis, species, mode])

  const difference = mode === 'difference'
  const scope = areaFilter ? 'the filtered area' : 'all study locations'
  const emptyNames = analysis.emptyGroups.map((index) => species[index].label).join(', ')
  const scoreDescription = difference
    ? `Sum of absolute density differences divided by combined density (total variation distance). 0 = identical distributions; 1 = fully separated. Each group is normalized independently within ${scope}.`
    : `Sum of the pointwise minimum across all selected, independently normalized densities. 0 = no shared density; 1 = identical distributions within ${scope}.`

  return (
    <div
      ref={legendRef}
      className="absolute bottom-28 left-5 z-[1000] flex flex-col gap-1.5 bg-card p-3 rounded shadow-md cursor-default w-72 max-w-[calc(100%-2.5rem)]"
      aria-label="Comparative density legend"
    >
      <div className="flex justify-between items-baseline gap-3 text-xs" title={scoreDescription}>
        <span>{difference ? 'Imbalance ratio' : 'Overlap score'}</span>
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="font-medium tabular-nums"
        >
          {analysis.score == null ? 'No data in comparison area' : analysis.score.toFixed(3)}
        </span>
      </div>
      <div
        className="h-2 rounded"
        style={{
          background: difference
            ? `linear-gradient(to right, ${species[0].color}, white, ${species[1].color})`
            : 'linear-gradient(to right, #dbeafe, #1d4ed8)'
        }}
      />
      {difference ? (
        <>
          <div className="flex justify-between gap-3 text-[10px] text-muted-foreground">
            <span className="min-w-0 flex-1 break-words">{species[0].label}</span>
            <span className="min-w-0 flex-1 break-words text-right">{species[1].label}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">First selection − second selection</p>
        </>
      ) : (
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Less shared density</span>
          <span>More shared density</span>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        {difference ? '0 = identical · 1 = separated' : '0 = no overlap · 1 = identical'}
        <br />
        Normalized per taxonomy within {scope}
        <br />
        Use “Filter to this area” to compare another area
      </p>
      {emptyNames && (
        <p className="text-[10px] text-muted-foreground">
          No data in comparison area for: {emptyNames}
        </p>
      )}
    </div>
  )
}
