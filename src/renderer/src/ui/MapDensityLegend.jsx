import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { DENSITY_SCALES, getDensityScale, scaleToCssGradient } from '../utils/densityScales'

/**
 * Bottom-right legend for the density encodings (heatmap / hex grid). Shows the
 * active color ramp with a qualitative Fewer → More key (the ramp is normalized
 * to the busiest spot, so absolute counts aren't meaningful), plus a row of
 * swatches to switch color scales — useful for keeping contrast over basemaps
 * like forest canopy where a green-low ramp washes out.
 *
 * Lives inside the Leaflet container, so click/scroll propagation is disabled
 * to keep swatch clicks from panning the map.
 */
export default function MapDensityLegend({ value, onChange }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current)
      L.DomEvent.disableScrollPropagation(ref.current)
    }
  }, [])

  const active = getDensityScale(value)

  return (
    <div
      ref={ref}
      className="absolute bottom-5 right-5 z-[1000] flex flex-col gap-1.5 bg-card p-2 rounded shadow-md cursor-default"
    >
      <span className="text-[11px] text-muted-foreground">Activity</span>
      <div className="h-2 w-28 rounded" style={{ background: scaleToCssGradient(active.stops) }} />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Fewer</span>
        <span>More</span>
      </div>
      <div className="flex items-center gap-1 pt-1.5 mt-0.5 border-t border-border">
        {DENSITY_SCALES.map((scale) => (
          <button
            key={scale.key}
            type="button"
            title={scale.label}
            aria-label={`${scale.label} color scale`}
            aria-pressed={scale.key === value}
            onClick={() => onChange(scale.key)}
            className={`h-3.5 w-6 rounded-sm cursor-pointer transition-shadow ${
              scale.key === value
                ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-card'
                : 'ring-1 ring-border hover:ring-foreground/40'
            }`}
            style={{ background: scaleToCssGradient(scale.stops) }}
          />
        ))}
      </div>
    </div>
  )
}
