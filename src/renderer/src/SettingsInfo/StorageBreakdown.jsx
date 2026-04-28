import { useQuery } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}

const ROW_LABELS = {
  models: 'AI Models',
  studies: 'Studies',
  logs: 'Logs'
}

function StorageRow({ label, entry, isLoading }) {
  if (!entry) {
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-gray-700">{label}</span>
        <span className="text-sm text-gray-400">—</span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums text-gray-900">
          {isLoading ? '…' : formatBytes(entry.bytes)}
        </span>
        <button
          onClick={() => window.api.openPath(entry.path)}
          className="text-gray-400 hover:text-gray-700 transition-colors"
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
      <h2 className="text-base font-medium text-gray-900 mb-1">Storage</h2>
      <p className="text-sm text-gray-500 mb-2">Disk space used by Biowatch on this machine.</p>
      <div className="divide-y divide-gray-100">
        {Object.keys(ROW_LABELS).map((key) => (
          <StorageRow key={key} label={ROW_LABELS[key]} entry={data?.[key]} isLoading={isLoading} />
        ))}
      </div>
    </section>
  )
}
