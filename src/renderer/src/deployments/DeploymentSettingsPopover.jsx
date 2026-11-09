import { Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { deploymentEffortDays } from '../../../shared/effort.js'
import EffortTooltip from './EffortTooltip'
import { formatDateRange, formatEffortDays } from './formatEffort'

/**
 * Gear-icon popover in the DeploymentDetailPane header. Shows at-a-glance
 * stats (media, observations, blank rate), camera identifiers, and
 * deployment dates plus camera-days for the currently selected deployment.
 *
 * Camera time settings explicitly resolve offset-free source timestamps.
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
        title={
          deployment.unresolvedTimestampCount > 0
            ? 'Camera timezone needed — open deployment settings'
            : 'Deployment settings'
        }
        aria-label="Deployment settings"
      >
        <Settings size={16} />
        {deployment.unresolvedTimestampCount > 0 && (
          <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-amber-500" />
        )}
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-lg shadow-lg z-[1100] p-4"
        >
          <StatsSection stats={stats} />
          <CameraSection deployment={deployment} />
          <CameraTimeSection
            key={deployment.cameraTimeZone || 'source'}
            studyId={studyId}
            deployment={deployment}
          />
          <DeploymentSection deployment={deployment} />
        </div>
      )}
    </div>
  )
}

function CameraTimeSection({ studyId, deployment }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(deployment.cameraTimeZone || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const response = await window.api.setCameraTimeZone(
        studyId,
        deployment.deploymentID,
        draft.trim() || null
      )
      if (response.error) throw new Error(response.error)
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes(studyId)
      })
      setMessage(
        response.data.unresolvedCount > 0
          ? `${response.data.unresolvedCount} timestamps still need an explicit offset (invalid or ambiguous camera time).`
          : 'Camera time setting saved.'
      )
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <form onSubmit={save} className="mb-3 border-t border-border pt-3">
      <label
        className="text-[11px] font-semibold uppercase tracking-wide"
        htmlFor="camera-time-zone"
      >
        Camera time setting
      </label>
      <p className="text-[11px] text-muted-foreground my-1">
        Use Europe/Paris for daylight saving, or UTC+02:00 for a clock fixed year-round. Leave blank
        to use offsets supplied by the source. Supplied offsets are always preserved.
      </p>
      {!deployment.cameraEffortTimeZone &&
        deployment.sourceDeploymentStart &&
        deployment.sourceDeploymentEnd && (
          <p className="text-[11px] text-amber-600 mb-1">
            Camera effort needs a setting consistent with the source offsets. Use a named timezone
            when offsets change with daylight saving.
          </p>
        )}
      {deployment.unresolvedTimestampCount > 0 && (
        <p role="status" className="text-[11px] text-amber-600 mb-1">
          {deployment.unresolvedTimestampCount} media have no known instant and are excluded from
          date-based analysis. Set the camera timezone below.
        </p>
      )}
      <div className="flex gap-2">
        <input
          id="camera-time-zone"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Europe/Paris or UTC+02:00"
          disabled={saving}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded border border-border px-2 text-xs"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {message && (
        <p role="status" className="text-[11px] mt-1">
          {message}
        </p>
      )}
    </form>
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
  // Camera effort = the active interval in fractional camera-days (both
  // dates parse, end after start; see src/shared/effort.js). Null renders
  // as "—" rather than 0.
  const effortDays = deploymentEffortDays(start, end)

  return (
    <div>
      <div className="text-[11px] font-semibold text-foreground uppercase tracking-wide mb-1.5">
        Deployment
      </div>
      <Row label="Start" value={formatDate(start)} />
      <Row label="End" value={formatDate(end)} />
      <EffortTooltip effortDays={effortDays} detail={formatDateRange(start, end)}>
        <div className="cursor-help">
          <Row
            label="Camera-days"
            value={effortDays === null ? null : formatEffortDays(effortDays)}
          />
        </div>
      </EffortTooltip>
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
