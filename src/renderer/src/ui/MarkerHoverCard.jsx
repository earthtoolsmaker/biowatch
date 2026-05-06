import { getMapDisplayName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'

// Static React tooltip card for Leaflet markers and clusters in the Activity
// map. Rendered to HTML via renderToStaticMarkup, then handed to
// `marker.bindTooltip` / `cluster.bindTooltip`. The outer chrome (white
// background, rounded corners, border, shadow) comes from the
// `.leaflet-tooltip.species-map-tooltip` CSS rule in main.css — this
// component only renders the inner content.
export default function MarkerHoverCard({ counts, selectedSpecies, palette, scientificToCommon }) {
  const entries = Object.entries(counts)
    .filter(([species]) => selectedSpecies.some((s) => s.scientificName === species))
    .sort((a, b) => b[1] - a[1])

  const total = entries.reduce((sum, [, count]) => sum + count, 0)

  return (
    <div style={{ padding: '8px', minWidth: '180px' }}>
      <div
        style={{
          fontSize: '11px',
          fontWeight: 500,
          color: '#6b7280',
          marginBottom: '4px',
          paddingBottom: '4px',
          borderBottom: '1px solid #e5e7eb'
        }}
      >
        {total} observation{total !== 1 ? 's' : ''}
      </div>
      {entries.map(([species, count]) => {
        const index = selectedSpecies.findIndex((s) => s.scientificName === species)
        const color = palette[index % palette.length]
        const common = getMapDisplayName(species, scientificToCommon)
        const showSci = common && common !== species
        return (
          <div
            key={species}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '3px 0'
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: color,
                marginTop: '5px'
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '12px',
                  color: '#111827',
                  textTransform: common ? 'capitalize' : 'none',
                  fontStyle: common ? 'normal' : 'italic'
                }}
              >
                {common || formatScientificName(species)}
              </div>
              {showSci && (
                <div
                  style={{
                    fontSize: '10px',
                    color: '#6b7280',
                    fontStyle: 'italic'
                  }}
                >
                  {formatScientificName(species)}
                </div>
              )}
            </div>
            <span
              style={{ fontSize: '11px', color: 'var(--color-muted-foreground)', flexShrink: 0 }}
            >
              {count}
            </span>
          </div>
        )
      })}
    </div>
  )
}
