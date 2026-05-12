import { ChevronRight, MapPin } from 'lucide-react'
import { useNavigate } from 'react-router'

/**
 * Footer pill in modal media viewers that navigates to the corresponding
 * deployment in the Deployments tab. When `interactive` is false, renders
 * the same label as a static span — context, not a link.
 *
 * Label fallback: locationName → locationID → 'View deployment'.
 */
export default function DeploymentLinkPill({
  studyId,
  deploymentID,
  locationName,
  locationID,
  interactive,
  onNavigate
}) {
  const navigate = useNavigate()
  const label = locationName || locationID || 'View deployment'

  if (!interactive) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MapPin size={12} />
        <span className="truncate max-w-[200px]">{label}</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onNavigate?.()
        navigate(
          `/study/${encodeURIComponent(studyId)}/deployments?deploymentID=${encodeURIComponent(deploymentID)}`
        )
      }}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-blue-700 hover:bg-blue-50 transition-colors dark:hover:text-blue-400 dark:hover:bg-blue-500/15"
      title="Open in Deployments tab"
    >
      <MapPin size={12} />
      <span className="truncate max-w-[200px]">{label}</span>
      <ChevronRight size={12} />
    </button>
  )
}
