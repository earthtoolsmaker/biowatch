import { getMapDisplayName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'

// Inner content for the Activity map's species hover card, rendered live (as a
// real React node) inside the animated `.species-hovercard` overlay — see
// HoverCardOverlay in activity.jsx. The outer chrome (background, rounded
// corners, border, shadow) and the pop/fade animation come from the
// `.species-hovercard` CSS rules in main.css; this component only renders the
// inner composition breakdown.
//
// Layout: a "Composition" header with the total, a stacked composition bar
// (the pie marker flattened into one bar), then one row per species with its
// color, common/scientific name, share (%) and raw count.
export default function MarkerHoverCard({ counts, selectedSpecies, palette, scientificToCommon }) {
  const entries = Object.entries(counts)
    .filter(([species]) => selectedSpecies.some((s) => s.scientificName === species))
    .sort((a, b) => b[1] - a[1])

  const total = entries.reduce((sum, [, count]) => sum + count, 0)

  const colorFor = (species) => {
    const index = selectedSpecies.findIndex((s) => s.scientificName === species)
    return palette[(index >= 0 ? index : 0) % palette.length]
  }
  const share = (count) => (total > 0 ? Math.round((count / total) * 100) : 0)

  return (
    <div style={{ padding: '11px 13px', minWidth: '210px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: '8px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--color-border)'
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--color-muted-foreground)'
          }}
        >
          Composition
        </span>
        <span style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.01em' }}>{total}</span>
      </div>

      <div
        className="species-hovercard__bar"
        style={{
          display: 'flex',
          height: '8px',
          borderRadius: '5px',
          overflow: 'hidden',
          margin: '2px 0 11px'
        }}
      >
        {entries.map(([species, count]) => (
          <span
            key={species}
            style={{
              width: `${total > 0 ? (count / total) * 100 : 0}%`,
              backgroundColor: colorFor(species)
            }}
          />
        ))}
      </div>

      {entries.map(([species, count]) => {
        const common = getMapDisplayName(species, scientificToCommon)
        const showSci = common && common !== species
        return (
          <div
            key={species}
            style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '4px 0' }}
          >
            <span
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: colorFor(species),
                marginTop: '4px'
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '12.5px',
                  lineHeight: 1.25,
                  color: 'var(--color-foreground)',
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
                    lineHeight: 1.2,
                    color: 'var(--color-muted-foreground)',
                    fontStyle: 'italic'
                  }}
                >
                  {formatScientificName(species)}
                </div>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '7px',
                flexShrink: 0,
                marginTop: '1px'
              }}
            >
              <span
                style={{ fontSize: '11px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
              >
                {share(count)}%
              </span>
              <span
                style={{
                  fontSize: '10.5px',
                  color: 'var(--color-muted-foreground)',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {count}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
