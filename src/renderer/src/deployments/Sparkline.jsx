import { memo } from 'react'

/**
 * Renders an activity sparkline for a deployment row. Three variants
 * sharing the same `periods` data:
 *   - 'bars'    → mini column chart (default)
 *   - 'line'    → smooth area chart (SVG)
 *   - 'heatmap' → colored cells, intensity = count
 *
 * `muted` swaps the primary color for slate-300, used on aggregated
 * section-header sparklines so children stand out.
 */
const Sparkline = memo(function Sparkline({
  periods,
  mode = 'bars',
  percentile90Count,
  muted = false
}) {
  if (!periods || periods.length === 0) return null
  const max = percentile90Count || 1

  if (mode === 'bars') {
    return (
      <div className="flex gap-px items-end h-[22px] w-full">
        {periods.map((period, i) => {
          const heightPct = period.count > 0 ? Math.min((period.count / max) * 100, 100) : 0
          return (
            <div
              key={i}
              className={`flex-1 ${muted ? 'bg-slate-300' : 'bg-[#77b7ff]'} rounded-sm`}
              style={{
                height: `${heightPct}%`,
                minHeight: period.count > 0 ? '2px' : '1px',
                opacity: period.count > 0 ? 1 : 0.3
              }}
            />
          )
        })}
      </div>
    )
  }

  if (mode === 'line') {
    const stroke = muted ? '#94a3b8' : '#3b82f6'
    const pts = periods.map((p, i) => [
      (i / (periods.length - 1 || 1)) * 100,
      22 - Math.min(p.count / max, 1) * 20
    ])
    // Smooth via Catmull-Rom → cubic Bezier so sparse activity reads as a
    // wave rather than triangular spikes.
    let linePath = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2] || p2
      const c1x = p1[0] + (p2[0] - p0[0]) / 6
      const c1y = p1[1] + (p2[1] - p0[1]) / 6
      const c2x = p2[0] - (p3[0] - p1[0]) / 6
      const c2y = p2[1] - (p3[1] - p1[1]) / 6
      linePath += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`
    }
    const lastX = pts[pts.length - 1][0]
    const firstX = pts[0][0]
    const areaPath = `${linePath} L${lastX.toFixed(2)},22 L${firstX.toFixed(2)},22 Z`
    return (
      <svg viewBox="0 0 100 22" preserveAspectRatio="none" className="w-full h-[22px] block">
        <path d={areaPath} fill={stroke} opacity="0.22" />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" />
      </svg>
    )
  }

  if (mode === 'heatmap') {
    const palette = muted
      ? ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b']
      : ['#dbeafe', '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8']
    return (
      <div className="flex gap-px h-[14px] w-full items-stretch">
        {periods.map((period, i) => {
          const t = period.count > 0 ? period.count / max : 0
          const idx =
            period.count === 0 ? 0 : Math.min(palette.length - 1, Math.floor(t * palette.length))
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm ${period.count === 0 ? 'bg-gray-50 dark:bg-muted' : ''}`}
              style={period.count > 0 ? { background: palette[idx] } : undefined}
            />
          )
        })}
      </div>
    )
  }

  return null
})

export default Sparkline
