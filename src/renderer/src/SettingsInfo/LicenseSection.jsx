import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import LicenseModal from './LicenseModal'

export default function LicenseSection() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="py-6">
      <h2 className="text-base font-medium text-gray-900 mb-1">License</h2>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">CC BY-NC 4.0 · © 2026 EarthToolsMaker</p>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          View license
          <ExternalLink size={12} />
        </button>
      </div>
      <LicenseModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  )
}
