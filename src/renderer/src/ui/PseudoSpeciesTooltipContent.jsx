/**
 * Compact text-only hover card shown for pseudo-species rows in the
 * species list (Blank, Vehicle, processing labels). No image area —
 * the goal is to explain what the bucket means.
 */
export default function PseudoSpeciesTooltipContent({ entry }) {
  if (!entry) return null
  return (
    <div className="w-[280px] bg-card rounded-lg shadow-xl border border-border overflow-hidden">
      <div className="px-3 py-2.5">
        <p className="text-sm font-medium text-foreground mb-1.5">{entry.label}</p>
        <p className="text-[12px] text-muted-foreground leading-snug">{entry.description}</p>
      </div>
    </div>
  )
}
