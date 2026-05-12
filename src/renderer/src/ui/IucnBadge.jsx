// IUCN Red List category palette + label.
// Used in the species hover tooltip and the species-distribution list rows.
const IUCN_COLORS = {
  LC: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  NT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  VU: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  EN: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  CR: 'bg-red-200 text-red-900 dark:bg-red-500/30 dark:text-red-200',
  EX: 'bg-gray-800 text-white',
  EW: 'bg-gray-700 text-white',
  DD: 'bg-muted text-foreground',
  NE: 'bg-muted text-foreground'
}

const IUCN_LABELS = {
  LC: 'Least Concern',
  NT: 'Near Threatened',
  VU: 'Vulnerable',
  EN: 'Endangered',
  CR: 'Critically Endangered',
  EW: 'Extinct in the Wild',
  EX: 'Extinct',
  DD: 'Data Deficient',
  NE: 'Not Evaluated'
}

export default function IucnBadge({ category }) {
  if (!category) return null
  const cls = IUCN_COLORS[category] ?? 'bg-muted text-foreground'
  const label = IUCN_LABELS[category] ?? category
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}
      title={`${category} — ${label} (IUCN Red List)`}
    >
      {category}
    </span>
  )
}
