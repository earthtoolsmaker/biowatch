import { getMapDisplayName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'
import {
  COUNTING_OBSERVATIONS,
  DEFAULT_ANALYSIS_METRIC,
  NORMALIZATION_RAI_100
} from '../../../shared/analysisMetric.js'
import { analysisMetricUnit, formatAnalysisValue } from '../utils/analysisMetric.js'

// Inner content for the Explore map's animated species hovercard. The outer
// chrome and transition live in `.species-hovercard`; this component renders
// the total, stacked composition bar, per-species shares, and — for RAI — the
// raw numerator and camera-effort denominator. Composition uses raw counts so
// it remains valid when displayed rate values are unavailable.
export default function MarkerHoverCard({
  analysis,
  selectedSpecies,
  palette,
  scientificToCommon,
  metric = DEFAULT_ANALYSIS_METRIC
}) {
  const values = analysis?.values || analysis?.counts || {}
  const rawCounts = analysis?.rawCounts || values
  const entries = Object.entries(values)
    .filter(([species]) => selectedSpecies.some((item) => item.scientificName === species))
    .sort((left, right) => (Number(right[1]) || 0) - (Number(left[1]) || 0))
  const total = entries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0)
  const rawTotal = Object.entries(rawCounts)
    .filter(([species]) => selectedSpecies.some((item) => item.scientificName === species))
    .reduce((sum, [, value]) => sum + (Number(value) || 0), 0)
  const isRai = metric.normalization === NORMALIZATION_RAI_100
  const effortDays = Number(analysis?.effortDays) || 0

  const colorFor = (species) => {
    const index = selectedSpecies.findIndex((item) => item.scientificName === species)
    return palette[(index >= 0 ? index : 0) % palette.length]
  }
  const share = (species) => {
    const denominator = rawTotal || total
    const numerator = rawTotal ? Number(rawCounts[species]) || 0 : Number(values[species]) || 0
    return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0
  }

  const rawUnit =
    metric.counting === COUNTING_OBSERVATIONS ? 'independent observations' : 'individual detections'

  return (
    <div style={{ padding: '11px 13px', minWidth: '230px' }}>
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
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.01em' }}>
            {formatAnalysisValue(effortDays > 0 || !isRai ? total : null, metric)}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--color-muted-foreground)' }}>
            {analysisMetricUnit(metric)}
          </div>
        </div>
      </div>

      {isRai && (
        <div
          style={{
            margin: '-2px 0 9px',
            fontSize: '9.5px',
            color: 'var(--color-muted-foreground)'
          }}
        >
          {effortDays > 0
            ? `${rawTotal} ${rawUnit} / ${effortDays.toFixed(1)} camera-days`
            : 'RAI unavailable: no valid camera effort for the current filters.'}
        </div>
      )}

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
        {entries.map(([species]) => (
          <span
            key={species}
            style={{ width: `${share(species)}%`, backgroundColor: colorFor(species) }}
          />
        ))}
      </div>

      {entries.map(([species, value]) => {
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
              <span style={{ fontSize: '11px', fontWeight: 600 }}>{share(species)}%</span>
              <span
                style={{
                  fontSize: '10.5px',
                  color: 'var(--color-muted-foreground)',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {formatAnalysisValue(value, metric)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
