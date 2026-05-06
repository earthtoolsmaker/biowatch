import { useQuery } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'

import { formatBytes } from '../utils/formatBytes.js'

const ROW_LABELS = {
  models: 'AI Models',
  studies: 'Studies',
  logs: 'Logs'
}

function StorageRow({ label, entry, isLoading }) {
  if (!entry) {
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">—</span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums text-foreground">
          {isLoading ? '…' : formatBytes(entry.bytes)}
        </span>
        <button
          onClick={() => window.api.openPath(entry.path)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={`Open ${entry.path}`}
        >
          <FolderOpen size={14} />
        </button>
      </div>
    </div>
  )
}

export default function StorageBreakdown() {
  const { data, isLoading } = useQuery({
    queryKey: ['settings-info', 'storage-usage'],
    queryFn: () => window.api.getStorageUsage(),
    staleTime: 30_000
  })

  return (
    <section className="py-6">
      <h2 className="text-base font-medium text-foreground mb-1">Storage</h2>
      <p className="text-sm text-muted-foreground mb-2">
        Disk space used by Biowatch on this machine.
      </p>
      <div className="divide-y divide-gray-100">
        {Object.keys(ROW_LABELS).map((key) => (
          <StorageRow key={key} label={ROW_LABELS[key]} entry={data?.[key]} isLoading={isLoading} />
        ))}
      </div>
    </section>
  )
}
