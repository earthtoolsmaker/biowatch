import { useState, useEffect } from 'react'
import * as HoverCard from '@radix-ui/react-hover-card'
import { useQuery } from '@tanstack/react-query'
import {
  PawPrint,
  Camera,
  CalendarDays,
  Eye,
  Image as ImageIcon,
  AlertTriangle
} from 'lucide-react'
import { formatStatNumber, formatSpan, formatRangeShort } from '../overview/utils/formatStats'

/**
 * Hover card for a study list row in the sidebar. Shows title, description,
 * a compact KPI strip, and a contributors byline. Stats are fetched lazily
 * on first hover and cached for the session.
 *
 * @param {Object} props
 * @param {Object} props.study - Study object as returned by getStudies()
 *   (must include `id`, `name`, and optionally `data.{description,contributors}`).
 * @param {number} props.scrollSignal - Bumped by the parent on scroll;
 *   resets the open state so the card doesn't ride along with its anchor.
 * @param {React.ReactNode} props.children - The trigger element (a NavLink).
 */
export default function StudyHoverCard({ study, scrollSignal, children }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (scrollSignal > 0) setOpen(false)
  }, [scrollSignal])

  const { data: stats, isLoading } = useQuery({
    queryKey: ['studyHoverStats', study.id],
    queryFn: async () => {
      const r = await window.api.getOverviewStats(study.id)
      if (r.error) throw new Error(r.error)
      return r.data
    },
    enabled: open,
    staleTime: Infinity
  })

  return (
    <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={200} closeDelay={120}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          sideOffset={8}
          align="start"
          avoidCollisions
          collisionPadding={16}
          className="z-[10001] w-80 bg-card rounded-lg shadow-xl border border-border p-4"
        >
          <Body study={study} stats={stats} isLoading={isLoading} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}

function Body({ study, stats, isLoading }) {
  const description = study.data?.description
  const contributors = study.data?.contributors || []

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-foreground capitalize leading-tight">
        {study.name}
      </h3>

      {description && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{description}</p>
      )}

      <KpiStrip stats={stats} isLoading={isLoading} />

      {contributors.length > 0 && <ContributorsLine contributors={contributors} />}
    </div>
  )
}

function KpiStrip({ stats, isLoading }) {
  if (isLoading || !stats) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
        <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
      </div>
    )
  }

  const { speciesCount, threatenedCount, cameraCount, observationCount, mediaCount, derivedRange } =
    stats
  const span = formatSpan(derivedRange?.start, derivedRange?.end)
  const rangeLabel = formatRangeShort(derivedRange?.start, derivedRange?.end)

  return (
    <div className="flex flex-col gap-1.5 text-xs text-foreground">
      <div className="flex items-center gap-3 flex-wrap">
        <Stat icon={<PawPrint size={12} />}>{formatStatNumber(speciesCount)} species</Stat>
        <Stat icon={<Camera size={12} />}>{formatStatNumber(cameraCount)} deployments</Stat>
        {span !== '—' && (
          <Stat icon={<CalendarDays size={12} />} title={rangeLabel || undefined}>
            {span}
          </Stat>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Stat icon={<Eye size={12} />}>{formatStatNumber(observationCount)} obs</Stat>
        <Stat icon={<ImageIcon size={12} />}>{formatStatNumber(mediaCount)} media</Stat>
        {threatenedCount > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
            <AlertTriangle size={12} />
            {formatStatNumber(threatenedCount)} threatened
          </span>
        )}
      </div>
    </div>
  )
}

function Stat({ icon, children, title }) {
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </span>
  )
}

function ContributorsLine({ contributors }) {
  const visible = contributors.slice(0, 3)
  const overflow = contributors.length - visible.length

  return (
    <div className="text-[0.7rem] text-muted-foreground pt-2 border-t border-border flex items-center gap-1 flex-wrap">
      <span className="text-muted-foreground">By</span>
      {visible.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="text-muted-foreground">{displayName(c)}</span>
          {i < visible.length - 1 && <span className="text-muted-foreground">·</span>}
        </span>
      ))}
      {overflow > 0 && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">+{overflow} more</span>
        </>
      )}
    </div>
  )
}

function displayName(c) {
  if (c.title) return c.title
  return `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed'
}
