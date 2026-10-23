import { useEffect, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  buildViewportDensities,
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

/** A bounded, viewport-local raster plus its live analytical legend. */
export default function ComparativeMapLayer({ locations, species, mode }) {
  const map = useMap()
  const legendRef = useRef(null)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    const element = legendRef.current
    L.DomEvent.disableClickPropagation(element)
    L.DomEvent.disableScrollPropagation(element)
  }, [])

  useEffect(() => {
    const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide')
    canvas.style.position = 'absolute'
    canvas.style.pointerEvents = 'none'
    canvas.setAttribute('aria-hidden', 'true')
    canvas.dataset.comparativeRaster = mode
    map.getPanes().overlayPane.appendChild(canvas)
    const context = canvas.getContext('2d')
    const colors = species.map((group) => colorChannels(group.color))
    let frame = 0

    const redraw = () => {
      const { x: width, y: height } = map.getSize()
      if (width <= 0 || height <= 0) return
      const centerLongitude = map.getCenter().lng
      const { columns, rows, grids } = buildViewportDensities(
        locations,
        species.map((group) => group.scientificName),
        {
          width,
          height,
          zoom: map.getZoom(),
          project: (lat, lng) => {
            // Use the world copy closest to the viewport, including frames
            // crossing the antimeridian or panned beyond ±180°.
            const longitude = lng + 360 * Math.round((centerLongitude - lng) / 360)
            return map.latLngToContainerPoint([lat, longitude])
          }
        }
      )
      const result = compareDensityGrids(grids, mode)
      canvas.width = columns
      canvas.height = rows
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
      const image = context.createImageData(columns, rows)
      image.data.set(colorizeComparison(result, mode, colors))
      context.putImageData(image, 0, 0)
      canvas.style.visibility = 'visible'
      setSummary({ score: result.score, emptyGroups: result.emptyGroups, species, mode })
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        redraw()
      })
    }
    // Hide the old viewport until the first coalesced redraw. During a pan,
    // move events keep both the surface and score live, at most once per frame.
    const hide = () => {
      cancelAnimationFrame(frame)
      frame = 0
      canvas.style.visibility = 'hidden'
    }
    redraw()
    map.on('movestart zoomstart', hide)
    map.on('move moveend zoomend resize viewreset', schedule)
    return () => {
      cancelAnimationFrame(frame)
      map.off('movestart zoomstart', hide)
      map.off('move moveend zoomend resize viewreset', schedule)
      canvas.remove()
    }
  }, [map, locations, species, mode])

  const difference = mode === 'difference'
  const currentSummary = summary?.species === species && summary.mode === mode ? summary : null
  const emptyNames = currentSummary?.emptyGroups.map((index) => species[index].label).join(', ')
  const scoreDescription = difference
    ? 'Sum of absolute density differences divided by combined density (total variation distance). 0 = identical distributions; 1 = fully separated. Each group is normalized independently within this viewport.'
    : 'Sum of the pointwise minimum across all selected, independently normalized densities. 0 = no shared density; 1 = identical distributions within this viewport.'

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
          {currentSummary?.score == null ? 'No visible data' : currentSummary.score.toFixed(3)}
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
        Normalized per taxonomy in the visible map area
      </p>
      {emptyNames && (
        <p className="text-[10px] text-muted-foreground">No visible data for: {emptyNames}</p>
      )}
    </div>
  )
}
