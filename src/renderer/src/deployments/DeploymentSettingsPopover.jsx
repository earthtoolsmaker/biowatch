import { Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

/**
 * Gear-icon popover in the DeploymentDetailPane header. Shows at-a-glance
 * stats (media, observations, blank rate), camera identifiers, and
 * deployment dates/duration for the currently selected deployment.
 *
 * Read-only for v1. Row layout (label-left / value-right) is structured
 * so future inline editing drops in without restructuring.
 */
export default function DeploymentSettingsPopover({ studyId, deployment }) {
  const [isOpen, setIsOpen] = useState(false)
  const popoverRef = useRef(null)
  const buttonRef = useRef(null)

  // Outside-click closes the popover. Same pattern as SpeciesFilterButton.
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [isOpen])

  const { data: stats } = useQuery({
    queryKey: ['deploymentStats', studyId, deployment.deploymentID],
    queryFn: async () => {
      const response = await window.api.getDeploymentStats(studyId, deployment.deploymentID)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: isOpen && !!studyId && !!deployment.deploymentID,
    staleTime: Infinity
  })

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((v) => !v)}
        className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Deployment settings"
        aria-label="Deployment settings"
      >
        <Settings size={16} />
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-lg shadow-lg z-[1100] p-4"
        >
          <StatsSection stats={stats} />
          <CameraSection deployment={deployment} />
          <DeploymentSection deployment={deployment} />
        </div>
      )}
    </div>
  )
}

function StatsSection({ stats }) {
  const mediaCount = stats?.mediaCount
  const observationCount = stats?.observationCount
  const blankCount = stats?.blankCount
  const sequenceCount = stats?.sequenceCount

  // Blank rate is over SEQUENCES (events), not media — a blank sequence is a
  // whole sequence with no detection, matching the Media tab and the Blank
  // filter. blankCount / sequenceCount keeps the units consistent.
  const blankRate =
    sequenceCount > 0 && typeof blankCount === 'number' ? (blankCount / sequenceCount) * 100 : null

  return (
    <div className="mb-3">
      <div className="text-[11px] font-semibold text-foreground uppercase tracking-wide mb-2">
        Stats
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <Tile value={formatCount(mediaCount)} label="Media" />
        <Tile value={formatCount(observationCount)} label="Observations" />
      </div>

      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground mb-1">
        <span className="uppercase tracking-wide">Blank rate</span>
        <span className="text-foreground font-medium">
          {blankRate === null ? '—' : `${blankRate.toFixed(1)}%`}{' '}
          <span className="text-muted-foreground font-normal">({formatCount(blankCount)})</span>
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-sm overflow-hidden">
        <div
          className="h-full bg-muted-foreground"
          style={{ width: blankRate === null ? '0%' : `${Math.min(blankRate, 100)}%` }}
        />
      </div>
    </div>
  )
}

function CameraSection({ deployment }) {
  const id = deployment.cameraID
  const model = deployment.cameraModel
  const hasAny = (id && id !== '') || (model && model !== '')
  if (!hasAny) return null

  return (
    <div className="mb-3">
      <div className="text-[11px] font-semibold text-foreground uppercase tracking-wide mb-1.5">
        Camera
      </div>
      <Row label="ID" value={id} />
      <Row label="Model" value={model} />
    </div>
  )
}

function DeploymentSection({ deployment }) {
  const start = deployment.deploymentStart
  const end = deployment.deploymentEnd
  const duration = formatDuration(start, end)

  return (
    <div>
      <div className="text-[11px] font-semibold text-foreground uppercase tracking-wide mb-1.5">
        Deployment
      </div>
      <Row label="Start" value={formatDate(start)} />
      <Row label="End" value={formatDate(end)} />
      {duration !== null && <Row label="Duration" value={duration} />}
    </div>
  )
}

function Tile({ value, label }) {
  return (
    <div className="bg-muted border border-border rounded-md p-2 text-center">
      <div className="text-lg font-semibold text-foreground tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  )
}

function Row({ label, value }) {
  const display = value && value !== '' ? value : '—'
  const isEmpty = display === '—'
  return (
    <div className="flex justify-between text-[13px] leading-7">
      <span className="text-muted-foreground">{label}</span>
      <span className={isEmpty ? 'text-muted-foreground' : 'text-foreground'}>{display}</span>
    </div>
  )
}

function formatCount(n) {
  if (typeof n !== 'number') return '—'
  return n.toLocaleString()
}

// Match overview.jsx:138's formatDate so the popover speaks the same date
// dialect as the rest of the app (e.g. "Aug 1, 2024").
function formatDate(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const ONE_DAY_MS = 86_400_000

function formatDuration(start, end) {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const days = Math.round(ms / ONE_DAY_MS)
  if (days === 0) return '< 1 day'
  if (days === 1) return '1 day'
  return `${days} days`
}
